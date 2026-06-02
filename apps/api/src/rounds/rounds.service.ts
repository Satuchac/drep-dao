import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DRepStatus, ProposalStatus, RoundStatus, ROUND_SETTING_DEFAULTS } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DvService } from '../proposals/dv.service';
import { CreateRoundDto, UpdateRoundDto, CategoryInput, ScheduleInput, ConfirmStageDto, RoundSettingsInput } from './dto';

const LOVELACE = 1_000_000;
const toLovelace = (ada: number): bigint => BigInt(Math.round(ada * LOVELACE));
const toAda = (lovelace: bigint | null): number => (lovelace == null ? 0 : Number(lovelace) / LOVELACE);

// §5 — the round advances through these statuses in order. §8 split the old
// single "Debate & Vote" stage into DEBATE (discuss + revise) → VOTE (ballots).
const STATUS_SEQUENCE: string[] = [
  RoundStatus.PREPARATION,
  RoundStatus.SUBMISSION,
  RoundStatus.FILTERING,
  RoundStatus.DEBATE,
  RoundStatus.VOTE,
  RoundStatus.FUNDING,
  RoundStatus.CLOSED,
];
// Each advanceable status has a matching schedule stageKey (CLOSED is manual-only).
const STAGE_KEY_FOR_STATUS: Record<string, string | undefined> = {
  [RoundStatus.SUBMISSION]: 'submission',
  [RoundStatus.FILTERING]: 'filtering',
  [RoundStatus.DEBATE]: 'debate',
  [RoundStatus.VOTE]: 'vote',
  [RoundStatus.FUNDING]: 'funding',
};
const STATUS_FOR_STAGE_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_KEY_FOR_STATUS).map(([status, key]) => [key as string, status]),
);
// Backward-compat: any pre-split round_schedule row with key 'debate_vote' is
// treated as the VOTE window (the most user-visible behaviour for an old round).
const SCHEDULE_KEY_FOR_STATUS: Record<string, string[]> = {
  [RoundStatus.SUBMISSION]: ['submission'],
  [RoundStatus.FILTERING]: ['filtering'],
  [RoundStatus.DEBATE]: ['debate'],
  [RoundStatus.VOTE]: ['vote', 'debate_vote'],
  [RoundStatus.FUNDING]: ['funding'],
};
// A round is "active" (carrying live proposals) when in one of these stages.
const ACTIVE_ROUND_STATUSES: string[] = [
  RoundStatus.SUBMISSION,
  RoundStatus.FILTERING,
  RoundStatus.DEBATE,
  RoundStatus.VOTE,
  RoundStatus.FUNDING,
];

