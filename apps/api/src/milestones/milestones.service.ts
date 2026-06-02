import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ROUND_SETTING_DEFAULTS, ProposalStage, ProposalStatus, RoundStatus, VoteChoice, VotePhase } from '@drep-dao/shared';
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorService } from '../cardano/anchor.service';

const LOVELACE = 1_000_000;
/** §11 — board majority needed to APPROVE a stop-funding (1 member · 1 vote, 3-of-5 default). */
const STOP_FUNDING_THRESHOLD = 3;

/**
 * §11 Funding stage — milestone review.
 *
 * Flow once a proposal is in FUNDING:
 *   1. **Board allocates reviewers** for the proposal's milestones — they see candidate
 *      DReps ranked by expertise (subcategory overlap) + how many times each has been
 *      drawn in the round so far, and pick the configured number (`milestoneReviewerCount`).
 *      The board can re-allocate before any POA arrives.
 *   2. The submitter posts a Proof of Achievement per milestone (markdown). A POA is
 *      **immutable once submitted** — re-submission is allowed only after the milestone
 *      is REJECTED, so the next attempt incorporates the reviewers' feedback.
 *   3. Reviewers vote 1p1v (YES/NO; NO needs feedback). A board member may fill a
 *      missing 3rd. Threshold YES → APPROVED + on-chain anchor + a board PROJECT_FUNDING
 *      multisig action is auto-prepared so the board pays out the milestone budget.
 *      Threshold NO → REJECTED; the submitter may post a new POA.
 *   4. **Stop funding**: any assigned reviewer (or any board member, via a header
 *      button) may propose terminating the project. The board votes 1p1v; 3 YES →
 *      proposal status = FAILED and a stop-funding anchor is posted.
 *   5. All milestones APPROVED → proposal status = COMPLETE.
 *
 * Submission of POAs is gated to FUNDING — once the round closes (round.status=CLOSED),
 * no further POA may be posted; the board can still terminate / stop / pay out.
 */
