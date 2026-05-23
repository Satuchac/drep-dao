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
  ProposalStage,
  ProposalStatus,
  VoteChoice,
  VotePhase,
} from '@drep-dao/shared';
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorService } from '../cardano/anchor.service';

const LOVELACE = 1_000_000n;

@Injectable()
export class DvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly anchor: AnchorService,
  ) {}

  /**
   * §4.3 — take the voting-power snapshot and open D&V voting. Idempotent.
   * NOTE: on-chain stake isn't wired yet (no Blockfrost), so each eligible DRep
   * is snapshotted with a nominal stake (DV_SNAPSHOT_STAKE_ADA, default 1,000,000)
   * and their real merit. The balanced-tally machinery (§4) is fully real.
   */
  async openVoting(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.stage !== ProposalStage.DEBATE_VOTE) {
      throw new ConflictException('proposal is not in the DEBATE_VOTE stage');
    }

    const existing = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    if (existing) return this.result(proposalId);

    // §8.2 — voters are admitted DReps eligible for the round, EXCEPT board members,
    // who only vote on funding proposals if they explicitly opted in for this proposal.
    const eligible = await this.prisma.roundDrepEligibility.findMany({
      where: { roundId: proposal.roundId ?? undefined, drep: { status: 'ADMITTED' } },
      select: { drepId: true, drep: { select: { user: { select: { drepKeyHash: true } } } } },
    });
    const boardHashes = new Set((await this.prisma.boardSeat.findMany({ select: { drepKeyHash: true } })).map((s) => s.drepKeyHash));
    const optedIn = new Set(
      (await this.prisma.dvBoardOptIn.findMany({ where: { proposalId }, select: { drepId: true } })).map((o) => o.drepId),
    );
    const voters = eligible.filter((e) => {
      const kh = e.drep.user?.drepKeyHash;
      const isBoard = kh ? boardHashes.has(kh) : false;
      return !isBoard || optedIn.has(e.drepId);
    });

    const snapshot = await this.prisma.voteSnapshot.create({ data: { proposalId } });
    for (const { drepId } of voters) await this.addSnapshotEntry(snapshot.id, drepId);
    await this.prisma.proposal.update({ where: { id: proposalId }, data: { votingStartAt: new Date() } });
    return this.result(proposalId);
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
      if (!has) await this.addSnapshotEntry(snapshot.id, drep.id);
    }
    return this.result(proposalId);
  }

  private async addSnapshotEntry(snapshotId: string, drepId: string) {
    const nominalStake = toLovelaceAda(Number(this.config.get('DV_SNAPSHOT_STAKE_ADA') ?? 1_000_000));
    const merit = await this.currentMerit(drepId);
    const bp = basePower(nominalStake);
    const mm = meritMultiplier(merit);
    await this.prisma.voteSnapshotEntry.create({
      data: { snapshotId, drepId, stakeLovelace: nominalStake, meritPoints: merit, basePower: bp, meritMultiplier: mm, finalPower: bp * mm },
    });
  }

  /** §8.2 — eligible DRep casts/changes a balanced D&V vote (rationale mandatory). */
  async vote(userId: string, proposalId: string, choice: string, rationale: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.stage !== ProposalStage.DEBATE_VOTE) {
      throw new ConflictException('proposal is not in the DEBATE_VOTE stage');
    }
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new ForbiddenException('DReps only');

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

    let yesPower = 0;
    let abstainPower = 0;
    let totalPower = 0;
    let cast = 0;
    for (const e of snapshot.entries) {
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
      : Number(this.config.get('DV_APPROVAL_THRESHOLD_PCT') ?? 67);
    const tally = { yesPower, totalPower, abstainPower, thresholdPct };

    const anchor = await this.prisma.anchor.findFirst({ where: { proposalId, kind: 'dv' }, orderBy: { createdAt: 'desc' } });
    return {
      open: true,
      eligible: snapshot.entries.length,
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

  /** §9.3 — board finalizes (publishes): APPROVED if threshold met, else REJECTED. Anchors the result. */
  async finalize(proposalId: string) {
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
        include: { round: { select: { number: true, id: true } } },
      });
      const voteList = await this.dvVoteList(proposalId);
      const noPower = Math.max(0, (r.totalPower ?? 0) - (r.yesPower ?? 0) - (r.abstainPower ?? 0));
      await this.anchor.anchorResult({
        kind: 'dv',
        subject: GovSubject.DV,
        style: VotingStyle.BALANCED,
        ref: `${proposal?.title ?? 'proposal'} · round #${proposal?.round?.number ?? '?'}`,
        proposalId,
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
      include: { drep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } },
      orderBy: { castAt: 'asc' },
    });
    return votes.map((v) => ({
      drep: v.drep.drepIdOnchain,
      displayName: v.drep.user?.displayName ?? null,
      choice: v.choice,
      weight: round2(powerByDrep.get(v.drepId) ?? 0),
      rationale: v.rationale ?? null,
    }));
  }

  private async currentMerit(drepId: string): Promise<number> {
    const rows = await this.prisma.meritLedger.aggregate({
      where: { drepId },
      _sum: { delta: true },
    });
    const sum = rows._sum.delta ? Number(rows._sum.delta) : 0;
    return clampMerit(sum);
  }
}

function toLovelaceAda(ada: number): bigint {
  return BigInt(Math.round(ada)) * LOVELACE;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
