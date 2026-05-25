import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ROUND_SETTING_DEFAULTS, ProposalStage, ProposalStatus, VoteChoice, VotePhase } from '@drep-dao/shared';
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorService } from '../cardano/anchor.service';

const LOVELACE = 1_000_000;

/**
 * §11 Funding stage — milestone review. After D&V approval the proposal is in
 * FUNDING; the board draws + confirms reviewers, the submitter posts a Proof of
 * Achievement per milestone, reviewers vote 1p1v (2-of-3 closes), and each
 * decision is anchored on-chain. When all milestones are approved the proposal is
 * COMPLETE. Real ADA disbursement is deferred to the on-chain treasury multisig.
 */
@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anchor: AnchorService,
  ) {}

  /** §11.1 — board draws + confirms reviewers for the proposal's milestones (idempotent). */
  async drawReviewers(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { milestones: true, round: { select: { milestoneReviewerCount: true } } },
    });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.status !== ProposalStatus.APPROVED || proposal.stage !== ProposalStage.FUNDING) {
      throw new ConflictException('proposal is not in the FUNDING stage');
    }
    const existing = await this.prisma.milestoneAssignment.findFirst({
      where: { milestone: { proposalId }, releasedAt: null },
    });
    if (existing) return this.forProposal(proposalId);

    const eligible = await this.prisma.roundDrepEligibility.findMany({
      where: { roundId: proposal.roundId ?? undefined, drep: { status: 'ADMITTED' } },
      select: { drepId: true },
    });
    let pool = eligible.map((e) => e.drepId).filter((id) => id !== proposal.submitterDrepId);
    if (pool.length === 0) throw new BadRequestException('no eligible reviewers in this round');
    // §6 — per-round override of the milestone reviewer count.
    const count = Math.min(proposal.round?.milestoneReviewerCount ?? ROUND_SETTING_DEFAULTS.milestoneReviewerCount, pool.length);
    const chosen: string[] = [];
    for (let i = 0; i < count; i++) {
      const j = randomInt(pool.length);
      chosen.push(pool[j]!);
      pool = pool.filter((_, k) => k !== j);
    }
    const now = new Date(); // board performed the draw → confirmed
    await this.prisma.milestoneAssignment.createMany({
      data: proposal.milestones.flatMap((m) =>
        chosen.map((drepId) => ({ milestoneId: m.id, reviewerDrepId: drepId, confirmedByBoardAt: now })),
      ),
    });
    return this.forProposal(proposalId);
  }

  /** Public — milestones with status, reviewers, latest POA, and the vote tally. */
  async forProposal(proposalId: string) {
    const milestones = await this.prisma.milestone.findMany({
      where: { proposalId },
      orderBy: { idx: 'asc' },
      include: {
        assignments: { where: { releasedAt: null }, include: { reviewerDrep: { select: { drepIdOnchain: true } } } },
        poas: { orderBy: { attempt: 'desc' }, take: 1 },
      },
    });
    const threshold = await this.milestoneThreshold(proposalId);
    return Promise.all(
      milestones.map(async (m) => {
        const votes = await this.voteList(m.id);
        return {
          id: m.id,
          idx: m.idx,
          description: m.description,
          amountAda: Number(m.amountAda) / LOVELACE,
          status: m.status,
          reviewers: m.assignments.map((a) => a.reviewerDrep?.drepIdOnchain).filter(Boolean),
          latestPoa: m.poas[0] ? { contentMd: m.poas[0].contentMd, submittedAt: m.poas[0].submittedAt, attempt: m.poas[0].attempt } : null,
          yes: votes.filter((v) => v.choice === VoteChoice.YES).length,
          no: votes.filter((v) => v.choice === VoteChoice.NO).length,
          threshold,
          votes,
          anchorTxHash: await this.milestoneAnchorTx(proposalId, m.idx),
        };
      }),
    );
  }

  /** Reviewer's open milestone assignments (POA submitted, not yet voted by them). */
  async myAssignments(userId: string) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) return [];
    const assignments = await this.prisma.milestoneAssignment.findMany({
      where: { reviewerDrepId: drep.id, releasedAt: null, milestone: { status: 'POA_SUBMITTED' } },
      include: { milestone: { include: { proposal: { select: { id: true, title: true } } } } },
    });
    const myVotes = await this.prisma.vote.findMany({
      where: { drepId: drep.id, phase: VotePhase.MILESTONE, milestoneId: { in: assignments.map((a) => a.milestoneId) } },
    });
    return assignments.map((a) => ({
      milestoneId: a.milestoneId,
      proposalId: a.milestone.proposal.id,
      proposalTitle: a.milestone.proposal.title,
      milestoneIdx: a.milestone.idx,
      myVote: myVotes.find((v) => v.milestoneId === a.milestoneId)?.choice ?? null,
    }));
  }

  /** §11.2 — submitter posts a Proof of Achievement for a milestone (resubmission allowed). */
  async submitPoa(userId: string, milestoneId: string, contentMd: string) {
    const m = await this.prisma.milestone.findUnique({ where: { id: milestoneId }, include: { proposal: true } });
    if (!m) throw new NotFoundException('milestone not found');
    if (m.proposal.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    if (m.proposal.stage !== ProposalStage.FUNDING) throw new ConflictException('proposal is not in the FUNDING stage');
    if (m.status === 'APPROVED') throw new ConflictException('milestone is already approved');

    const attempt = (await this.prisma.milestonePoa.count({ where: { milestoneId } })) + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.milestonePoa.create({ data: { milestoneId, contentMd, attempt } });
      // On resubmission, clear the prior review so reviewers vote on the new POA.
      if (attempt > 1) await tx.vote.deleteMany({ where: { milestoneId, phase: VotePhase.MILESTONE } });
      await tx.milestone.update({ where: { id: milestoneId }, data: { status: 'POA_SUBMITTED' } });
    });
    return this.result(milestoneId);
  }

  /** §11.3 — assigned reviewer (or a board member filling a missing 3rd) votes 1p1v. */
  async vote(userId: string, milestoneId: string, choice: string, rationale?: string) {
    if (choice !== VoteChoice.YES && choice !== VoteChoice.NO) {
      throw new BadRequestException('milestone vote must be YES or NO (no abstain)');
    }
    if (choice === VoteChoice.NO && !rationale?.trim()) throw new BadRequestException('a NO vote requires written feedback');
    const m = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!m) throw new NotFoundException('milestone not found');
    if (m.status !== 'POA_SUBMITTED') throw new ConflictException('milestone is not open for review (no current POA)');
    const drep = await this.prisma.drep.findUnique({ where: { userId }, include: { user: { select: { drepKeyHash: true } } } });
    if (!drep) throw new ForbiddenException('DReps only');
    const assigned = await this.prisma.milestoneAssignment.findFirst({ where: { milestoneId, reviewerDrepId: drep.id, releasedAt: null } });
    const board = drep.user.drepKeyHash ? await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: drep.user.drepKeyHash } }) : null;
    if (!assigned && !board) throw new ForbiddenException('you are not assigned to review this milestone');

    const existing = await this.prisma.vote.findFirst({ where: { milestoneId, drepId: drep.id, phase: VotePhase.MILESTONE } });
    if (existing) {
      await this.prisma.vote.update({ where: { id: existing.id }, data: { choice, rationale: rationale ?? null } });
    } else {
      await this.prisma.vote.create({ data: { proposalId: m.proposalId, milestoneId, drepId: drep.id, phase: VotePhase.MILESTONE, choice, rationale: rationale ?? null } });
    }
    await this.maybeDecide(milestoneId);
    return this.result(milestoneId);
  }

  async result(milestoneId: string) {
    const m = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!m) throw new NotFoundException('milestone not found');
    const votes = await this.voteList(milestoneId);
    const threshold = await this.milestoneThreshold(m.proposalId);
    return {
      milestoneId,
      idx: m.idx,
      status: m.status,
      yes: votes.filter((v) => v.choice === VoteChoice.YES).length,
      no: votes.filter((v) => v.choice === VoteChoice.NO).length,
      threshold,
      votes,
      anchorTxHash: await this.milestoneAnchorTx(m.proposalId, m.idx),
    };
  }

  /** §11 — board terminates a project (e.g. non-response) → FAILED. */
  async terminate(proposalId: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.stage !== ProposalStage.FUNDING) throw new ConflictException('only funding-stage proposals can be terminated');
    await this.prisma.proposal.update({ where: { id: proposalId }, data: { status: ProposalStatus.FAILED } });
    return { status: ProposalStatus.FAILED };
  }

  /** §11.4 — 2 YES → APPROVED (+ anchor); 2 NO → REJECTED (resubmit). All approved → proposal COMPLETE. */
  private async maybeDecide(milestoneId: string) {
    const m = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { proposal: { select: { id: true, title: true, roundId: true, round: { select: { number: true, name: true, milestoneApprovalVotes: true } } } } },
    });
    if (!m || m.status !== 'POA_SUBMITTED') return;
    const threshold = m.proposal.round?.milestoneApprovalVotes ?? ROUND_SETTING_DEFAULTS.milestoneApprovalVotes;
    const votes = await this.voteList(milestoneId);
    const yes = votes.filter((v) => v.choice === VoteChoice.YES).length;
    const no = votes.filter((v) => v.choice === VoteChoice.NO).length;
    let outcome: 'APPROVED' | 'REJECTED' | null = null;
    if (yes >= threshold) outcome = 'APPROVED';
    else if (no >= threshold) outcome = 'REJECTED';
    if (!outcome) return;

    await this.prisma.milestone.update({
      where: { id: milestoneId },
      data: { status: outcome, closedAt: outcome === 'APPROVED' ? new Date() : null },
    });

    try {
      await this.anchor.anchorResult({
        kind: 'milestone',
        subject: GovSubject.MILESTONE,
        style: VotingStyle.ONE_PERSON_ONE_VOTE,
        ref: `${m.proposal.title} · ${m.proposal.round?.name ?? `Round #${m.proposal.round?.number ?? '?'}`} · milestone #${m.idx + 1}`,
        proposalId: m.proposal.id,
        roundId: m.proposal.roundId,
        votes: votes.map((v) => ({ drep: v.drep, vote: v.choice })),
        preimageVotes: votes,
        outcome,
        yes,
        no,
        threshold,
      });
    } catch {
      /* anchoring failure must not undo the milestone decision */
    }

    if (outcome === 'APPROVED') {
      const remaining = await this.prisma.milestone.count({ where: { proposalId: m.proposal.id, status: { not: 'APPROVED' } } });
      if (remaining === 0) {
        await this.prisma.proposal.update({ where: { id: m.proposal.id }, data: { status: ProposalStatus.COMPLETE } });
      }
    }
  }

  private async voteList(milestoneId: string) {
    const votes = await this.prisma.vote.findMany({
      where: { milestoneId, phase: VotePhase.MILESTONE },
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

  /** Find the on-chain anchor tx for a specific milestone (matched by its readable ref). */
  private async milestoneAnchorTx(proposalId: string, idx: number): Promise<string | null> {
    const anchors = await this.prisma.anchor.findMany({ where: { proposalId, kind: 'milestone' }, orderBy: { createdAt: 'desc' } });
    const hit = anchors.find((a) => String((a.preimage as { ref?: string })?.ref ?? '').includes(`milestone #${idx + 1}`));
    return hit?.txHash ?? null;
  }

  /** §6 — per-round milestone approval threshold, else the ROUND_SETTING_DEFAULTS value. */
  private async milestoneThreshold(proposalId: string): Promise<number> {
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: { round: { select: { milestoneApprovalVotes: true } } } });
    return p?.round?.milestoneApprovalVotes ?? ROUND_SETTING_DEFAULTS.milestoneApprovalVotes;
  }
}