@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anchor: AnchorService,
  ) {}

  // ===========================================================================
  // §11.1 Reviewer allocation — board-driven (replaces the old random draw)
  // ===========================================================================

  /**
   * Candidate DReps the board can pick from for THIS proposal's milestone reviews.
   * Ranked by: (a) expertise overlap with the proposal's subcategories first, then
   * (b) the DRep's milestone-review load so far in this round (least drawn first).
   * Each entry includes the load count + expertiseMatch flag so the board UI can
   * show meaningful badges next to every option. The submitter is excluded.
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

    // Equal-participation: per-DRep count of milestone assignments across the round.
    const roundProposalIds = (await this.prisma.proposal.findMany({
      where: { roundId: proposal.roundId ?? undefined },
      select: { id: true },
    })).map((p) => p.id);
    const loadRows = await this.prisma.milestoneAssignment.groupBy({
      by: ['reviewerDrepId'],
      where: { milestone: { proposalId: { in: roundProposalIds } }, releasedAt: null },
      _count: { _all: true },
    });
    const load = new Map(loadRows.filter((r) => r.reviewerDrepId).map((r) => [r.reviewerDrepId as string, r._count._all]));

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
   * Board picks the reviewers for this proposal — same set is assigned to every
   * milestone of the proposal (matches the design: a project has its review jury,
   * not per-milestone jurors). Count must match `milestoneReviewerCount` (per-round
   * override, else platform default). Idempotent: if any active assignment exists,
   * the call is rejected (call `release` first to re-allocate).
   */
  async assignReviewers(proposalId: string, drepIds: string[], boardUserId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { milestones: { select: { id: true } }, round: { select: { milestoneReviewerCount: true, status: true } } },
    });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.status !== ProposalStatus.APPROVED || proposal.stage !== ProposalStage.FUNDING) {
      throw new ConflictException('proposal is not in the FUNDING stage');
    }
    if (proposal.round && proposal.round.status !== RoundStatus.FUNDING) {
      throw new ConflictException('round is not in the FUNDING stage');
    }

    const want = proposal.round?.milestoneReviewerCount ?? ROUND_SETTING_DEFAULTS.milestoneReviewerCount;
    const unique = [...new Set(drepIds)];
    if (unique.length !== drepIds.length) throw new BadRequestException('duplicate DReps in the selection');
    if (unique.length !== want) {
      throw new BadRequestException(`please pick exactly ${want} reviewer${want === 1 ? '' : 's'} (you selected ${unique.length})`);
    }
    if (unique.includes(proposal.submitterDrepId ?? '')) {
      throw new BadRequestException('the submitter cannot review their own milestones');
    }

    // Validate each pick is an admitted, round-eligible DRep.
    const valid = new Set(
      (await this.prisma.roundDrepEligibility.findMany({
        where: { roundId: proposal.roundId ?? undefined, drepId: { in: unique }, drep: { status: 'ADMITTED' } },
        select: { drepId: true },
      })).map((e) => e.drepId),
    );
    const bad = unique.filter((id) => !valid.has(id));
    if (bad.length) throw new BadRequestException(`not an admitted reviewer for this round: ${bad.join(', ')}`);

    const hasActive = await this.prisma.milestoneAssignment.findFirst({
      where: { milestone: { proposalId }, releasedAt: null },
    });
    if (hasActive) throw new ConflictException('reviewers are already assigned — release them first to re-allocate');

    const now = new Date();
    await this.prisma.milestoneAssignment.createMany({
      data: proposal.milestones.flatMap((m) =>
        unique.map((drepId) => ({ milestoneId: m.id, reviewerDrepId: drepId, confirmedByBoardAt: now })),
      ),
    });
    void boardUserId; // recorded via the AdminAudit log middleware on the controller
    return this.forProposal(proposalId);
  }

  /** Release all reviewers (only allowed while no POA has been submitted on any milestone). */
  async releaseReviewers(proposalId: string) {
    const submitted = await this.prisma.milestone.count({
      where: { proposalId, status: { in: ['POA_SUBMITTED', 'APPROVED', 'REJECTED'] } },
    });
    if (submitted > 0) throw new ConflictException('cannot re-allocate: a milestone POA has already been submitted');
    await this.prisma.milestoneAssignment.updateMany({
      where: { milestone: { proposalId }, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    return { released: true };
  }

  // ===========================================================================
  // §11.2 POA + reviewer voting
  // ===========================================================================

  /** Public — milestones with status, reviewers, latest POA, the vote tally, and active stop-funding. */
  async forProposal(proposalId: string) {
    const milestones = await this.prisma.milestone.findMany({
      where: { proposalId },
      orderBy: { idx: 'asc' },
      include: {
        assignments: { where: { releasedAt: null }, include: { reviewerDrep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } } },
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
          title: m.title,
          description: m.description,
          acceptanceCriteria: m.acceptanceCriteria,
          amountAda: Number(m.amountAda) / LOVELACE,
          status: m.status,
          reviewers: m.assignments.map((a) => ({
            drepIdOnchain: a.reviewerDrep?.drepIdOnchain ?? null,
            displayName: a.reviewerDrep?.user?.displayName ?? null,
          })),
          latestPoa: m.poas[0] ? { contentMd: m.poas[0].contentMd, submittedAt: m.poas[0].submittedAt, attempt: m.poas[0].attempt } : null,
          poaCount: await this.prisma.milestonePoa.count({ where: { milestoneId: m.id } }),
          yes: votes.filter((v) => v.choice === VoteChoice.YES).length,
          no: votes.filter((v) => v.choice === VoteChoice.NO).length,
          threshold,
          votes,
          anchorTxHash: await this.milestoneAnchorTx(proposalId, m.idx),
        };
      }),
    );
  }

  /**
   * Reviewer's milestone assignments. Default: only those with a POA currently under
   * review (the to-do list). `history=true`: every milestone the reviewer was ever
   * assigned to, so they can recall how they voted on closed ones.
   */
  async myAssignments(userId: string, history = false) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) return [];
    const assignments = await this.prisma.milestoneAssignment.findMany({
      where: history
        ? { reviewerDrepId: drep.id }
        : { reviewerDrepId: drep.id, releasedAt: null, milestone: { status: 'POA_SUBMITTED' } },
      include: { milestone: { include: { proposal: { select: { id: true, title: true } } } } },
      orderBy: { assignedAt: 'desc' },
    });
    const myVotes = await this.prisma.vote.findMany({
      where: { drepId: drep.id, phase: VotePhase.MILESTONE, milestoneId: { in: assignments.map((a) => a.milestoneId) } },
    });
    return assignments.map((a) => ({
      milestoneId: a.milestoneId,
      proposalId: a.milestone.proposal.id,
      proposalTitle: a.milestone.proposal.title,
      milestoneIdx: a.milestone.idx,
      milestoneStatus: a.milestone.status,
      myVote: myVotes.find((v) => v.milestoneId === a.milestoneId)?.choice ?? null,
    }));
  }

  /**
   * §11.2 — submitter posts a Proof of Achievement for a milestone.
   * Gates:
   *   - proposal must be in FUNDING and its round still in FUNDING (no POAs once closed),
   *   - milestone must NOT be POA_SUBMITTED (immutable once submitted; reviewers vote on it),
   *   - APPROVED is final (no overwrite),
   *   - REJECTED → resubmission is allowed (incorporate the reviewers' feedback);
   *     prior votes are cleared so reviewers re-evaluate.
   *   - reviewers must already be allocated (board acts first).
   */
  async submitPoa(userId: string, milestoneId: string, contentMd: string) {
    const m = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        proposal: { include: { round: { select: { status: true } } } },
        assignments: { where: { releasedAt: null }, select: { id: true } },
      },
    });
    if (!m) throw new NotFoundException('milestone not found');
    if (m.proposal.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    if (m.proposal.stage !== ProposalStage.FUNDING) throw new ConflictException('proposal is not in the FUNDING stage');
    if (m.proposal.round && m.proposal.round.status !== RoundStatus.FUNDING) {
      throw new ConflictException('the round is not in the FUNDING stage — POAs are closed');
    }
    // §3 — pledge gate: a promised pledge must be confirmed on-chain by the board
    // before milestone POAs can be submitted (otherwise the team could draw funds
    // without ever posting collateral).
    if (m.proposal.pledgeAmountAda && m.proposal.pledgeAmountAda > 0n && !m.proposal.pledgeConfirmedAt) {
      throw new ConflictException(
        'the pledge payment must be confirmed by the board before milestone POAs can be submitted',
      );
    }
    // §3.4 — revenue-sharing gate: same pattern as the pledge gate. If the team
    // promised a revenue-sharing action (token contribution, etc.), the board
    // must verify it before milestone POAs can begin.
    if (m.proposal.revenueSharingRequired && !m.proposal.revenueSharingVerifiedAt) {
      throw new ConflictException(
        'the revenue-sharing conditions must be verified by the board before milestone POAs can be submitted',
      );
    }
    if (m.status === 'APPROVED') throw new ConflictException('milestone is already approved');
    if (m.status === 'POA_SUBMITTED') {
      throw new ConflictException('a POA is already under review — wait for the reviewers\' decision; only a REJECTED milestone can be re-submitted');
    }
    if (m.assignments.length === 0) {
      throw new ConflictException('the board has not allocated reviewers yet — please wait');
    }

    const attempt = (await this.prisma.milestonePoa.count({ where: { milestoneId } })) + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.milestonePoa.create({ data: { milestoneId, contentMd, attempt } });
      // On resubmission, clear the prior review so reviewers vote on the new POA.
      if (attempt > 1) await tx.vote.deleteMany({ where: { milestoneId, phase: VotePhase.MILESTONE } });
      await tx.milestone.update({ where: { id: milestoneId }, data: { status: 'POA_SUBMITTED' } });
    });
    return this.result(milestoneId);
  }

  /** §11.3 — assigned reviewer (or a board member filling a missing seat) votes 1p1v. */
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

  /** §11.4 — 2 YES → APPROVED (+ anchor + auto-prepare payout); 2 NO → REJECTED (resubmit). */
  private async maybeDecide(milestoneId: string) {
    const m = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { proposal: { select: { id: true, publicId: true, title: true, payoutAddress: true, roundId: true, round: { select: { number: true, name: true, milestoneApprovalVotes: true } } } } },
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
        publicId: m.proposal.publicId ?? null,
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
      // Auto-prepare a PROJECT_FUNDING multisig action so the board can sign & pay out
      // the milestone budget. This shows up in board "Actions" with a notification badge.
      await this.preparePayoutAction(m.proposal.id, m.id, m.idx, Number(m.amountAda) / LOVELACE, m.proposal.title, m.proposal.publicId, m.proposal.payoutAddress);
      const remaining = await this.prisma.milestone.count({ where: { proposalId: m.proposal.id, status: { not: 'APPROVED' } } });
      if (remaining === 0) {
        await this.prisma.proposal.update({ where: { id: m.proposal.id }, data: { status: ProposalStatus.COMPLETE } });
      }
    }
  }

  /**
   * Auto-prepare a PROJECT_FUNDING multisig action when a milestone is APPROVED, so it
   * appears in board "Actions to sign" right away. Idempotent — keyed by milestone idx
   * in the description so the same milestone isn't queued twice across re-runs.
   */
  private async preparePayoutAction(
    proposalId: string,
    milestoneId: string,
    idx: number,
    amountAda: number,
    title: string,
    publicId: string | null,
    payoutAddress: string | null,
  ) {
    void milestoneId;
    const tag = `milestone #${idx + 1} payout — ${publicId ?? title}`;
    const existing = await this.prisma.multisigAction.findFirst({
      where: { kind: 'PROJECT_FUNDING', description: { contains: tag } },
    });
    if (existing) return;
    const dest = payoutAddress ? ` → ${payoutAddress.slice(0, 16)}…` : '';
    await this.prisma.multisigAction.create({
      data: {
        kind: 'PROJECT_FUNDING',
        status: 'PENDING_SIGS',
        amountAda: BigInt(Math.round(amountAda * LOVELACE)),
        description: `${tag}: ${amountAda.toLocaleString()} ₳${dest} — milestone APPROVED, ready to disburse${proposalId ? '' : ''}`,
      },
    });
  }

  // ===========================================================================
  // §11 Stop-funding (reviewer + board can propose; board 1p1v decides)
  // ===========================================================================

  /**
   * Any assigned reviewer for the proposal — or any board member — can propose stopping
   * funding. Only one ACTIVE stop is allowed at a time per proposal (DB partial unique).
   * Reason is required: it's the basis for the board's vote and goes into the on-chain
   * preimage when a decision is reached.
   */
  async proposeStopFunding(userId: string, proposalId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('a written reason is required');
    const p = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { status: true } } },
    });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.stage !== ProposalStage.FUNDING || p.status !== ProposalStatus.APPROVED) {
      throw new ConflictException('only an APPROVED funding-stage proposal can be stop-funded');
    }
    if (p.round && p.round.status !== RoundStatus.FUNDING) {
      throw new ConflictException('the round is not in the FUNDING stage');
    }

    const drep = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    let role: 'REVIEWER' | 'BOARD' | null = null;
    const isBoard = drep?.user.drepKeyHash
      ? !!(await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: drep.user.drepKeyHash } }))
      : false;
    if (isBoard) role = 'BOARD';
    else if (drep) {
      const assigned = await this.prisma.milestoneAssignment.findFirst({
        where: { reviewerDrepId: drep.id, releasedAt: null, milestone: { proposalId } },
      });
      if (assigned) role = 'REVIEWER';
    }
    if (!role) throw new ForbiddenException('only assigned reviewers or board members may propose stopping funding');

    const open = await this.prisma.stopFundingProposal.findFirst({ where: { proposalId, status: 'ACTIVE' } });
    if (open) throw new ConflictException('a stop-funding vote is already open for this proposal');

    const created = await this.prisma.stopFundingProposal.create({
      data: {
        proposalId,
        proposerDrepId: drep?.id ?? null,
        proposerUserId: userId,
        proposerRole: role,
        reason: reason.trim(),
      },
    });
    return this.stopFundingDetail(created.id);
  }

  /** Withdraw an ACTIVE stop-funding (only the proposer may withdraw, before a decision). */
  async withdrawStopFunding(userId: string, stopId: string) {
    const s = await this.prisma.stopFundingProposal.findUnique({ where: { id: stopId } });
    if (!s) throw new NotFoundException('stop-funding not found');
    if (s.status !== 'ACTIVE') throw new ConflictException('stop-funding is no longer active');
    if (s.proposerUserId !== userId) throw new ForbiddenException('only the proposer may withdraw');
    await this.prisma.stopFundingProposal.update({ where: { id: stopId }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
    return this.stopFundingDetail(stopId);
  }

  /** Board member casts a 1p1v vote on the open stop-funding. NO requires rationale. */
  async voteStopFunding(userId: string, stopId: string, choice: string, rationale?: string) {
    if (choice !== VoteChoice.YES && choice !== VoteChoice.NO) {
      throw new BadRequestException('vote must be YES or NO (no abstain)');
    }
    if (choice === VoteChoice.NO && !rationale?.trim()) {
      throw new BadRequestException('a NO vote requires written rationale');
    }
    const drep = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    if (!drep?.user.drepKeyHash) throw new ForbiddenException('board members only');
    const seat = await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: drep.user.drepKeyHash } });
    if (!seat) throw new ForbiddenException('board members only');

    const s = await this.prisma.stopFundingProposal.findUnique({ where: { id: stopId } });
    if (!s) throw new NotFoundException('stop-funding not found');
    if (s.status !== 'ACTIVE') throw new ConflictException('stop-funding is no longer active');

    const existing = await this.prisma.stopFundingVote.findUnique({
      where: { stopId_boardDrepId: { stopId, boardDrepId: drep.id } },
    });
    if (existing) {
      await this.prisma.stopFundingVote.update({
        where: { stopId_boardDrepId: { stopId, boardDrepId: drep.id } },
        data: { choice, rationale: rationale ?? null },
      });
    } else {
      await this.prisma.stopFundingVote.create({
        data: { stopId, boardDrepId: drep.id, choice, rationale: rationale ?? null },
      });
    }
    await this.maybeDecideStopFunding(stopId);
    return this.stopFundingDetail(stopId);
  }

  /** Reach 3 YES → APPROVED + proposal FAILED + on-chain anchor; 3 NO → REJECTED. */
  private async maybeDecideStopFunding(stopId: string) {
    const s = await this.prisma.stopFundingProposal.findUnique({
      where: { id: stopId },
      include: {
        votes: true,
        proposal: { select: { id: true, publicId: true, title: true, roundId: true, round: { select: { number: true, name: true } } } },
      },
    });
    if (!s || s.status !== 'ACTIVE') return;
    const yes = s.votes.filter((v) => v.choice === VoteChoice.YES).length;
    const no = s.votes.filter((v) => v.choice === VoteChoice.NO).length;
    let outcome: 'APPROVED' | 'REJECTED' | null = null;
    if (yes >= STOP_FUNDING_THRESHOLD) outcome = 'APPROVED';
    else if (no >= STOP_FUNDING_THRESHOLD) outcome = 'REJECTED';
    if (!outcome) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.stopFundingProposal.update({ where: { id: stopId }, data: { status: outcome!, decidedAt: new Date() } });
      if (outcome === 'APPROVED') {
        await tx.proposal.update({ where: { id: s.proposalId }, data: { status: ProposalStatus.FAILED } });
      }
    });

    // Anchor every decided stop-funding (APPROVED or REJECTED) so the project's
    // termination event is part of the public, on-chain governance record.
    let anchorTxHash: string | null = null;
    try {
      const votes = s.votes.map((v) => ({ drep: v.boardDrepId, vote: v.choice, rationale: v.rationale ?? null }));
      const r = await this.anchor.anchorResult({
        kind: 'stop_funding',
        subject: GovSubject.STOP_FUNDING,
        style: VotingStyle.ONE_PERSON_ONE_VOTE,
        ref: `${s.proposal.title} · ${s.proposal.round?.name ?? `Round #${s.proposal.round?.number ?? '?'}`}`,
        proposalId: s.proposal.id,
        publicId: s.proposal.publicId ?? null,
        roundId: s.proposal.roundId,
        votes: votes.map((v) => ({ drep: v.drep, vote: v.vote })),
        preimageVotes: votes,
        outcome,
        yes,
        no,
        threshold: STOP_FUNDING_THRESHOLD,
      });
      anchorTxHash = r.txHash;
      await this.prisma.stopFundingProposal.update({ where: { id: stopId }, data: { anchorTxHash } });
    } catch {
      /* anchoring failure must not undo the decision */
    }
  }

  /** Public — the proposal's open + history of stop-funding records. */
  async stopFundingsForProposal(proposalId: string) {
    const rows = await this.prisma.stopFundingProposal.findMany({
      where: { proposalId },
      orderBy: { createdAt: 'desc' },
      include: {
        votes: { include: { voter: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } }, orderBy: { castAt: 'asc' } },
        proposerDrep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      proposerRole: r.proposerRole,
      proposerName: r.proposerDrep?.user?.displayName ?? null,
      proposerDrep: r.proposerDrep?.drepIdOnchain ?? null,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      anchorTxHash: r.anchorTxHash,
      threshold: STOP_FUNDING_THRESHOLD,
      yes: r.votes.filter((v) => v.choice === VoteChoice.YES).length,
      no: r.votes.filter((v) => v.choice === VoteChoice.NO).length,
      votes: r.votes.map((v) => ({
        drep: v.voter.drepIdOnchain,
        displayName: v.voter.user?.displayName ?? null,
        choice: v.choice,
        rationale: v.rationale,
      })),
    }));
  }

  private async stopFundingDetail(stopId: string) {
    const s = await this.prisma.stopFundingProposal.findUnique({ where: { id: stopId } });
    if (!s) throw new NotFoundException('stop-funding not found');
    const all = await this.stopFundingsForProposal(s.proposalId);
    return all.find((x) => x.id === stopId)!;
  }

  /** Board-wide list of every ACTIVE stop-funding (with the proposal + the board member's vote). */
  async activeStopFundingsForBoard(userId: string) {
    const drep = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    if (!drep?.user.drepKeyHash) return [];
    const seat = await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: drep.user.drepKeyHash } });
    if (!seat) return [];
    const active = await this.prisma.stopFundingProposal.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      include: {
        proposal: { select: { id: true, title: true, publicId: true, round: { select: { number: true, name: true } } } },
        proposerDrep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } },
        votes: { include: { voter: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } } },
      },
    });
    return active.map((s) => ({
      id: s.id,
      proposalId: s.proposal.id,
      proposalTitle: s.proposal.title,
      proposalPublicId: s.proposal.publicId ?? null,
      roundLabel: s.proposal.round?.name ?? (s.proposal.round?.number != null ? `Round #${s.proposal.round.number}` : null),
      proposerRole: s.proposerRole,
      proposerName: s.proposerDrep?.user?.displayName ?? null,
      proposerDrep: s.proposerDrep?.drepIdOnchain ?? null,
      reason: s.reason,
      createdAt: s.createdAt,
      threshold: STOP_FUNDING_THRESHOLD,
      yes: s.votes.filter((v) => v.choice === VoteChoice.YES).length,
      no: s.votes.filter((v) => v.choice === VoteChoice.NO).length,
      myChoice: s.votes.find((v) => v.boardDrepId === drep.id)?.choice ?? null,
      votes: s.votes.map((v) => ({
        drep: v.voter.drepIdOnchain,
        displayName: v.voter.user?.displayName ?? null,
        choice: v.choice,
        rationale: v.rationale,
      })),
    }));
  }

  /** Count board-pending stop-funding votes for this board member (drives notification badge). */
  async pendingStopFundingForBoard(userId: string): Promise<number> {
    const drep = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    if (!drep?.user.drepKeyHash) return 0;
    const seat = await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: drep.user.drepKeyHash } });
    if (!seat) return 0;
    const active = await this.prisma.stopFundingProposal.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    if (active.length === 0) return 0;
    const voted = new Set(
      (await this.prisma.stopFundingVote.findMany({
        where: { stopId: { in: active.map((a) => a.id) }, boardDrepId: drep.id },
        select: { stopId: true },
      })).map((v) => v.stopId),
    );
    return active.filter((a) => !voted.has(a.id)).length;
  }

  // ===========================================================================
  // helpers
  // ===========================================================================

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

  // Stop-funding threshold is a constant exported for the controller (1p1v, 3-of-5).
  stopFundingThreshold(): number { return STOP_FUNDING_THRESHOLD; }
}
