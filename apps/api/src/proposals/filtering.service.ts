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
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorService } from '../cardano/anchor.service';

@Injectable()
export class FilteringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anchor: AnchorService,
  ) {}

  /**
   * §7.1 — draw reviewers for a proposal in FILTERING. MVP: random draw from the
   * round's eligible (admitted) DReps, excluding the submitter. (The opt-in pool,
   * subcategory match, and verifiable block-hash seed are deferred.) Idempotent.
   */
  async drawReviewers(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { filterReviewerCount: true } } },
    });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.stage !== ProposalStage.FILTERING || proposal.status !== ProposalStatus.ACTIVE) {
      throw new ConflictException('proposal is not in the FILTERING stage');
    }

    const existing = await this.prisma.filterAssignment.findMany({
      where: { proposalId, releasedAt: null },
    });
    if (existing.length > 0) return this.result(proposalId);

    // §7.1 — eligible admitted DReps in the round, with their declared subcategories.
    const eligible = await this.prisma.roundDrepEligibility.findMany({
      where: { roundId: proposal.roundId ?? undefined, drep: { status: 'ADMITTED' } },
      select: { drepId: true, drep: { select: { subcategoryIds: true } } },
    });
    const cands = eligible.filter((e) => e.drepId !== proposal.submitterDrepId);
    if (cands.length === 0) throw new BadRequestException('no eligible reviewers in this round');

    // §7.1 equal-participation: how many times each DRep has been drawn this round.
    const roundProposals = await this.prisma.proposal.findMany({
      where: { roundId: proposal.roundId ?? undefined },
      select: { id: true },
    });
    const counts = await this.prisma.filterAssignment.groupBy({
      by: ['drepId'],
      where: { proposalId: { in: roundProposals.map((p) => p.id) } },
      _count: { _all: true },
    });
    const drawnCount = new Map(counts.map((c) => [c.drepId, c._count._all]));

    // §7.1 — prefer DReps whose subcategories overlap the proposal's; within a tier
    // prefer the least-drawn so far (equal participation), breaking ties randomly.
    const propSubs = new Set(proposal.subcategoryIds ?? []);
    const expertiseMatch = (subs: string[]) => propSubs.size > 0 && subs.some((s) => propSubs.has(s));
    const ranked = cands
      .map((e) => ({
        drepId: e.drepId,
        tier: expertiseMatch(e.drep.subcategoryIds) ? 0 : 1, // 0 = expertise match first
        drawn: drawnCount.get(e.drepId) ?? 0,
        rnd: randomInt(1_000_000),
      }))
      .sort((a, b) => a.tier - b.tier || a.drawn - b.drawn || a.rnd - b.rnd);
    // §6 — per-round override of the reviewer count, else the platform default.
    const count = Math.min(proposal.round?.filterReviewerCount ?? (await this.cfg('FILTER_REVIEWER_COUNT')), ranked.length);
    const chosen = ranked.slice(0, count).map((r) => r.drepId);

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

  /** Apply §7.2 result: ≥ threshold YES → DEBATE_VOTE; ≥ threshold NO → REJECTED. Anchors the decision. */
  private async maybeDecide(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { number: true, id: true, name: true, filterApprovalVotes: true, dvApprovalThresholdPct: true } } },
    });
    // Only decide once: skip if no longer an active filtering proposal.
    if (!proposal || proposal.status !== ProposalStatus.ACTIVE || proposal.stage !== ProposalStage.FILTERING) return;

    // §6 — per-round overrides of the filtering approval count + D&V threshold.
    const threshold = proposal.round?.filterApprovalVotes ?? (await this.cfg('FILTER_APPROVAL_VOTES'));
    const dvThresholdPct = proposal.round?.dvApprovalThresholdPct ?? (await this.cfg('DV_APPROVAL_THRESHOLD_PCT'));
    const votes = await this.prisma.vote.findMany({ where: { proposalId, phase: VotePhase.FILTERING } });
    const yes = votes.filter((v) => v.choice === VoteChoice.YES).length;
    const no = votes.filter((v) => v.choice === VoteChoice.NO).length;

    let outcome: 'ACCEPTED' | 'REJECTED' | null = null;
    if (yes >= threshold) {
      await this.prisma.proposal.update({
        where: { id: proposalId },
        data: {
          stage: ProposalStage.DEBATE_VOTE,
          votingType: VotingType.BALANCED,
          approvalThresholdPct: dvThresholdPct,
        },
      });
      outcome = 'ACCEPTED';
    } else if (no >= threshold) {
      await this.prisma.proposal.update({ where: { id: proposalId }, data: { status: ProposalStatus.REJECTED } });
      outcome = 'REJECTED';
    }
    if (!outcome) return;

    // §C — anchor the filtering decision on-chain (subject + every reviewer's vote + tally).
    try {
      const voteList = await this.anchorVoteList(proposalId);
      await this.anchor.anchorResult({
        kind: 'filtering',
        subject: GovSubject.FILTERING,
        style: VotingStyle.ONE_PERSON_ONE_VOTE,
        ref: `${proposal.title} · ${proposal.round?.name ?? `Round #${proposal.round?.number ?? '?'}`}`,
        proposalId,
        roundId: proposal.round?.id ?? proposal.roundId ?? null,
        votes: voteList.map((v) => ({ drep: v.drep, vote: v.choice })),
        preimageVotes: voteList,
        outcome,
        yes,
        no,
        threshold,
      });
    } catch (e) {
      // Anchoring must never undo the decision; it's recorded for retry by AnchorService.
    }
  }

  /** Reviewer votes with on-chain DRep id + rationale, latest per reviewer (for anchor + public view). */
  private async anchorVoteList(proposalId: string) {
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.FILTERING },
      include: { drep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } },
      orderBy: { castAt: 'asc' },
    });
    return votes.map((v) => ({
      drep: v.drep.drepIdOnchain,
      displayName: v.drep.user?.displayName ?? null,
      choice: v.choice,
      rationale: v.rationale ?? null,
    }));
  }

  async result(proposalId: string) {
    const [assignments, votes, proposal, voteList, anchor] = await Promise.all([
      this.prisma.filterAssignment.findMany({
        where: { proposalId, releasedAt: null },
        include: { drep: { select: { drepIdOnchain: true, subcategoryIds: true, user: { select: { displayName: true } } } } },
      }),
      this.prisma.vote.findMany({ where: { proposalId, phase: VotePhase.FILTERING } }),
      this.prisma.proposal.findUnique({
        where: { id: proposalId },
        select: { status: true, stage: true, subcategoryIds: true, round: { select: { filterApprovalVotes: true } } },
      }),
      this.anchorVoteList(proposalId),
      this.prisma.anchor.findFirst({ where: { proposalId, kind: 'filtering' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const threshold = proposal?.round?.filterApprovalVotes ?? (await this.cfg('FILTER_APPROVAL_VOTES'));
    const choiceByDrep = new Map(votes.map((v) => [v.drepId, v.choice]));
    const propSubs = new Set(proposal?.subcategoryIds ?? []);
    // §7.1 — who is assigned, whether they've voted yet, and if they matched the expertise.
    const assigned = assignments.map((a) => ({
      drep: a.drep.drepIdOnchain,
      displayName: a.drep.user?.displayName ?? null,
      voted: choiceByDrep.has(a.drepId),
      choice: choiceByDrep.get(a.drepId) ?? null,
      expertiseMatch: propSubs.size > 0 && a.drep.subcategoryIds.some((s) => propSubs.has(s)),
    }));
    return {
      reviewers: assignments.length,
      assigned,
      yes: votes.filter((v) => v.choice === VoteChoice.YES).length,
      no: votes.filter((v) => v.choice === VoteChoice.NO).length,
      abstain: votes.filter((v) => v.choice === VoteChoice.ABSTAIN).length,
      threshold,
      status: proposal?.status,
      stage: proposal?.stage,
      votes: voteList, // §7 public rationale: drep id, display name, choice, rationale
      anchorTxHash: anchor?.txHash ?? null,
      anchorHash: anchor?.hash ?? null,
    };
  }

  private async cfg(key: keyof typeof PLATFORM_CONFIG_DEFAULTS): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    const v = row?.value;
    return typeof v === 'number' ? v : (PLATFORM_CONFIG_DEFAULTS[key] as number);
  }
}
