import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PLATFORM_CONFIG_DEFAULTS,
  ProposalStage,
  ProposalStatus,
  VoteChoice,
  VotePhase,
  VotingType,
} from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FilteringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * §7.1 — draw reviewers for a proposal in FILTERING. MVP: random draw from the
   * round's eligible (admitted) DReps, excluding the submitter. (The opt-in pool,
   * subcategory match, and verifiable block-hash seed are deferred.) Idempotent.
   */
  async drawReviewers(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.stage !== ProposalStage.FILTERING || proposal.status !== ProposalStatus.ACTIVE) {
      throw new ConflictException('proposal is not in the FILTERING stage');
    }

    const existing = await this.prisma.filterAssignment.findMany({
      where: { proposalId, releasedAt: null },
    });
    if (existing.length > 0) return this.result(proposalId);

    const eligible = await this.prisma.roundDrepEligibility.findMany({
      where: { roundId: proposal.roundId ?? undefined, drep: { status: 'ADMITTED' } },
      select: { drepId: true },
    });
    let pool = eligible.map((e) => e.drepId).filter((id) => id !== proposal.submitterDrepId);
    if (pool.length === 0) throw new BadRequestException('no eligible reviewers in this round');

    const count = Math.min(await this.cfg('FILTER_REVIEWER_COUNT'), pool.length);
    const chosen: string[] = [];
    for (let i = 0; i < count; i++) {
      const j = randomInt(pool.length);
      chosen.push(pool[j]!);
      pool = pool.filter((_, k) => k !== j);
    }

    await this.prisma.filterAssignment.createMany({
      data: chosen.map((drepId) => ({ proposalId, drepId, acceptedAt: new Date() })),
    });
    return this.result(proposalId);
  }

  async myAssignments(userId: string) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) return [];
    const assignments = await this.prisma.filterAssignment.findMany({
      where: { drepId: drep.id, releasedAt: null, proposal: { stage: ProposalStage.FILTERING } },
      include: { proposal: { select: { id: true, title: true, status: true, stage: true } } },
    });
    const myVotes = await this.prisma.vote.findMany({
      where: { drepId: drep.id, phase: VotePhase.FILTERING, proposalId: { in: assignments.map((a) => a.proposalId) } },
    });
    return assignments.map((a) => ({
      proposalId: a.proposalId,
      title: a.proposal.title,
      myVote: myVotes.find((v) => v.proposalId === a.proposalId)?.choice ?? null,
    }));
  }

  /** §7.2 — assigned reviewer casts/changes a 1p1v filtering vote. NO requires rationale. */
  async vote(userId: string, proposalId: string, choice: string, rationale?: string) {
    if (!Object.values(VoteChoice).includes(choice as VoteChoice)) {
      throw new BadRequestException('choice must be YES, NO or ABSTAIN');
    }
    if (choice === VoteChoice.NO && !rationale?.trim()) {
      throw new BadRequestException('a NO vote requires written rationale');
    }
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.stage !== ProposalStage.FILTERING) {
      throw new ConflictException('proposal is not in the FILTERING stage');
    }
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new ForbiddenException('DReps only');
    const assignment = await this.prisma.filterAssignment.findFirst({
      where: { proposalId, drepId: drep.id, releasedAt: null },
    });
    if (!assignment) throw new ForbiddenException('you are not assigned to filter this proposal');

    const existing = await this.prisma.vote.findFirst({
      where: { proposalId, drepId: drep.id, phase: VotePhase.FILTERING },
    });
    if (existing) {
      await this.prisma.vote.update({ where: { id: existing.id }, data: { choice, rationale: rationale ?? null } });
    } else {
      await this.prisma.vote.create({
        data: { proposalId, drepId: drep.id, phase: VotePhase.FILTERING, choice, rationale: rationale ?? null },
      });
    }
    await this.maybeDecide(proposalId);
    return this.result(proposalId);
  }

  /** Apply §7.2 result: ≥ threshold YES → DEBATE_VOTE; ≥ threshold NO → REJECTED. */
  private async maybeDecide(proposalId: string) {
    const threshold = await this.cfg('FILTER_APPROVAL_VOTES');
    const votes = await this.prisma.vote.findMany({ where: { proposalId, phase: VotePhase.FILTERING } });
    const yes = votes.filter((v) => v.choice === VoteChoice.YES).length;
    const no = votes.filter((v) => v.choice === VoteChoice.NO).length;
    if (yes >= threshold) {
      await this.prisma.proposal.update({
        where: { id: proposalId },
        data: {
          stage: ProposalStage.DEBATE_VOTE,
          votingType: VotingType.BALANCED,
          approvalThresholdPct: await this.cfg('DV_APPROVAL_THRESHOLD_PCT'),
        },
      });
    } else if (no >= threshold) {
      await this.prisma.proposal.update({ where: { id: proposalId }, data: { status: ProposalStatus.REJECTED } });
    }
  }

  async result(proposalId: string) {
    const [assignments, votes, threshold, proposal] = await Promise.all([
      this.prisma.filterAssignment.count({ where: { proposalId, releasedAt: null } }),
      this.prisma.vote.findMany({ where: { proposalId, phase: VotePhase.FILTERING } }),
      this.cfg('FILTER_APPROVAL_VOTES'),
      this.prisma.proposal.findUnique({ where: { id: proposalId }, select: { status: true, stage: true } }),
    ]);
    return {
      reviewers: assignments,
      yes: votes.filter((v) => v.choice === VoteChoice.YES).length,
      no: votes.filter((v) => v.choice === VoteChoice.NO).length,
      abstain: votes.filter((v) => v.choice === VoteChoice.ABSTAIN).length,
      threshold,
      status: proposal?.status,
      stage: proposal?.stage,
    };
  }

  private async cfg(key: keyof typeof PLATFORM_CONFIG_DEFAULTS): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    const v = row?.value;
    return typeof v === 'number' ? v : (PLATFORM_CONFIG_DEFAULTS[key] as number);
  }
}
