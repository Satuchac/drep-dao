import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  basePower,
  clampMerit,
  isApproved,
  approvalRatio,
  meritMultiplier,
  PLATFORM_CONFIG_DEFAULTS,
  ProposalStage,
  ProposalStatus,
  RoundStatus,
  ROUND_SETTING_DEFAULTS,
  VoteChoice,
  VotePhase,
} from '@drep-dao/shared';
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorService } from '../cardano/anchor.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';

const LOVELACE = 1_000_000n;

@Injectable()
export class DvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly anchor: AnchorService,
    private readonly cardano: CardanoQueryService,
  ) {}

  /**
   * §4.3 — take the voting-power snapshot and open D&V voting. Idempotent.
   * Each voter's power = log10(their REAL on-chain CIP-1694 voting power in ADA) ×
   * merit multiplier — the SAME computation as the members overview, so the numbers
   * match. If a DRep has no on-chain delegation yet, their stake falls back to a
   * nominal value (DV_SNAPSHOT_STAKE_ADA) so they aren't powerless in the demo.
   */
  async openVoting(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { status: true } } },
    });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.stage !== ProposalStage.DEBATE_VOTE) {
      throw new ConflictException('proposal is not in the DEBATE_VOTE stage');
    }
    // The proposal's stage flips to DEBATE_VOTE the moment it passes filtering.
    // §8 — the round-level "Debate & Vote" is now two sub-stages: DEBATE (comments
    // + revisions, no ballots) → VOTE (ballots open). Voting must wait until the
    // round advances to VOTE — comments during DEBATE go through CommentsModule,
    // not here. DV is the deprecated alias and is accepted as if it were VOTE.
    if (proposal.round && proposal.round.status !== RoundStatus.VOTE && proposal.round.status !== RoundStatus.DV) {
      throw new ConflictException(
        `round is in ${proposal.round.status}; Debate & Vote ballots open when the round advances to VOTE`,
      );
    }

    const existing = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    if (existing) return this.result(proposalId);

    // §8.2 — voters are EVERY admitted DRep eligible for the round (board +
    // non-board). The per-board-member opt-out is enforced LIVE via the
    // `votesOnFundingProposals` flag on Drep, not via the snapshot, so flipping
    // the toggle off mid-vote zeroes that member's contribution without
    // mutating the snapshot, and flipping it back on restores it instantly.
    const eligible = await this.prisma.roundDrepEligibility.findMany({
      where: { roundId: proposal.roundId ?? undefined, drep: { status: 'ADMITTED' } },
      select: { drepId: true, drep: { select: { drepIdOnchain: true } } },
    });

    const power = await this.realVotingPower(eligible.map((v) => v.drep.drepIdOnchain));
    const snapshot = await this.prisma.voteSnapshot.create({ data: { proposalId } });
    for (const v of eligible) await this.addSnapshotEntry(snapshot.id, v.drepId, power.get(v.drep.drepIdOnchain) ?? 0n);
    await this.prisma.proposal.update({ where: { id: proposalId }, data: { votingStartAt: new Date() } });
    return this.result(proposalId);
  }

  /**
   * §8 — called by the round-transition flow when a round enters VOTE. Refreshes
   * every DEBATE_VOTE-stage proposal in the round: clears any pre-VOTE snapshot
   * + DV vote records (those were stale per §8.2 — see the historical opt-in
   * model), then takes a fresh snapshot capturing the full current electorate
   * (admitted DReps + opted-in board members). Auto-opens voting so the board
   * doesn't have to click "open voting" on each proposal manually.
   */
  async openVotingForRound(roundId: string) {
    const proposals = await this.prisma.proposal.findMany({
      where: { roundId, stage: ProposalStage.DEBATE_VOTE, status: ProposalStatus.ACTIVE },
      select: { id: true },
    });
    for (const p of proposals) {
      const stale = await this.prisma.voteSnapshot.findMany({
        where: { proposalId: p.id },
        select: { id: true },
      });
      if (stale.length > 0) {
        await this.prisma.$transaction(async (tx) => {
          await tx.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: stale.map((s) => s.id) } } });
          await tx.voteSnapshot.deleteMany({ where: { proposalId: p.id } });
        });
      }
      // DV votes pre-snapshot-refresh would be against a deleted snapshot; clear
      // them too. (Vote rows reference proposalId + drepId, not the snapshot,
      // so removing votes here is the safe equivalent of "start the tally over".)
      await this.prisma.vote.deleteMany({ where: { proposalId: p.id, phase: VotePhase.DEBATE_VOTE } });
      await this.openVoting(p.id);
    }
  }

  /**
   * §9.3 — called by the round-transition flow when the VOTE stage ends (round
   * moves to FUNDING). Finalizes every DEBATE_VOTE-stage proposal in the round
   * — APPROVED if threshold met, REJECTED otherwise. The finalize() guard that
   * refuses mid-VOTE doesn't apply here because we're called AFTER the round
   * left VOTE (round.status === FUNDING when this runs).
   */
  async finalizeRound(roundId: string) {
    const proposals = await this.prisma.proposal.findMany({
      where: { roundId, stage: ProposalStage.DEBATE_VOTE, status: ProposalStatus.ACTIVE },
      select: { id: true },
    });
    for (const p of proposals) {
      try {
        await this.finalize(p.id);
      } catch (e) {
        // Skip any that can't be finalized (e.g. no snapshot — shouldn't happen
        // after openVotingForRound but defensive). The board sees the proposal
        // still ACTIVE+DEBATE_VOTE and can manually finalize it.
        void e;
      }
    }
  }

  /** §8.2 — a board member opts in to vote on this funding proposal (adds them to the snapshot if open). */
  async optIn(userId: string, proposalId: string) {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, include: { user: { select: { drepKeyHash: true } } } });
    if (!drep) throw new ForbiddenException('DReps only');
    const seat = drep.user.drepKeyHash ? await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: drep.user.drepKeyHash } }) : null;
    if (!seat) throw new ForbiddenException('only board members opt in; admitted DReps vote by default');
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.stage !== ProposalStage.DEBATE_VOTE) throw new ConflictException('proposal is not in the DEBATE_VOTE stage');

    await this.prisma.dvBoardOptIn.upsert({
      where: { proposalId_drepId: { proposalId, drepId: drep.id } },
      update: {},
      create: { proposalId, drepId: drep.id },
    });
    // If voting already opened, add them to the live snapshot so they can vote now.
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    if (snapshot) {
      const has = await this.prisma.voteSnapshotEntry.findUnique({ where: { snapshotId_drepId: { snapshotId: snapshot.id, drepId: drep.id } } });
      if (!has) {
        const power = await this.realVotingPower([drep.drepIdOnchain]);
        await this.addSnapshotEntry(snapshot.id, drep.id, power.get(drep.drepIdOnchain) ?? 0n);
      }
    }
    return this.result(proposalId);
  }

  /** Real on-chain CIP-1694 voting power (lovelace) per DRep id; falls back to a nominal stake if 0. */
  private async realVotingPower(drepIds: string[]): Promise<Map<string, bigint>> {
    const fallback = toLovelaceAda(Number(this.config.get('DV_SNAPSHOT_STAKE_ADA') ?? 1_000_000));
    const out = new Map<string, bigint>();
    try {
      const vp = await this.cardano.drepVotingPower(drepIds);
      for (const id of drepIds) {
        const lovelace = vp.get(id)?.votingPowerLovelace ?? 0n;
        out.set(id, lovelace > 0n ? lovelace : fallback);
      }
    } catch {
      for (const id of drepIds) out.set(id, fallback); // Koios hiccup → nominal so voting still works
    }
    return out;
  }

  private async addSnapshotEntry(snapshotId: string, drepId: string, stakeLovelace: bigint) {
    const max = await this.meritMax();
    const merit = await this.currentMerit(drepId, max);
    const bp = basePower(stakeLovelace);
    const mm = meritMultiplier(merit, max);
    await this.prisma.voteSnapshotEntry.create({
      data: { snapshotId, drepId, stakeLovelace, meritPoints: merit, basePower: bp, meritMultiplier: mm, finalPower: bp * mm },
    });
  }

  /** §13 merit cap (runtime-configurable via MERIT_POINT_MAX). */
  private async meritMax(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'MERIT_POINT_MAX' } });
    return typeof row?.value === 'number' ? row.value : PLATFORM_CONFIG_DEFAULTS.MERIT_POINT_MAX;
  }

  /** §8.2 — eligible DRep casts/changes a balanced D&V vote (rationale mandatory). */
  async vote(userId: string, proposalId: string, choice: string, rationale: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { status: true } } },
    });
    if (!proposal || proposal.stage !== ProposalStage.DEBATE_VOTE) {
      throw new ConflictException('proposal is not in the DEBATE_VOTE stage');
    }
    if (proposal.round && proposal.round.status !== RoundStatus.VOTE && proposal.round.status !== RoundStatus.DV) {
      throw new ConflictException(
        `round is in ${proposal.round.status}; Debate & Vote ballots are accepted only while the round is in VOTE`,
      );
    }
    const drep = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    if (!drep) throw new ForbiddenException('DReps only');

    // §8.2 — a board member who has opted out of voting on funding D&V cannot
    // cast a ballot. The setting is on by default and toggleable from their
    // profile. Non-board DReps are unaffected.
    if (!drep.votesOnFundingProposals) {
      const seat = drep.user.drepKeyHash
        ? await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: drep.user.drepKeyHash } })
        : null;
      if (seat) {
        throw new ForbiddenException(
          'you have opted out of voting on funding proposals — enable it in your profile to cast a ballot',
        );
      }
    }

    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    if (!snapshot) throw new ConflictException('voting has not opened yet');
    const entry = await this.prisma.voteSnapshotEntry.findUnique({
      where: { snapshotId_drepId: { snapshotId: snapshot.id, drepId: drep.id } },
    });
    if (!entry) throw new ForbiddenException('you are not eligible to vote in this round');

    const existing = await this.prisma.vote.findFirst({
      where: { proposalId, drepId: drep.id, phase: VotePhase.DEBATE_VOTE },
    });
    if (existing) {
      await this.prisma.vote.update({ where: { id: existing.id }, data: { choice, rationale } });
    } else {
      await this.prisma.vote.create({
        data: { proposalId, drepId: drep.id, phase: VotePhase.DEBATE_VOTE, choice, rationale },
      });
    }
    return this.result(proposalId);
  }

  /** §4.4 tally against the frozen snapshot; missing-no-avoid = implicit NO. */
  async result(proposalId: string) {
    const snapshot = await this.prisma.voteSnapshot.findFirst({
      where: { proposalId },
      include: { entries: true },
    });
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { status: true, stage: true, approvalThresholdPct: true },
    });
    if (!snapshot) {
      return { open: false, status: proposal?.status, stage: proposal?.stage };
    }
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.DEBATE_VOTE },
    });
    const choiceByDrep = new Map(votes.map((v) => [v.drepId, v.choice]));

    // §8.2 — board members who have toggled OFF voteOnFundingProposals are
    // skipped at tally time (their snapshot entry contributes 0 to YES /
    // denominator / eligible count). The snapshot itself is never mutated —
    // toggling the flag back on instantly restores their weight on the next
    // tally read.
    const drepIds = snapshot.entries.map((e) => e.drepId);
    const dreps = await this.prisma.drep.findMany({
      where: { id: { in: drepIds } },
      select: { id: true, votesOnFundingProposals: true, user: { select: { drepKeyHash: true } } },
    });
    const boardHashes = new Set(
      (await this.prisma.boardSeat.findMany({ select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    const skipDrepIds = new Set(
      dreps
        .filter((d) => !d.votesOnFundingProposals && d.user.drepKeyHash && boardHashes.has(d.user.drepKeyHash))
        .map((d) => d.id),
    );

    let yesPower = 0;
    let abstainPower = 0;
    let totalPower = 0;
    let cast = 0;
    let eligibleCount = 0;
    for (const e of snapshot.entries) {
      if (skipDrepIds.has(e.drepId)) continue; // board member opted out → effective abstain (zero weight)
      eligibleCount++;
      const fp = Number(e.finalPower ?? 0);
      totalPower += fp;
      const c = choiceByDrep.get(e.drepId);
      if (c) cast++;
      if (c === VoteChoice.YES) yesPower += fp;
      else if (c === VoteChoice.ABSTAIN) abstainPower += fp;
      // NO or missing → counts in denominator (implicit NO), not in yes/abstain
    }
    const thresholdPct = proposal?.approvalThresholdPct
      ? Number(proposal.approvalThresholdPct)
      : ROUND_SETTING_DEFAULTS.dvApprovalThresholdPct;
    const tally = { yesPower, totalPower, abstainPower, thresholdPct };

    const anchor = await this.prisma.anchor.findFirst({ where: { proposalId, kind: 'dv' }, orderBy: { createdAt: 'desc' } });
    return {
      open: true,
      eligible: eligibleCount,
      cast,
      yesPower: round2(yesPower),
      abstainPower: round2(abstainPower),
      totalPower: round2(totalPower),
      denominator: round2(totalPower - abstainPower),
      ratioPct: round2(approvalRatio(tally) * 100),
      thresholdPct,
      approved: isApproved(tally),
      status: proposal?.status,
      stage: proposal?.stage,
      votes: await this.dvVoteList(proposalId), // §8 public rationale + weight per voter
      anchorTxHash: anchor?.txHash ?? null,
      anchorHash: anchor?.hash ?? null,
    };
  }

  /**
   * §9.3 — finalize the tally and publish the result. APPROVED if threshold met,
   * else REJECTED. Anchors the result on-chain. Refuses while the round is still
   * in VOTE — finalizing mid-vote would publish a half-counted result based on
   * implicit-NO from voters who simply haven't voted yet. The board advances the
   * round to FUNDING (or the VOTE window expires) and finalize is auto-triggered
   * from the round-transition flow then.
   */
  async finalize(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { status: true } } },
    });
    if (!proposal) throw new BadRequestException('proposal not found');
    if (proposal.round?.status === RoundStatus.VOTE) {
      throw new ConflictException(
        'voting is still in progress (round is in VOTE); the tally is finalized automatically when the round advances to FUNDING',
      );
    }
    const r = await this.result(proposalId);
    if (!('open' in r) || !r.open) throw new BadRequestException('voting has not opened');
    const status = r.approved ? ProposalStatus.APPROVED : ProposalStatus.REJECTED;
    const stage = status === ProposalStatus.APPROVED ? ProposalStage.FUNDING : null;
    await this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status, stage, resultFinalizedAt: new Date() },
    });

    // §9.3 — the publish action anchors the final tally on-chain.
    try {
      const proposal = await this.prisma.proposal.findUnique({
        where: { id: proposalId },
        include: { round: { select: { number: true, id: true, name: true } } },
      });
      const voteList = await this.dvVoteList(proposalId);
      const noPower = Math.max(0, (r.totalPower ?? 0) - (r.yesPower ?? 0) - (r.abstainPower ?? 0));
      await this.anchor.anchorResult({
        kind: 'dv',
        subject: GovSubject.DV,
        style: VotingStyle.BALANCED,
        ref: `${proposal?.title ?? 'proposal'} · ${proposal?.round?.name ?? `Round #${proposal?.round?.number ?? '?'}`}`,
        proposalId,
        publicId: proposal?.publicId ?? null,
        roundId: proposal?.round?.id ?? proposal?.roundId ?? null,
        votes: voteList.map((v) => ({ drep: v.drep, vote: v.choice, power: v.weight })),
        preimageVotes: voteList,
        outcome: status,
        yes: round2(r.yesPower ?? 0),
        no: round2(noPower),
        threshold: r.thresholdPct ?? 0,
        totalPower: round2(r.totalPower ?? 0),
      });
    } catch {
      // anchoring failure must not undo the published result (recorded for retry).
    }
    return { ...r, status, stage, finalized: true };
  }

  /** D&V votes with on-chain DRep id, choice, weight (final power) and rationale. */
  private async dvVoteList(proposalId: string) {
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId }, include: { entries: true } });
    const powerByDrep = new Map((snapshot?.entries ?? []).map((e) => [e.drepId, Number(e.finalPower ?? 0)]));
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.DEBATE_VOTE },
      include: { drep: { select: { id: true, drepIdOnchain: true, votesOnFundingProposals: true, user: { select: { displayName: true, drepKeyHash: true } } } } },
      orderBy: { castAt: 'asc' },
    });
    // §8.2 — a board member who has opted out has their weight zeroed in the
    // public vote list so the audit row makes sense alongside the tally.
    const boardHashes = new Set(
      (await this.prisma.boardSeat.findMany({ select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    return votes.map((v) => {
      const isBoard = !!v.drep.user?.drepKeyHash && boardHashes.has(v.drep.user.drepKeyHash);
      const optedOut = isBoard && !v.drep.votesOnFundingProposals;
      return {
        drep: v.drep.drepIdOnchain,
        displayName: v.drep.user?.displayName ?? null,
        choice: v.choice,
        weight: optedOut ? 0 : round2(powerByDrep.get(v.drepId) ?? 0),
        rationale: v.rationale ?? null,
      };
    });
  }

  private async currentMerit(drepId: string, max?: number): Promise<number> {
    const rows = await this.prisma.meritLedger.aggregate({
      where: { drepId },
      _sum: { delta: true },
    });
    const sum = rows._sum.delta ? Number(rows._sum.delta) : 0;
    return clampMerit(sum, max ?? (await this.meritMax()));
  }
}

function toLovelaceAda(ada: number): bigint {
  return BigInt(Math.round(ada)) * LOVELACE;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
