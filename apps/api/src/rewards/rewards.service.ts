import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TreasuryBucketsService } from '../treasury/treasury-buckets.service';
import { ROUND_SETTING_DEFAULTS, RoundStatus, VotePhase, basePower, meritMultiplier, clampMerit, PLATFORM_CONFIG_DEFAULTS } from '@drep-dao/shared';

const LOVELACE = 1_000_000n;
const toLovelace = (ada: number) => BigInt(Math.round(ada * 1_000_000));

/**
 * §12 — reward calculation + distribution. Each category writes one RewardCalculation
 * with per-recipient RewardEntry rows (DReps + Experts). Recompute replaces any prior
 * UNPAID calc of the same kind; paid entries are immutable. Pools:
 *   FILTER     = min(Σ submission fees, feeCap)        split by cast filter votes (§12.3)
 *   DV_FIXED   = bucket × dvShare × fixed              split by cast D&V votes (§12.4)
 *   DV_BONUS   = bucket × dvShare × (1−fixed)          split by participation×power (§12.5)
 *   MILESTONE  = bucket × (1−dvShare)                  split by checks performed (§12.6)
 * Experts get the board-set flat ADA per stage; board monthly = yearly/12/seats.
 */
@Injectable()
export class RewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly buckets: TreasuryBucketsService,
  ) {}

  private setting(round: Record<string, unknown>, key: keyof typeof ROUND_SETTING_DEFAULTS): number {
    const v = round[key];
    return typeof v === 'number' ? v : (ROUND_SETTING_DEFAULTS[key] as number);
  }

  /** §12.7 — a reward batch may only be paid once its stage has ended:
   *  filtering → round past FILTERING; D&V → past VOTE; milestone → in/after FUNDING
   *  (paid monthly); board monthly → any time. */
  private isPayable(kind: string, status?: string | null): boolean {
    if (kind === 'BOARD_MONTHLY') return true;
    if (!status) return false;
    if (kind === 'FILTER') {
      return ([RoundStatus.DEBATE, RoundStatus.VOTE, RoundStatus.DV, RoundStatus.FUNDING, RoundStatus.CLOSED] as string[]).includes(status);
    }
    // DV_FIXED / DV_BONUS / MILESTONE — payable once the round reaches FUNDING.
    return ([RoundStatus.FUNDING, RoundStatus.CLOSED] as string[]).includes(status);
  }

  /** Drop a prior unpaid calc of this kind so a recompute is clean; refuse if any entry was paid. */
  private async clearCalc(where: { roundId?: string | null; kind: string; periodKey?: string }) {
    const calcs = await this.prisma.rewardCalculation.findMany({
      where: { roundId: where.roundId ?? null, kind: where.kind, ...(where.periodKey ? { periodKey: where.periodKey } : {}) },
      include: { entries: { select: { paidAt: true } } },
    });
    for (const c of calcs) {
      if (c.entries.some((e) => e.paidAt)) {
        throw new ConflictException('rewards for this stage were already (partly) paid — cannot recompute');
      }
      await this.prisma.rewardEntry.deleteMany({ where: { rewardCalculationId: c.id } });
      await this.prisma.rewardCalculation.delete({ where: { id: c.id } });
    }
  }

  /** Flat per-expert ADA for a stage (filtering/dv), added as entries on the calc. */
  private async addExpertFlat(calcId: string, roundId: string, field: 'filteringAda' | 'dvAda') {
    const rows = await this.prisma.expertReward.findMany({ where: { roundId } });
    for (const r of rows) {
      const amt = r[field];
      if (amt > 0n) {
        await this.prisma.rewardEntry.create({ data: { rewardCalculationId: calcId, expertId: r.expertId, amountAda: amt } });
      }
    }
  }

  // ── §12.3 filtering ────────────────────────────────────────────────────────
  async computeFiltering(roundId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundException('round not found');
    const feeAgg = await this.prisma.proposal.aggregate({ where: { roundId }, _sum: { submissionFeeAda: true } });
    const fees = feeAgg._sum.submissionFeeAda ?? 0n;
    const cap = BigInt(this.setting(round, 'feeCapPerRoundAda')) * LOVELACE;
    const pool = fees < cap ? fees : cap;

    const votes = await this.prisma.vote.findMany({ where: { phase: VotePhase.FILTERING, proposal: { roundId } }, select: { drepId: true } });
    const byDrep = new Map<string, number>();
    for (const v of votes) if (v.drepId) byDrep.set(v.drepId, (byDrep.get(v.drepId) ?? 0) + 1);

    await this.clearCalc({ roundId, kind: 'FILTER' });
    const calc = await this.prisma.rewardCalculation.create({ data: { roundId, kind: 'FILTER', poolAda: pool, totalUnits: votes.length } });
    if (votes.length > 0) {
      const perVote = pool / BigInt(votes.length);
      for (const [drepId, n] of byDrep) {
        await this.prisma.rewardEntry.create({ data: { rewardCalculationId: calc.id, drepId, amountAda: perVote * BigInt(n), units: n } });
      }
    }
    await this.addExpertFlat(calc.id, roundId, 'filteringAda');
    return this.calcView(calc.id);
  }

  // ── §12.4 / §12.5 Debate & Vote (fixed + bonus) ─────────────────────────────
  async computeDv(roundId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundException('round not found');
    const bucket = round.rewardsPoolAda;
    const dvShare = this.setting(round, 'rewardDvSharePct') / 100;
    const fixedShare = this.setting(round, 'rewardFixedPct') / 100;
    const dvPool = BigInt(Math.round(Number(bucket) * dvShare));
    const fixedPool = BigInt(Math.round(Number(dvPool) * fixedShare));
    const bonusPool = dvPool - fixedPool;

    // cast D&V votes per drep + the snapshot (power + max-possible votes)
    const proposals = await this.prisma.proposal.findMany({ where: { roundId, stage: 'DEBATE_VOTE' }, select: { id: true } });
    const propIds = proposals.map((p) => p.id);
    const maxVotes = propIds.length; // one ballot per proposal is the max
    const votes = await this.prisma.vote.findMany({ where: { phase: VotePhase.DEBATE_VOTE, proposalId: { in: propIds }, choice: { not: 'ABSTAIN' } }, select: { drepId: true } });
    const castByDrep = new Map<string, number>();
    for (const v of votes) if (v.drepId) castByDrep.set(v.drepId, (castByDrep.get(v.drepId) ?? 0) + 1);
    const totalCast = votes.length;

    // FINAL voting power per drep — from the freshest snapshot entry for the round.
    const power = await this.drepFinalPower(propIds);

    await this.clearCalc({ roundId, kind: 'DV_FIXED' });
    await this.clearCalc({ roundId, kind: 'DV_BONUS' });

    const fixedCalc = await this.prisma.rewardCalculation.create({ data: { roundId, kind: 'DV_FIXED', poolAda: fixedPool, totalUnits: totalCast } });
    if (totalCast > 0) {
      const perVote = fixedPool / BigInt(totalCast);
      for (const [drepId, n] of castByDrep) {
        await this.prisma.rewardEntry.create({ data: { rewardCalculationId: fixedCalc.id, drepId, amountAda: perVote * BigInt(n), units: n } });
      }
    }

    // §12.5 bonus: weight_i = (cast_i / maxVotes) × finalPower_i
    const weights = new Map<string, number>();
    let totalWeight = 0;
    for (const [drepId, n] of castByDrep) {
      const participation = maxVotes > 0 ? n / maxVotes : 0;
      const w = participation * (power.get(drepId) ?? 0);
      if (w > 0) { weights.set(drepId, w); totalWeight += w; }
    }
    const bonusCalc = await this.prisma.rewardCalculation.create({ data: { roundId, kind: 'DV_BONUS', poolAda: bonusPool, totalUnits: totalWeight } });
    if (totalWeight > 0) {
      for (const [drepId, w] of weights) {
        const amt = BigInt(Math.round(Number(bonusPool) * (w / totalWeight)));
        await this.prisma.rewardEntry.create({ data: { rewardCalculationId: bonusCalc.id, drepId, amountAda: amt, units: castByDrep.get(drepId) ?? 0 } });
      }
    }
    await this.addExpertFlat(fixedCalc.id, roundId, 'dvAda');
    return { fixed: await this.calcView(fixedCalc.id), bonus: await this.calcView(bonusCalc.id) };
  }

  /** Final voting power per drep from the freshest snapshot among the proposals. */
  private async drepFinalPower(proposalIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (proposalIds.length === 0) return out;
    const snaps = await this.prisma.voteSnapshot.findMany({ where: { proposalId: { in: proposalIds } }, select: { id: true } });
    const entries = await this.prisma.voteSnapshotEntry.findMany({
      where: { snapshotId: { in: snaps.map((s) => s.id) } },
      select: { drepId: true, finalPower: true },
    });
    for (const e of entries) {
      const fp = e.finalPower ? Number(e.finalPower) : 0;
      out.set(e.drepId, Math.max(out.get(e.drepId) ?? 0, fp)); // dedupe across proposals → take max
    }
    return out;
  }

  // ── §12.6 milestone (monthly) ───────────────────────────────────────────────
  async computeMilestone(roundId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundException('round not found');
    const dvShare = this.setting(round, 'rewardDvSharePct') / 100;
    const pool = BigInt(Math.round(Number(round.rewardsPoolAda) * (1 - dvShare)));
    const reviewerCount = this.setting(round, 'milestoneReviewerCount');

    const milestones = await this.prisma.milestone.findMany({ where: { proposal: { roundId } }, select: { id: true } });
    const totalChecks = milestones.length * reviewerCount; // §12.6 denominator
    // checks actually performed (milestone votes) per drep / expert
    const mvotes = await this.prisma.vote.findMany({
      where: { phase: VotePhase.MILESTONE, milestoneId: { in: milestones.map((m) => m.id) } },
      select: { drepId: true },
    });
    const byDrep = new Map<string, number>();
    for (const v of mvotes) if (v.drepId) byDrep.set(v.drepId, (byDrep.get(v.drepId) ?? 0) + 1);

    await this.clearCalc({ roundId, kind: 'MILESTONE' });
    const calc = await this.prisma.rewardCalculation.create({ data: { roundId, kind: 'MILESTONE', poolAda: pool, totalUnits: totalChecks } });
    const perCheck = totalChecks > 0 ? pool / BigInt(totalChecks) : 0n;
    if (perCheck > 0n) {
      for (const [drepId, n] of byDrep) {
        await this.prisma.rewardEntry.create({ data: { rewardCalculationId: calc.id, drepId, amountAda: perCheck * BigInt(n), units: n } });
      }
    }
    // experts: per §12 switch — like-DRep → per-check reward + extra; else flat milestoneAda.
    const experts = await this.prisma.expertReward.findMany({ where: { roundId } });
    const expertChecks = new Map<string, number>(); // expert milestone checks performed (their votes)
    const evCounts = await this.prisma.milestoneExpertVote.groupBy({
      by: ['expertId'],
      where: { milestoneId: { in: milestones.map((m) => m.id) } },
      _count: { _all: true },
    });
    for (const c of evCounts) expertChecks.set(c.expertId, c._count._all);
    for (const r of experts) {
      const checks = expertChecks.get(r.expertId) ?? 0;
      let amt = r.milestoneAda; // the flat / extra payment
      if (r.milestoneLikeDrep && checks > 0) amt = amt + perCheck * BigInt(checks); // + DRep-equivalent
      if (amt > 0n) await this.prisma.rewardEntry.create({ data: { rewardCalculationId: calc.id, expertId: r.expertId, amountAda: amt, units: checks } });
    }
    return this.calcView(calc.id);
  }

  // ── §13 board monthly comp = yearly / 12 / active seats ──────────────────────
  async computeBoardMonthly(periodKey?: string) {
    const now = new Date();
    const key = periodKey ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const yearly = await this.boardYearlyAda();
    const boardDrepIds = await this.boardDrepIds();
    await this.clearCalc({ roundId: null, kind: 'BOARD_MONTHLY', periodKey: key });
    const perMember = boardDrepIds.length > 0 ? yearly / 12n / BigInt(boardDrepIds.length) : 0n;
    const calc = await this.prisma.rewardCalculation.create({ data: { roundId: null, kind: 'BOARD_MONTHLY', poolAda: perMember * BigInt(boardDrepIds.length), totalUnits: boardDrepIds.length, periodKey: key } });
    if (perMember > 0n) {
      for (const drepId of boardDrepIds) {
        await this.prisma.rewardEntry.create({ data: { rewardCalculationId: calc.id, drepId, amountAda: perMember } });
      }
    }
    return this.calcView(calc.id);
  }

  private async boardYearlyAda(): Promise<bigint> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'BOARD_YEARLY_REWARD_ADA' } });
    const ada = typeof row?.value === 'number' ? row.value : PLATFORM_CONFIG_DEFAULTS.BOARD_YEARLY_REWARD_ADA;
    return toLovelace(ada);
  }

  private async boardDrepIds(): Promise<string[]> {
    const seats = await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepId: true } });
    if (!seats.length) return [];
    const dreps = await this.prisma.drep.findMany({ where: { drepIdOnchain: { in: seats.map((s) => s.drepId) } }, select: { id: true } });
    return dreps.map((d) => d.id);
  }

  // ── views / overview ─────────────────────────────────────────────────────────
  async calcView(calcId: string) {
    const calc = await this.prisma.rewardCalculation.findUnique({
      where: { id: calcId },
      include: {
        entries: {
          include: {
            drep: { select: { id: true, drepIdOnchain: true, user: { select: { displayName: true, rewardPaymentAddress: true } } } },
            expert: { select: { id: true, displayName: true, user: { select: { rewardPaymentAddress: true } } } },
          },
        },
      },
    });
    if (!calc) throw new NotFoundException('calculation not found');
    const status = calc.roundId
      ? (await this.prisma.round.findUnique({ where: { id: calc.roundId }, select: { status: true } }))?.status
      : null;
    // A pending/sent REWARD_PAYOUT action for this calc (if one was already prepared).
    const linkedId = calc.entries.find((e) => e.payoutActionId)?.payoutActionId ?? null;
    const action = linkedId ? await this.prisma.multisigAction.findUnique({ where: { id: linkedId }, select: { id: true, status: true, txHash: true } }) : null;
    return {
      id: calc.id,
      roundId: calc.roundId,
      kind: calc.kind,
      periodKey: calc.periodKey,
      poolAda: Number(calc.poolAda) / 1e6,
      payable: this.isPayable(calc.kind, status),
      payout: action ? { actionId: action.id, status: action.status, txHash: action.txHash } : null,
      computedAt: calc.computedAt,
      entries: calc.entries.map((e) => ({
        id: e.id,
        recipient: e.drep
          ? { type: 'DRep' as const, name: e.drep.user.displayName ?? e.drep.drepIdOnchain.slice(0, 16), address: e.drep.user.rewardPaymentAddress }
          : { type: 'Expert' as const, name: e.expert?.displayName ?? '?', address: e.expert?.user.rewardPaymentAddress ?? null },
        units: e.units,
        amountAda: Number(e.overrideAda ?? e.amountAda) / 1e6,
        computedAda: Number(e.amountAda) / 1e6,
        overridden: e.overrideAda != null,
        paid: !!e.paidAt,
        paidInTx: e.paidInTx,
      })),
    };
  }

  /** All calcs for a round (overview) + the board-monthly calcs. */
  async overview(roundId: string) {
    const calcs = await this.prisma.rewardCalculation.findMany({ where: { roundId }, orderBy: { computedAt: 'asc' }, select: { id: true } });
    return Promise.all(calcs.map((c) => this.calcView(c.id)));
  }

  async setOverride(entryId: string, ada: number | null) {
    const e = await this.prisma.rewardEntry.findUnique({ where: { id: entryId }, select: { paidAt: true } });
    if (!e) throw new NotFoundException('entry not found');
    if (e.paidAt) throw new ConflictException('this reward was already paid');
    await this.prisma.rewardEntry.update({ where: { id: entryId }, data: { overrideAda: ada == null ? null : toLovelace(ada) } });
    return { ok: true };
  }

  // ── expert reward config ──────────────────────────────────────────────────────
  async listExpertRewards(roundId: string) {
    const experts = await this.prisma.expert.findMany({ where: { approvedByBoard: true }, select: { id: true, displayName: true } });
    const rows = await this.prisma.expertReward.findMany({ where: { roundId } });
    const byExpert = new Map(rows.map((r) => [r.expertId, r]));
    return experts.map((ex) => {
      const r = byExpert.get(ex.id);
      return {
        expertId: ex.id,
        name: ex.displayName,
        filteringAda: r ? Number(r.filteringAda) / 1e6 : 0,
        dvAda: r ? Number(r.dvAda) / 1e6 : 0,
        milestoneAda: r ? Number(r.milestoneAda) / 1e6 : 0,
        milestoneLikeDrep: r?.milestoneLikeDrep ?? false,
      };
    });
  }

  async setExpertReward(roundId: string, expertId: string, dto: { filteringAda?: number; dvAda?: number; milestoneAda?: number; milestoneLikeDrep?: boolean }) {
    const data = {
      filteringAda: dto.filteringAda != null ? toLovelace(dto.filteringAda) : undefined,
      dvAda: dto.dvAda != null ? toLovelace(dto.dvAda) : undefined,
      milestoneAda: dto.milestoneAda != null ? toLovelace(dto.milestoneAda) : undefined,
      milestoneLikeDrep: dto.milestoneLikeDrep,
    };
    await this.prisma.expertReward.upsert({
      where: { roundId_expertId: { roundId, expertId } },
      update: data,
      create: {
        roundId,
        expertId,
        filteringAda: data.filteringAda ?? 0n,
        dvAda: data.dvAda ?? 0n,
        milestoneAda: data.milestoneAda ?? 0n,
        milestoneLikeDrep: data.milestoneLikeDrep ?? false,
      },
    });
    return { ok: true };
  }

  async getBoardYearly() {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'BOARD_YEARLY_REWARD_ADA' } });
    return { yearlyAda: typeof row?.value === 'number' ? row.value : PLATFORM_CONFIG_DEFAULTS.BOARD_YEARLY_REWARD_ADA };
  }

  async setBoardYearly(ada: number) {
    if (!(ada >= 0)) throw new BadRequestException('amount must be ≥ 0');
    await this.prisma.platformConfig.upsert({ where: { key: 'BOARD_YEARLY_REWARD_ADA' }, update: { value: ada }, create: { key: 'BOARD_YEARLY_REWARD_ADA', value: ada } });
    return { ok: true };
  }

  // ── multi-output payout (reuses the multisig signing flow) ─────────────────────
  /** Create one REWARD_PAYOUT multisig action that pays every unpaid entry of a calc. */
  async preparePayout(calcId: string, sourceBucketId?: string) {
    const calc = await this.prisma.rewardCalculation.findUnique({
      where: { id: calcId },
      include: {
        entries: {
          where: { paidAt: null, payoutActionId: null },
          include: {
            drep: { select: { user: { select: { rewardPaymentAddress: true } } } },
            expert: { select: { user: { select: { rewardPaymentAddress: true } } } },
          },
        },
      },
    });
    if (!calc) throw new NotFoundException('calculation not found');
    const status = calc.roundId
      ? (await this.prisma.round.findUnique({ where: { id: calc.roundId }, select: { status: true } }))?.status
      : null;
    if (!this.isPayable(calc.kind, status)) {
      throw new ConflictException('this stage has not ended yet — rewards can only be paid once it closes');
    }
    const lines = calc.entries
      .map((e) => ({ entryId: e.id, address: e.drep?.user.rewardPaymentAddress ?? e.expert?.user.rewardPaymentAddress ?? null, amountAda: Number(e.overrideAda ?? e.amountAda) / 1e6 }))
      .filter((l) => l.amountAda > 0);
    const missing = lines.filter((l) => !l.address);
    if (missing.length) throw new BadRequestException(`${missing.length} recipient(s) have no reward payment address set`);
    if (lines.length === 0) throw new BadRequestException('nothing to pay (all entries are paid or zero)');

    const source = sourceBucketId
      ? await this.prisma.treasuryBucket.findUnique({ where: { id: sourceBucketId }, select: { id: true } })
      : await this.buckets.defaultBucketFor('REWARDS');
    const total = lines.reduce((s, l) => s + l.amountAda, 0);

    const action = await this.prisma.multisigAction.create({
      data: {
        kind: 'REWARD_PAYOUT',
        status: 'PENDING_SIGS',
        amountAda: toLovelace(total),
        description: `Reward payout · ${calc.kind} · ${lines.length} recipients`,
        sourceBucketId: source?.id ?? null,
      },
    });
    await this.prisma.rewardEntry.updateMany({ where: { id: { in: lines.map((l) => l.entryId) } }, data: { payoutActionId: action.id } });
    return { actionId: action.id, recipients: lines.length, totalAda: total };
  }
}