@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // §8 — on DEBATE → VOTE we (re-)snapshot every DEBATE_VOTE-stage proposal in
    // the round so the electorate reflects the full current eligibility, not a
    // stale pre-VOTE snapshot. Injected lazily via Optional so the rounds tests
    // (which build RoundsService manually) don't have to mock DvService.
    @Optional() @Inject(forwardRef(() => DvService))
    private readonly dv?: DvService,
  ) {}

  /** §6 — board creates a round in PREPARATION with categories, schedule, eligibility. */
  async create(dto: CreateRoundDto) {
    this.assertCategoriesCoverBudget(dto.categories, dto.budgetAda);
    this.assertScheduleOrdered(dto.schedule);
    this.assertSettings(dto);

    const last = await this.prisma.round.findFirst({ orderBy: { number: 'desc' } });
    const number = (last?.number ?? 0) + 1;
    const multisigAddress =
      dto.multisigAddress ?? this.config.get<string>('DAO_MULTISIG_ADDRESS') ?? 'multisig-pending';

    const eligibleDrepIds = await this.resolveEligibility(dto.eligibleDrepIds);

    const round = await this.prisma.round.create({
      data: {
        number,
        name: dto.name ?? null,
        status: RoundStatus.PREPARATION,
        budgetAda: toLovelace(dto.budgetAda),
        rewardsPoolAda: toLovelace(dto.rewardsPoolAda),
        multisigAddress,
        intersectTxHash: dto.intersectTxHash ?? null,
        // §6/§12 — per-round settings (null = use the ROUND_SETTING_DEFAULTS value).
        ...this.settingsData(dto),
        categories: { create: dto.categories.map((c) => this.categoryData(c)) },
        schedule: { create: (dto.schedule ?? []).map((s) => this.scheduleData(s)) },
        eligibilities: { create: eligibleDrepIds.map((drepId) => ({ drepId })) },
      },
    });
    return this.get(round.id);
  }

  async list() {
    const rounds = await this.prisma.round.findMany({
      orderBy: { number: 'desc' },
      include: { categories: true, _count: { select: { eligibilities: true, proposals: true } } },
    });
    // §9 — proposal counts per round, grouped by status (incl. DRAFT/PENDING — a count only,
    // proposal content stays private; the board + members see how a round is filling up).
    const grouped = await this.prisma.proposal.groupBy({
      by: ['roundId', 'status'],
      where: { roundId: { in: rounds.map((r) => r.id) } },
      _count: { _all: true },
    });
    const byRound = new Map<string, Record<string, number>>();
    for (const g of grouped) {
      if (!g.roundId) continue;
      const m = byRound.get(g.roundId) ?? {};
      m[g.status] = g._count._all;
      byRound.set(g.roundId, m);
    }
    // ACTIVE proposals further split by stage (filtering / debate_vote / funding) so the
    // round overview shows what's currently in motion, not just "X active".
    const activeGrouped = await this.prisma.proposal.groupBy({
      by: ['roundId', 'stage'],
      where: { roundId: { in: rounds.map((r) => r.id) }, status: ProposalStatus.ACTIVE },
      _count: { _all: true },
    });
    const activeByRound = new Map<string, Record<string, number>>();
    for (const g of activeGrouped) {
      if (!g.roundId || !g.stage) continue;
      const m = activeByRound.get(g.roundId) ?? {};
      m[g.stage] = g._count._all;
      activeByRound.set(g.roundId, m);
    }
    return rounds.map((r) => {
      const counts = byRound.get(r.id) ?? {};
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      return {
        id: r.id,
        number: r.number,
        name: r.name,
        status: r.status,
        active: ACTIVE_ROUND_STATUSES.includes(r.status),
        budgetAda: toAda(r.budgetAda),
        rewardsPoolAda: toAda(r.rewardsPoolAda),
        categoryCount: r.categories.length,
        eligibleCount: r._count.eligibilities,
        proposalCount: total,
        proposalCounts: counts,
        activeStageCounts: activeByRound.get(r.id) ?? {},
        createdAt: r.createdAt,
        endedAt: r.endedAt,
      };
    });
  }

  /** §11 — the current active round (highest-numbered in a live stage), or null. */
  async activeRound() {
    const r = await this.prisma.round.findFirst({
      where: { status: { in: ACTIVE_ROUND_STATUSES } },
      orderBy: { number: 'desc' },
    });
    return r ? this.get(r.id) : null;
  }

  async get(id: string) {
    const r = await this.prisma.round.findUnique({
      where: { id },
      include: {
        categories: true,
        schedule: { orderBy: { startsAt: 'asc' } },
        _count: { select: { eligibilities: true, proposals: true } },
      },
    });
    if (!r) throw new NotFoundException('round not found');
    // §9 — per-status proposal counts. Unlike the public list(), the round detail INCLUDES
    // DRAFT (a count only — content stays private) so the board sees drafts in Round control.
    const grouped = await this.prisma.proposal.groupBy({
      by: ['status'],
      where: { roundId: id },
      _count: { _all: true },
    });
    const proposalCounts: Record<string, number> = {};
    for (const g of grouped) proposalCounts[g.status] = g._count._all;
    // ACTIVE proposals broken down by stage (filtering / debate_vote / funding) so the
    // round detail can show "2 active (1 filtering · 1 D&V)" instead of just "2 active".
    const activeStageGrouped = await this.prisma.proposal.groupBy({
      by: ['stage'],
      where: { roundId: id, status: ProposalStatus.ACTIVE },
      _count: { _all: true },
    });
    const activeStageCounts: Record<string, number> = {};
    for (const g of activeStageGrouped) {
      if (g.stage) activeStageCounts[g.stage] = g._count._all;
    }
    const schedule = r.schedule.map((s) => ({
      stageKey: s.stageKey,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      autoStart: s.autoStart,
      confirmedAt: s.confirmedAt,
      prolongedFrom: s.prolongedFrom,
    }));
    return {
      id: r.id,
      number: r.number,
      name: r.name,
      status: r.status,
      active: ACTIVE_ROUND_STATUSES.includes(r.status),
      budgetAda: toAda(r.budgetAda),
      rewardsPoolAda: toAda(r.rewardsPoolAda),
      multisigAddress: r.multisigAddress,
      intersectTxHash: r.intersectTxHash,
      eligibleCount: r._count.eligibilities,
      proposalCount: r._count.proposals,
      proposalCounts,
      activeStageCounts,
      categories: r.categories.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        description: c.description,
        conditions: c.conditions,
        allocatedAda: toAda(c.allocatedAda),
        minAda: c.minAda == null ? null : toAda(c.minAda),
        maxAda: c.maxAda == null ? null : toAda(c.maxAda),
      })),
      schedule,
      // §6/§12 — per-round settings (null = the ROUND_SETTING_DEFAULTS value).
      settings: {
        filterReviewerCount: r.filterReviewerCount,
        filterApprovalVotes: r.filterApprovalVotes,
        milestoneReviewerCount: r.milestoneReviewerCount,
        milestoneApprovalVotes: r.milestoneApprovalVotes,
        dvApprovalThresholdPct: r.dvApprovalThresholdPct == null ? null : Number(r.dvApprovalThresholdPct),
        rewardExpertSharePct: r.rewardExpertSharePct,
        rewardDvSharePct: r.rewardDvSharePct,
        rewardFixedPct: r.rewardFixedPct,
        feeCommercialPct: r.feeCommercialPct,
        feeCommercialCapAda: r.feeCommercialCapAda,
        feeOssPct: r.feeOssPct,
        feeOssCapAda: r.feeOssCapAda,
        feeCapPerRoundAda: r.feeCapPerRoundAda,
        quickPollParticipationPct: r.quickPollParticipationPct,
        quickPollDurationHours: r.quickPollDurationHours,
        quickPollMaxExtensions: r.quickPollMaxExtensions,
        milestoneNotificationDaysBeforeEnd: r.milestoneNotificationDaysBeforeEnd,
        milestoneAutoExtensionDays: r.milestoneAutoExtensionDays,
        milestoneCheckPeriodDays: r.milestoneCheckPeriodDays,
        milestoneBoardExtraExtensionDays: r.milestoneBoardExtraExtensionDays,
        pledgeThresholdAda: r.pledgeThresholdAda,
        pledgeGraceDays: r.pledgeGraceDays,
        filterResubmissionsAllowed: r.filterResubmissionsAllowed,
        filterBudgetChangesAllowed: r.filterBudgetChangesAllowed,
        mandatoryWords: r.mandatoryWords,
      },
      // §8 — what the board must confirm/launch next (null once CLOSED).
      nextStage: this.computeNextStage(r.status, schedule),
      createdAt: r.createdAt,
      endedAt: r.endedAt,
    };
  }

  /** Editable while still pre-review — PREPARATION or SUBMISSION (once Filtering/D&V start, the
   * round config is locked). Categories are reconciled by id so existing proposals aren't orphaned. */
  async update(id: string, dto: UpdateRoundDto) {
    const round = await this.prisma.round.findUnique({ where: { id }, include: { categories: true } });
    if (!round) throw new NotFoundException('round not found');
    if (round.status !== RoundStatus.PREPARATION && round.status !== RoundStatus.SUBMISSION) {
      throw new ConflictException('a round can only be edited while in Preparation or Submission');
    }
    // P4/P7 — re-validate against the resulting budget + schedule.
    const budgetAda = dto.budgetAda ?? toAda(round.budgetAda);
    if (dto.categories) this.assertCategoriesCoverBudget(dto.categories, budgetAda);
    else this.assertCategoriesCoverBudget(round.categories.map((c) => ({ allocatedAda: toAda(c.allocatedAda) })), budgetAda);
    this.assertScheduleOrdered(dto.schedule);
    // Validate approval-vote vs reviewer-count, falling back to the round's current values.
    this.assertSettings({
      filterReviewerCount: dto.filterReviewerCount ?? round.filterReviewerCount ?? undefined,
      filterApprovalVotes: dto.filterApprovalVotes ?? round.filterApprovalVotes ?? undefined,
      milestoneReviewerCount: dto.milestoneReviewerCount ?? round.milestoneReviewerCount ?? undefined,
      milestoneApprovalVotes: dto.milestoneApprovalVotes ?? round.milestoneApprovalVotes ?? undefined,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.round.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.budgetAda !== undefined ? { budgetAda: toLovelace(dto.budgetAda) } : {}),
          ...(dto.rewardsPoolAda !== undefined ? { rewardsPoolAda: toLovelace(dto.rewardsPoolAda) } : {}),
          // §6/§12 — only the per-round settings present in the DTO are updated.
          ...this.settingsData(dto),
        },
      });
      if (dto.categories) {
        // Reconcile by id so a category a proposal already points at isn't deleted/recreated:
        // update existing in place, create new ones, and remove only those with no proposals.
        const keepIds = new Set(dto.categories.filter((c) => c.id).map((c) => c.id as string));
        for (const ex of round.categories) {
          if (keepIds.has(ex.id)) continue;
          const used = await tx.proposal.count({ where: { categoryId: ex.id } });
          if (used > 0) {
            throw new ConflictException(`category "${ex.name}" has ${used} proposal(s) — it can't be removed`);
          }
          await tx.roundCategory.delete({ where: { id: ex.id } });
        }
        for (const c of dto.categories) {
          if (c.id) await tx.roundCategory.update({ where: { id: c.id }, data: this.categoryData(c) });
          else await tx.roundCategory.create({ data: { roundId: id, ...this.categoryData(c) } });
        }
      }
      if (dto.schedule) {
        await tx.roundSchedule.deleteMany({ where: { roundId: id } });
        await tx.roundSchedule.createMany({
          data: dto.schedule.map((s) => ({ roundId: id, ...this.scheduleData(s) })),
        });
      }
      if (dto.eligibleDrepIds) {
        const ids = await this.resolveEligibility(dto.eligibleDrepIds);
        await tx.roundDrepEligibility.deleteMany({ where: { roundId: id } });
        await tx.roundDrepEligibility.createMany({ data: ids.map((drepId) => ({ roundId: id, drepId })) });
      }
    });
    return this.get(id);
  }

  /**
   * §8 — board confirms the round's next stage: choose auto-start at the planned
   * date or manual launch, and confirm/adjust the window. Only the immediate next
   * stage can be confirmed, and its start must not precede the current stage's end.
   */
  async confirmStage(id: string, stageKey: string, dto: ConfirmStageDto, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id }, include: { schedule: true } });
    if (!round) throw new NotFoundException('round not found');

    const nextStatus = this.nextStatusOf(round.status);
    if (!nextStatus || STAGE_KEY_FOR_STATUS[nextStatus] !== stageKey) {
      throw new ConflictException(`${stageKey} is not the next stage for round #${round.number} (status ${round.status})`);
    }

    const existing = round.schedule.find((s) => s.stageKey === stageKey);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing?.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : existing?.endsAt;
    if (!startsAt || !endsAt) {
      throw new BadRequestException(`provide startsAt and endsAt to confirm the ${stageKey} stage`);
    }
    if (endsAt <= startsAt) throw new BadRequestException('endsAt must be after startsAt');

    // P7 — the next stage must start no earlier than the current stage's planned end.
    const currentKey = STAGE_KEY_FOR_STATUS[round.status];
    const current = currentKey ? round.schedule.find((s) => s.stageKey === currentKey) : undefined;
    if (current && startsAt < current.endsAt) {
      throw new BadRequestException(`${stageKey} cannot start before the ${currentKey} stage ends`);
    }

    await this.prisma.roundSchedule.upsert({
      where: { roundId_stageKey: { roundId: id, stageKey } },
      update: { startsAt, endsAt, autoStart: dto.autoStart, confirmedAt: new Date(), confirmedBy: userId },
      create: { roundId: id, stageKey, startsAt, endsAt, autoStart: dto.autoStart, confirmedAt: new Date(), confirmedBy: userId },
    });
    return this.get(id);
  }

  /**
   * §6 — update a FUTURE stage's planned start/end (and autoStart) without
   * advancing the round. Distinct from confirmStage which is reserved for the
   * immediate-next stage's transition. Useful when the board is mid-round and
   * wants to push Funding's dates a week later, etc. Refuses past, current,
   * and the immediate-next stage — those have dedicated controls.
   */
  async updatePlannedStage(id: string, stageKey: string, dto: { startsAt: string; endsAt: string; autoStart?: boolean }) {
    const round = await this.prisma.round.findUnique({ where: { id }, include: { schedule: true } });
    if (!round) throw new NotFoundException('round not found');
    const stageStatus = STATUS_FOR_STAGE_KEY[stageKey];
    if (!stageStatus) throw new BadRequestException(`unknown stage key: ${stageKey}`);
    const currentIdx = STATUS_SEQUENCE.indexOf(round.status);
    const stageIdx = STATUS_SEQUENCE.indexOf(stageStatus);
    if (stageIdx <= currentIdx) {
      throw new BadRequestException(`${stageKey} is not a future stage for round #${round.number} (current: ${round.status})`);
    }
    const nextStatus = this.nextStatusOf(round.status === RoundStatus.DV ? RoundStatus.VOTE : round.status);
    if (nextStatus && STAGE_KEY_FOR_STATUS[nextStatus] === stageKey) {
      throw new BadRequestException(`${stageKey} is the immediate next stage — use confirmStage instead`);
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('endsAt must be after startsAt');
    await this.prisma.roundSchedule.upsert({
      where: { roundId_stageKey: { roundId: id, stageKey } },
      update: { startsAt, endsAt, ...(dto.autoStart !== undefined ? { autoStart: dto.autoStart } : {}) },
      create: { roundId: id, stageKey, startsAt, endsAt, autoStart: dto.autoStart ?? false },
    });
    return this.get(id);
  }

  /**
   * §6 — shorten or extend the **current** stage. The start is frozen (the stage
   * already entered), so only `endsAt` is updatable. The new end must be in the
   * future and not push past the planned next stage's start (we'd need to shift
   * that too, which the board does separately via confirmStage).
   */
  async updateCurrentStageWindow(id: string, dto: { endsAt: string }, _userId: string) {
    void _userId;
    const round = await this.prisma.round.findUnique({ where: { id }, include: { schedule: true } });
    if (!round) throw new NotFoundException('round not found');
    const key = STAGE_KEY_FOR_STATUS[round.status];
    if (!key) throw new ConflictException('the round is not currently in a scheduled stage');
    const row = round.schedule.find((s) => s.stageKey === key);
    if (!row) throw new ConflictException('no schedule row for the current stage — nothing to edit');

    const newEnd = new Date(dto.endsAt);
    if (Number.isNaN(newEnd.getTime())) throw new BadRequestException('invalid end date');
    if (newEnd <= new Date()) throw new BadRequestException('the new end must be in the future');
    if (newEnd <= row.startsAt) throw new BadRequestException('the new end must be after the stage start');
    // P7 — keep schedule ordered. If the next stage is already confirmed and its
    // start is earlier than the new current-end, ask the board to push it first.
    const nextStatus = this.nextStatusOf(round.status);
    const nextKey = nextStatus ? STAGE_KEY_FOR_STATUS[nextStatus] : undefined;
    const nextRow = nextKey ? round.schedule.find((s) => s.stageKey === nextKey) : undefined;
    if (nextRow && newEnd > nextRow.startsAt) {
      throw new BadRequestException(
        `the new end (${newEnd.toISOString()}) would overlap the planned ${nextKey} start — push that stage first`,
      );
    }
    await this.prisma.roundSchedule.update({
      where: { roundId_stageKey: { roundId: id, stageKey: key } },
      data: { endsAt: newEnd },
    });
    return this.get(id);
  }

  /** §8 — manually launch the next stage now (a board member's explicit action). */
  async launchNextStage(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id } });
    if (!round) throw new NotFoundException('round not found');
    const nextStatus = this.nextStatusOf(round.status);
    if (!nextStatus) throw new ConflictException('round has no further stage to launch');
    if (nextStatus === RoundStatus.CLOSED) {
      throw new ConflictException('use closeRound to finish the round (the funding stage end is confirmed manually)');
    }
    return this.transitionTo(id, nextStatus, userId);
  }

  /** §8 — the round's final stage (Funding) ends only on an explicit board confirmation. */
  async closeRound(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id } });
    if (!round) throw new NotFoundException('round not found');
    if (round.status === RoundStatus.CLOSED) throw new ConflictException('round is already closed');
    return this.transitionTo(id, RoundStatus.CLOSED, userId);
  }

  /** §5.4/§26.5 — transition to an explicit stage (kept for board tooling/back-compat). */
  async startStage(id: string, stage: string) {
    const target = stage.toUpperCase();
    if (!STATUS_SEQUENCE.includes(target)) {
      throw new BadRequestException(`invalid stage; one of ${STATUS_SEQUENCE.join(', ')}`);
    }
    return this.transitionTo(id, target, null);
  }

  /**
   * Apply a stage transition. When entering a scheduled stage off its planned
   * start, shift that stage's window to start now and keep its planned duration
   * (recording the original start in prolongedFrom) — so delays don't compress it.
   */
  private async transitionTo(id: string, target: string, userId: string | null) {
    const round = await this.prisma.round.findUnique({ where: { id }, include: { schedule: true } });
    if (!round) throw new NotFoundException('round not found');

    // §5.1 — rounds may overlap, but only ONE reviewing stage (Filtering / Debate /
    // Vote) can be active across all rounds at a time, so DReps are never asked to
    // filter/vote two rounds at once. DV is treated as VOTE for the conflict check.
    const reviewingStatuses: string[] = [RoundStatus.FILTERING, RoundStatus.DEBATE, RoundStatus.VOTE, RoundStatus.DV];
    if (reviewingStatuses.includes(target)) {
      const other = await this.prisma.round.findFirst({
        where: { status: { in: reviewingStatuses }, id: { not: id } },
      });
      if (other) {
        throw new ConflictException(
          `round #${other.number} is already in ${other.status}; only one Filtering / Debate / Vote stage can be active at a time`,
        );
      }
    }

    // Find the schedule row for this target. Fall back to legacy 'debate_vote' so
    // pre-split rounds whose schedule wasn't migrated can still advance.
    const stageKeys = SCHEDULE_KEY_FOR_STATUS[target] ?? (STAGE_KEY_FOR_STATUS[target] ? [STAGE_KEY_FOR_STATUS[target]!] : []);
    const row = stageKeys.length ? round.schedule.find((s) => stageKeys.includes(s.stageKey)) : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.round.update({
        where: { id },
        data: {
          status: target,
          ...(target === RoundStatus.CLOSED ? { endedAt: new Date() } : {}),
        },
      });
      if (row) {
        const now = new Date();
        const durationMs = row.endsAt.getTime() - row.startsAt.getTime();
        const delayed = now.getTime() > row.startsAt.getTime();
        await tx.roundSchedule.update({
          where: { roundId_stageKey: { roundId: id, stageKey: row.stageKey } },
          data: {
            startsAt: now,
            endsAt: new Date(now.getTime() + durationMs),
            ...(delayed ? { prolongedFrom: row.prolongedFrom ?? row.startsAt } : {}),
            confirmedAt: row.confirmedAt ?? now,
            ...(userId && !row.confirmedBy ? { confirmedBy: userId } : {}),
          },
        });
      }
      // §3/§5 — moving out of SUBMISSION: any proposal whose fee was not paid +
      // confirmed by the board (i.e. still DRAFT or PENDING) is auto-REJECTED
      // with a clear reason. ACTIVE proposals proceed to FILTERING voting.
      if (round.status === RoundStatus.SUBMISSION && target !== RoundStatus.SUBMISSION && target !== RoundStatus.PREPARATION) {
        const stragglers = await tx.proposal.findMany({
          where: { roundId: id, status: { in: [ProposalStatus.DRAFT, ProposalStatus.PENDING] } },
          select: { id: true, status: true, submissionFeeTxHash: true },
        });
        for (const s of stragglers) {
          const reason = s.status === ProposalStatus.DRAFT
            ? 'Not submitted before the SUBMISSION phase ended.'
            : s.submissionFeeTxHash
              ? 'Submission fee was not confirmed by the board before the SUBMISSION phase ended.'
              : 'Submission fee was not paid before the SUBMISSION phase ended.';
          await tx.proposal.update({
            where: { id: s.id },
            data: { status: ProposalStatus.REJECTED, feeReviewFeedback: reason },
          });
        }
      }
    });
    // §8 — entering VOTE: refresh every DEBATE_VOTE-stage proposal's snapshot
    // so it reflects the FULL current electorate (admitted DReps + opted-in
    // board), then auto-open voting so the board doesn't have to click "open"
    // on each one manually. Skipped if DvService isn't wired in (rare — tests).
    if (target === RoundStatus.VOTE && this.dv) {
      await this.dv.openVotingForRound(id);
    }
    // §9.3 — leaving VOTE for FUNDING: finalize every D&V-stage proposal so
    // the result is published with the full vote turnout. Manual mid-VOTE
    // finalize is blocked at the DvService level, so this is the canonical
    // moment the tally crystallizes.
    if (target === RoundStatus.FUNDING && round.status === RoundStatus.VOTE && this.dv) {
      await this.dv.finalizeRound(id);
    }
    return this.get(id);
  }

  /**
   * Scheduler hook (§8 auto-start): advance every round whose confirmed, auto-start
   * next stage is now due. Skips the §5.1 single reviewing-stage conflict for later
   * retry. Returns the ids advanced.
   */
  async advanceDueStages(now = new Date()): Promise<string[]> {
    const candidates = await this.prisma.round.findMany({
      where: { status: { in: [RoundStatus.PREPARATION, RoundStatus.SUBMISSION, RoundStatus.FILTERING, RoundStatus.DEBATE, RoundStatus.VOTE, RoundStatus.DV] } },
      include: { schedule: true },
    });
    const advanced: string[] = [];
    for (const round of candidates) {
      const nextStatus = this.nextStatusOf(round.status === RoundStatus.DV ? RoundStatus.VOTE : round.status);
      if (!nextStatus || nextStatus === RoundStatus.CLOSED) continue;
      const keys = SCHEDULE_KEY_FOR_STATUS[nextStatus] ?? [];
      const row = round.schedule.find((s) => keys.includes(s.stageKey));
      if (!row || !row.autoStart || !row.confirmedAt) continue;
      if (row.startsAt.getTime() > now.getTime()) continue; // not due yet
      try {
        await this.transitionTo(round.id, nextStatus, row.confirmedBy ?? null);
        advanced.push(round.id);
      } catch {
        // e.g. another round holds the active reviewing stage (§5.1) — leave it for the next tick / manual launch.
      }
    }
    return advanced;
  }

  private nextStatusOf(status: string): string | null {
    const i = STATUS_SEQUENCE.indexOf(status);
    return i >= 0 && i < STATUS_SEQUENCE.length - 1 ? STATUS_SEQUENCE[i + 1] : null;
  }

  private computeNextStage(
    status: string,
    schedule: { stageKey: string; startsAt: Date; endsAt: Date; autoStart: boolean; confirmedAt: Date | null }[],
  ) {
    const nextStatus = this.nextStatusOf(status === RoundStatus.DV ? RoundStatus.VOTE : status);
    if (!nextStatus) return null;
    const stageKeys = SCHEDULE_KEY_FOR_STATUS[nextStatus] ?? []; // empty => CLOSED (manual)
    const row = stageKeys.length ? schedule.find((s) => stageKeys.includes(s.stageKey)) ?? null : null;
    return {
      status: nextStatus,
      stageKey: stageKeys[0] ?? null,
      manualOnly: nextStatus === RoundStatus.CLOSED,
      planned: row ? { startsAt: row.startsAt, endsAt: row.endsAt } : null,
      autoStart: row?.autoStart ?? false,
      confirmed: !!row?.confirmedAt,
    };
  }

  /**
   * §6/§12 — map the per-round settings present in the DTO onto round columns. Only
   * keys actually supplied are included: on create, omitted keys default to null
   * (→ the ROUND_SETTING_DEFAULTS value at read time); on update they stay unchanged.
   */
  private settingsData(dto: RoundSettingsInput) {
    const out: Record<string, number> = {};
    for (const key of Object.keys(ROUND_SETTING_DEFAULTS) as (keyof RoundSettingsInput)[]) {
      const v = dto[key];
      if (typeof v === 'number') out[key] = v;
    }
    return out;
  }

  /** §6 — an approval-vote count may not exceed its reviewer count. */
  private assertSettings(s: {
    filterReviewerCount?: number;
    filterApprovalVotes?: number;
    milestoneReviewerCount?: number;
    milestoneApprovalVotes?: number;
  }) {
    const filterReviewers = s.filterReviewerCount ?? ROUND_SETTING_DEFAULTS.filterReviewerCount;
    if (s.filterApprovalVotes != null && s.filterApprovalVotes > filterReviewers) {
      throw new BadRequestException(
        `filterApprovalVotes (${s.filterApprovalVotes}) cannot exceed filterReviewerCount (${filterReviewers})`,
      );
    }
    const milestoneReviewers = s.milestoneReviewerCount ?? ROUND_SETTING_DEFAULTS.milestoneReviewerCount;
    if (s.milestoneApprovalVotes != null && s.milestoneApprovalVotes > milestoneReviewers) {
      throw new BadRequestException(
        `milestoneApprovalVotes (${s.milestoneApprovalVotes}) cannot exceed milestoneReviewerCount (${milestoneReviewers})`,
      );
    }
  }

  private categoryData(c: CategoryInput) {
    return {
      name: c.name,
      type: c.type ?? 'GRANT',
      description: c.description ?? null,
      conditions: c.conditions ?? null,
      allocatedAda: toLovelace(c.allocatedAda),
      minAda: c.minAda == null ? null : toLovelace(c.minAda),
      maxAda: c.maxAda == null ? null : toLovelace(c.maxAda),
    };
  }

  private scheduleData(s: ScheduleInput) {
    const startsAt = new Date(s.startsAt);
    const endsAt = new Date(s.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException(`${s.stageKey}: endsAt must be after startsAt`);
    return { stageKey: s.stageKey, startsAt, endsAt };
  }

  /** P4 — a round can only be created/started once its whole budget is planned. */
  private assertCategoriesCoverBudget(categories: { allocatedAda: number }[], budgetAda: number) {
    const allocated = categories.reduce((s, c) => s + (Number(c.allocatedAda) || 0), 0);
    if (Math.round(allocated) !== Math.round(budgetAda)) {
      throw new BadRequestException(
        `categories must allocate the full budget: allocated ${allocated.toLocaleString()} ₳ of ${budgetAda.toLocaleString()} ₳`,
      );
    }
  }

  /**
   * P7 — schedule windows must be sensible: each stage ends after it starts, and the
   * canonical stages (submission → filtering → debate → vote → funding) that are
   * present must not overlap and must run in order. Legacy 'debate_vote' rows sort
   * between filtering and funding (where they used to live).
   */
  private assertScheduleOrdered(schedule?: ScheduleInput[]) {
    if (!schedule || schedule.length === 0) return;
    const order = ['submission', 'filtering', 'debate_vote', 'debate', 'vote', 'funding'];
    const present = [...schedule].sort((a, b) => order.indexOf(a.stageKey) - order.indexOf(b.stageKey));
    let prevEnd: Date | null = null;
    let prevLabel = '';
    for (const s of present) {
      const start = new Date(s.startsAt);
      const end = new Date(s.endsAt);
      if (end <= start) throw new BadRequestException(`${s.stageKey}: end must be after start`);
      if (prevEnd && start < prevEnd) {
        throw new BadRequestException(`${s.stageKey} must start after the ${prevLabel} stage ends`);
      }
      prevEnd = end;
      prevLabel = s.stageKey;
    }
  }

  /** Explicit drep ids (validated ADMITTED) or default to all admitted DReps. */
  private async resolveEligibility(ids?: string[]): Promise<string[]> {
    if (ids && ids.length > 0) {
      const found = await this.prisma.drep.findMany({
        where: { id: { in: ids }, status: DRepStatus.ADMITTED },
        select: { id: true },
      });
      if (found.length !== ids.length) {
        throw new BadRequestException('some eligibleDrepIds are not admitted DReps');
      }
      return found.map((d) => d.id);
    }
    const all = await this.prisma.drep.findMany({
      where: { status: DRepStatus.ADMITTED },
      select: { id: true },
    });
    return all.map((d) => d.id);
  }
}
