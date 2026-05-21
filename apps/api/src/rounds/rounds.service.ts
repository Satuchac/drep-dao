import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DRepStatus, RoundStatus } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoundDto, UpdateRoundDto, CategoryInput, ScheduleInput } from './dto';

const LOVELACE = 1_000_000;
const toLovelace = (ada: number): bigint => BigInt(Math.round(ada * LOVELACE));
const toAda = (lovelace: bigint | null): number => (lovelace == null ? 0 : Number(lovelace) / LOVELACE);

@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** §6 — board creates a round in PREPARATION with categories, schedule, eligibility. */
  async create(dto: CreateRoundDto) {
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
    return rounds.map((r) => ({
      id: r.id,
      number: r.number,
      name: r.name,
      status: r.status,
      budgetAda: toAda(r.budgetAda),
      rewardsPoolAda: toAda(r.rewardsPoolAda),
      categoryCount: r.categories.length,
      eligibleCount: r._count.eligibilities,
      proposalCount: r._count.proposals,
      createdAt: r.createdAt,
    }));
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
    return {
      id: r.id,
      number: r.number,
      name: r.name,
      status: r.status,
      budgetAda: toAda(r.budgetAda),
      rewardsPoolAda: toAda(r.rewardsPoolAda),
      multisigAddress: r.multisigAddress,
      intersectTxHash: r.intersectTxHash,
      eligibleCount: r._count.eligibilities,
      proposalCount: r._count.proposals,
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
      schedule: r.schedule.map((s) => ({ stageKey: s.stageKey, startsAt: s.startsAt, endsAt: s.endsAt })),
      createdAt: r.createdAt,
      endedAt: r.endedAt,
    };
  }

  /** Editable only while in PREPARATION (§6 settings remain editable; MVP limits to prep). */
  async update(id: string, dto: UpdateRoundDto) {
    const round = await this.prisma.round.findUnique({ where: { id } });
    if (!round) throw new NotFoundException('round not found');
    if (round.status !== RoundStatus.PREPARATION) {
      throw new ConflictException('round can only be edited during PREPARATION');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.round.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.budgetAda !== undefined ? { budgetAda: toLovelace(dto.budgetAda) } : {}),
          ...(dto.rewardsPoolAda !== undefined ? { rewardsPoolAda: toLovelace(dto.rewardsPoolAda) } : {}),
        },
      });
      if (dto.categories) {
        await tx.roundCategory.deleteMany({ where: { roundId: id } });
        await tx.roundCategory.createMany({
          data: dto.categories.map((c) => ({ roundId: id, ...this.categoryData(c) })),
        });
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

  /** §5.4/§26.5 — manually transition the round's stage. */
  async startStage(id: string, stage: string) {
    const target = stage.toUpperCase();
    const allowed = Object.values(RoundStatus) as string[];
    if (!allowed.includes(target)) {
      throw new BadRequestException(`invalid stage; one of ${allowed.join(', ')}`);
    }
    const round = await this.prisma.round.findUnique({ where: { id } });
    if (!round) throw new NotFoundException('round not found');

    // §5.1 — only one Filtering stage active across all rounds.
    if (target === RoundStatus.FILTERING) {
      const other = await this.prisma.round.findFirst({
        where: { status: RoundStatus.FILTERING, id: { not: id } },
      });
      if (other) throw new ConflictException(`round #${other.number} is already in FILTERING`);
    }

    await this.prisma.round.update({
      where: { id },
      data: {
        status: target,
        ...(target === RoundStatus.CLOSED ? { endedAt: new Date() } : {}),
      },
    });
    return this.get(id);
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
