import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ROUND_SETTING_DEFAULTS,
  ProposalStage,
  ProposalStatus,
  RoundStatus,
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
    const count = Math.min(proposal.round?.filterReviewerCount ?? ROUND_SETTING_DEFAULTS.filterReviewerCount, ranked.length);
    const chosen = ranked.slice(0, count).map((r) => r.drepId);

    await this.prisma.filterAssignment.createMany({
      data: chosen.map((drepId) => ({ proposalId, drepId, acceptedAt: new Date() })),
    });
    return this.result(proposalId);
  }

  async myAssignments(userId: string, history = false) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) return [];
    // Default view: only proposals still open for filtering — a decided one (REJECTED /
    // advanced) is no longer actionable, so it shouldn't sit in the reviewer's to-do
    // list. `history=true` returns ALL of the reviewer's past filtering assignments so
    // they can recall how they voted on a closed round's proposals.
    const assignments = await this.prisma.filterAssignment.findMany({
      where: history
        ? { drepId: drep.id }
        : {
            drepId: drep.id,
            releasedAt: null,
            // §3 — only show when the ROUND is in FILTERING; while the round is still in
            // SUBMISSION the assignment exists (pre-assigned) but the reviewer can't vote.
            proposal: {
              stage: ProposalStage.FILTERING,
              status: ProposalStatus.ACTIVE,
              round: { status: RoundStatus.FILTERING },
            },
          },
      include: { proposal: { select: { id: true, title: true, status: true, stage: true } } },
      orderBy: { assignedAt: 'desc' },
    });
    const myVotes = await this.prisma.vote.findMany({
      where: { drepId: drep.id, phase: VotePhase.FILTERING, proposalId: { in: assignments.map((a) => a.proposalId) } },
    });
    return assignments.map((a) => ({
      proposalId: a.proposalId,
      title: a.proposal.title,
      myVote: myVotes.find((v) => v.proposalId === a.proposalId)?.choice ?? null,
      proposalStatus: a.proposal.status,
      proposalStage: a.proposal.stage,
    }));
  }

  /**
   * Count the items awaiting THIS user across the "Voting & reviews" tab — open filtering
   * assignments, open D&V proposals they're eligible for, and open milestone reviews — each
   * not yet voted on. Powers the tab's red badge + the login notification routing.
   */
  async votingTasksCount(userId: string) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) return { filtering: 0, dv: 0, milestone: 0, total: 0 };

    const fAssign = await this.prisma.filterAssignment.findMany({
      // §3/§5 — only count tasks where the ROUND is in FILTERING (voting open).
      // During SUBMISSION, reviewers may already be assigned but voting is closed,
      // so we don't ping DReps to vote until the round actually opens it.
      where: {
        drepId: drep.id,
        releasedAt: null,
        proposal: {
          stage: ProposalStage.FILTERING,
          status: ProposalStatus.ACTIVE,
          round: { status: RoundStatus.FILTERING },
        },
      },
      select: { proposalId: true },
    });
    const fVoted = new Set(
      (await this.prisma.vote.findMany({
        where: { drepId: drep.id, phase: VotePhase.FILTERING, proposalId: { in: fAssign.map((a) => a.proposalId) } },
        select: { proposalId: true },
      })).map((v) => v.proposalId),
    );
    const filtering = fAssign.filter((a) => !fVoted.has(a.proposalId)).length;

    const dvEntries = await this.prisma.voteSnapshotEntry.findMany({
      where: { drepId: drep.id, snapshot: { proposal: { stage: ProposalStage.DEBATE_VOTE, status: ProposalStatus.ACTIVE } } },
      select: { snapshot: { select: { proposalId: true } } },
    });
    const dvProps = [...new Set(dvEntries.map((e) => e.snapshot.proposalId))];
    const dvVoted = new Set(
      (await this.prisma.vote.findMany({
        where: { drepId: drep.id, phase: VotePhase.DEBATE_VOTE, proposalId: { in: dvProps } },
        select: { proposalId: true },
      })).map((v) => v.proposalId),
    );
    const dv = dvProps.filter((pid) => !dvVoted.has(pid)).length;

    const mAssign = await this.prisma.milestoneAssignment.findMany({
      where: { reviewerDrepId: drep.id, releasedAt: null, milestone: { status: 'POA_SUBMITTED' } },
      select: { milestoneId: true },
    });
    const mVoted = new Set(
      (await this.prisma.vote.findMany({
        where: { drepId: drep.id, phase: VotePhase.MILESTONE, milestoneId: { in: mAssign.map((a) => a.milestoneId) } },
        select: { milestoneId: true },
      })).map((v) => v.milestoneId),
    );
    const milestone = mAssign.filter((a) => !mVoted.has(a.milestoneId)).length;

    return { filtering, dv, milestone, total: filtering + dv + milestone };
  }

  /** §7.2 — assigned reviewer casts/changes a 1p1v filtering vote. NO requires rationale. */
  async vote(userId: string, proposalId: string, choice: string, rationale?: string) {
    if (!Object.values(VoteChoice).includes(choice as VoteChoice)) {
      throw new BadRequestException('choice must be YES, NO or ABSTAIN');
    }
    if (choice === VoteChoice.NO && !rationale?.trim()) {
      throw new BadRequestException('a NO vote requires written rationale');
    }
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { status: true } } },
    });
    if (!proposal || proposal.stage !== ProposalStage.FILTERING) {
      throw new ConflictException('proposal is not in the FILTERING stage');
    }
    // §3/§5 — voting is only open once the ROUND is in the FILTERING stage. During
    // SUBMISSION, reviewers may be pre-assigned (so juries are ready) but cannot
    // cast votes yet. The board moves the round to FILTERING when SUBMISSION ends.
    if (proposal.round && proposal.round.status !== RoundStatus.FILTERING) {
      throw new ConflictException(
        `filtering voting is closed — the round is in ${proposal.round.status}, not FILTERING`,
      );
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
    const threshold = proposal.round?.filterApprovalVotes ?? ROUND_SETTING_DEFAULTS.filterApprovalVotes;
    const dvThresholdPct = proposal.round?.dvApprovalThresholdPct ?? ROUND_SETTING_DEFAULTS.dvApprovalThresholdPct;
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
        publicId: proposal.publicId ?? null,
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
    const threshold = proposal?.round?.filterApprovalVotes ?? ROUND_SETTING_DEFAULTS.filterApprovalVotes;
    const choiceByDrep = new Map(votes.map((v) => [v.drepId, v.choice]));
    const propSubs = new Set(proposal?.subcategoryIds ?? []);
    // §7.1 — who is assigned, whether they've voted yet, and if they matched the expertise.
    const assigned = assignments.map((a) => ({
      drepId: a.drepId, // internal UUID — used by the board's "Change" action
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

  /**
   * §7.1 — board view: every admitted DRep eligible to filter this proposal, with
   * (a) expertise overlap with the proposal's subcategories, (b) the DRep's load
   * across the round so far (how many filterings they're already on), (c) whether
   * they're currently assigned to THIS proposal, and (d) whether they've already
   * voted (vote is final — can't be reassigned). The submitter is excluded. Used
   * by the board's "Change reviewer" picker on the proposal page.
   */
  async candidates(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, subcategoryIds: true, submitterDrepId: true, roundId: true },
    });
    if (!proposal) throw new NotFoundException('proposal not found');

    const eligible = await this.prisma.roundDrepEligibility.findMany({
      where: { roundId: proposal.roundId ?? undefined, drep: { status: 'ADMITTED' } },
      include: { drep: { select: { id: true, drepIdOnchain: true, subcategoryIds: true, user: { select: { displayName: true } } } } },
    });

    // Load count = how many filtering assignments the DRep has across the round.
    const roundProposalIds = (await this.prisma.proposal.findMany({
      where: { roundId: proposal.roundId ?? undefined },
      select: { id: true },
    })).map((p) => p.id);
    const loadRows = await this.prisma.filterAssignment.groupBy({
      by: ['drepId'],
      where: { proposalId: { in: roundProposalIds }, releasedAt: null },
      _count: { _all: true },
    });
    const load = new Map(loadRows.map((r) => [r.drepId, r._count._all]));

    // Currently-assigned + voted state for THIS proposal only.
    const active = await this.prisma.filterAssignment.findMany({
      where: { proposalId, releasedAt: null },
      select: { drepId: true },
    });
    const activeSet = new Set(active.map((a) => a.drepId));
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.FILTERING },
      select: { drepId: true },
    });
    const votedSet = new Set(votes.map((v) => v.drepId));

    const propSubs = new Set(proposal.subcategoryIds ?? []);
    const out = eligible
      .filter((e) => e.drepId !== proposal.submitterDrepId)
      .map((e) => {
        const match = propSubs.size > 0 && e.drep.subcategoryIds.some((s) => propSubs.has(s));
        return {
          drepId: e.drep.id,
          drepIdOnchain: e.drep.drepIdOnchain,
          displayName: e.drep.user?.displayName ?? null,
          subcategoryIds: e.drep.subcategoryIds,
          expertiseMatch: !!match,
          loadInRound: load.get(e.drep.id) ?? 0,
          alreadyAssigned: activeSet.has(e.drep.id),
          alreadyVoted: votedSet.has(e.drep.id),
        };
      })
      .sort((a, b) =>
        Number(b.expertiseMatch) - Number(a.expertiseMatch) ||
        a.loadInRound - b.loadInRound ||
        (a.displayName ?? '').localeCompare(b.displayName ?? ''),
      );
    return out;
  }

  /**
   * §7.1 — board swaps one assigned reviewer for another on a proposal still in
   * FILTERING. Gated: the old reviewer must currently be assigned AND must not
   * have voted yet (a cast vote is final); the new DRep must be eligible for the
   * round, not the submitter, and not already on this proposal. Soft-releases the
   * old assignment (`releasedAt = now`, `replacedBy = newDrepId`) and creates a
   * fresh assignment for the new DRep.
   */
  async replaceReviewer(proposalId: string, oldDrepId: string, newDrepId: string, _userId: string) {
    void _userId;
    if (oldDrepId === newDrepId) {
      throw new BadRequestException('the replacement DRep must be different');
    }
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, status: true, stage: true, roundId: true, submitterDrepId: true },
    });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.stage !== ProposalStage.FILTERING || proposal.status !== ProposalStatus.ACTIVE) {
      throw new ConflictException('proposal is not in the FILTERING stage');
    }

    const oldAssignment = await this.prisma.filterAssignment.findFirst({
      where: { proposalId, drepId: oldDrepId, releasedAt: null },
    });
    if (!oldAssignment) {
      throw new ConflictException('that DRep is not currently assigned to this proposal');
    }
    // Vote is final — can't swap a reviewer who's already cast it.
    const alreadyVoted = await this.prisma.vote.findFirst({
      where: { proposalId, drepId: oldDrepId, phase: VotePhase.FILTERING },
    });
    if (alreadyVoted) {
      throw new ConflictException('this reviewer has already voted — their vote is final and cannot be replaced');
    }
    // The replacement must be eligible for the round + not the submitter + not already on this proposal.
    if (newDrepId === proposal.submitterDrepId) {
      throw new BadRequestException('the submitter cannot review their own proposal');
    }
    const eligibleRow = await this.prisma.roundDrepEligibility.findUnique({
      where: { roundId_drepId: { roundId: proposal.roundId!, drepId: newDrepId } },
      include: { drep: { select: { status: true } } },
    });
    if (!eligibleRow || eligibleRow.drep.status !== 'ADMITTED') {
      throw new BadRequestException('replacement is not an admitted DRep eligible for this round');
    }
    const conflict = await this.prisma.filterAssignment.findFirst({
      where: { proposalId, drepId: newDrepId, releasedAt: null },
    });
    if (conflict) {
      throw new BadRequestException('that DRep is already assigned to this proposal');
    }

    await this.prisma.$transaction([
      this.prisma.filterAssignment.update({
        where: { id: oldAssignment.id },
        data: { releasedAt: new Date(), replacedBy: newDrepId },
      }),
      this.prisma.filterAssignment.create({
        data: { proposalId, drepId: newDrepId, acceptedAt: new Date() },
      }),
    ]);
    return this.result(proposalId);
  }
}
