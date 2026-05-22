import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PLATFORM_CONFIG_DEFAULTS,
  ProposalStatus,
  ProposalStage,
  ProposalType,
  RoundStatus,
  VotingType,
} from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProposalDto, MilestoneInput, SubmitProposalDto, UpdateProposalDto } from './dto';

const LOVELACE = 1_000_000;
const toLovelace = (ada: number): bigint => BigInt(Math.round(ada * LOVELACE));
const toAda = (l: bigint | null): number => (l == null ? 0 : Number(l) / LOVELACE);

@Injectable()
export class ProposalsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(userId: string, dto: CreateProposalDto) {
    // §3/§19 — proposals can only be submitted while the round's submission
    // window is open (a board member moves the round into the SUBMISSION stage).
    const round = await this.prisma.round.findUnique({ where: { id: dto.roundId } });
    if (!round) throw new BadRequestException('round not found');
    if (round.status !== RoundStatus.SUBMISSION) {
      throw new BadRequestException(
        `round #${round.number} is not accepting submissions (current stage: ${round.status}). ` +
          'A board member must open the Submission stage first.',
      );
    }
    const category = await this.prisma.roundCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category || category.roundId !== dto.roundId) {
      throw new BadRequestException('category does not belong to that round');
    }
    this.assertMilestonesSum(dto.milestones, dto.requestedAmountAda);

    const drep = await this.prisma.drep.findUnique({ where: { userId } });

    const proposal = await this.prisma.proposal.create({
      data: {
        type: ProposalType.FUNDING,
        status: ProposalStatus.DRAFT,
        submitterUserId: userId,
        submitterDrepId: drep?.id ?? null,
        title: dto.title,
        contentMd: dto.contentMd,
        categoryId: dto.categoryId,
        roundId: dto.roundId,
        subcategoryIds: dto.subcategoryIds ?? [],
        isCommercial: dto.isCommercial,
        requestedAmountAda: toLovelace(dto.requestedAmountAda),
        costBreakdownMd: dto.costBreakdownMd ?? null,
        votingType: VotingType.ONE_PERSON_ONE_VOTE,
        milestones: {
          create: dto.milestones.map((m, idx) => ({
            idx,
            description: m.description,
            amountAda: toLovelace(m.amountAda),
            status: 'NOT_STARTED',
          })),
        },
      },
    });
    return this.get(proposal.id, userId);
  }

  async updateDraft(userId: string, id: string, dto: UpdateProposalDto) {
    const p = await this.ownDraft(userId, id);
    if (dto.milestones) {
      const total = dto.requestedAmountAda ?? toAda(p.requestedAmountAda);
      this.assertMilestonesSum(dto.milestones, total);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.proposal.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.contentMd !== undefined ? { contentMd: dto.contentMd } : {}),
          ...(dto.isCommercial !== undefined ? { isCommercial: dto.isCommercial } : {}),
          ...(dto.requestedAmountAda !== undefined ? { requestedAmountAda: toLovelace(dto.requestedAmountAda) } : {}),
          ...(dto.subcategoryIds !== undefined ? { subcategoryIds: dto.subcategoryIds } : {}),
          ...(dto.costBreakdownMd !== undefined ? { costBreakdownMd: dto.costBreakdownMd } : {}),
          updatedAt: new Date(),
        },
      });
      if (dto.milestones) {
        await tx.milestone.deleteMany({ where: { proposalId: id } });
        await tx.milestone.createMany({
          data: dto.milestones.map((m, idx) => ({
            proposalId: id,
            idx,
            description: m.description,
            amountAda: toLovelace(m.amountAda),
            status: 'NOT_STARTED',
          })),
        });
      }
    });
    return this.get(id, userId);
  }

  /** §3.3 — submit: compute fee, move DRAFT → PENDING (awaiting fee confirmation). */
  async submit(userId: string, id: string, dto: SubmitProposalDto) {
    const p = await this.ownDraft(userId, id);
    const fee = await this.computeFee(toAda(p.requestedAmountAda), p.isCommercial ?? false);
    await this.prisma.proposal.update({
      where: { id },
      data: {
        status: ProposalStatus.PENDING,
        submissionFeeAda: toLovelace(fee),
        submissionFeeTxHash: dto.submissionFeeTxHash,
        submittedAt: new Date(),
      },
    });
    return this.get(id, userId);
  }

  /** §26.5 board override — confirm fee received → ACTIVE in FILTERING (on-chain verify deferred). */
  async confirmFee(id: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.status !== ProposalStatus.PENDING) {
      throw new ConflictException('proposal is not awaiting fee confirmation');
    }
    await this.prisma.proposal.update({
      where: { id },
      data: { status: ProposalStatus.ACTIVE, stage: ProposalStage.FILTERING },
    });
    return this.get(id);
  }

  async listByRound(roundId: string, status?: string) {
    // Never expose DRAFTs publicly.
    const statusFilter = status && status !== ProposalStatus.DRAFT ? status : { not: ProposalStatus.DRAFT };
    const proposals = await this.prisma.proposal.findMany({
      where: { roundId, status: statusFilter },
      orderBy: { createdAt: 'asc' },
      include: { category: { select: { name: true } } },
    });
    return proposals.map((p) => this.summary(p));
  }

  async listMine(userId: string) {
    const proposals = await this.prisma.proposal.findMany({
      where: { submitterUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: { category: { select: { name: true } } },
    });
    return proposals.map((p) => this.summary(p));
  }

  async get(id: string, viewerUserId?: string) {
    const p = await this.prisma.proposal.findUnique({
      where: { id },
      include: { milestones: { orderBy: { idx: 'asc' } }, category: { select: { name: true } } },
    });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.status === ProposalStatus.DRAFT && p.submitterUserId !== viewerUserId) {
      throw new NotFoundException('proposal not found');
    }
    return {
      ...this.summary(p),
      contentMd: p.contentMd,
      costBreakdownMd: p.costBreakdownMd,
      submissionFeeAda: toAda(p.submissionFeeAda),
      submissionFeeTxHash: p.submissionFeeTxHash,
      subcategoryIds: p.subcategoryIds,
      milestones: p.milestones.map((m) => ({
        id: m.id,
        idx: m.idx,
        description: m.description,
        amountAda: toAda(m.amountAda),
        status: m.status,
      })),
    };
  }

  private summary(p: {
    id: string;
    type: string;
    status: string;
    stage: string | null;
    title: string;
    categoryId: string | null;
    roundId: string | null;
    isCommercial: boolean | null;
    requestedAmountAda: bigint | null;
    createdAt: Date;
    category?: { name: string } | null;
  }) {
    return {
      id: p.id,
      type: p.type,
      status: p.status,
      stage: p.stage,
      title: p.title,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      roundId: p.roundId,
      isCommercial: p.isCommercial,
      requestedAmountAda: toAda(p.requestedAmountAda),
      createdAt: p.createdAt,
    };
  }

  private async ownDraft(userId: string, id: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    if (p.status !== ProposalStatus.DRAFT) {
      throw new ConflictException('proposal can only be edited while in DRAFT');
    }
    return p;
  }

  private assertMilestonesSum(milestones: MilestoneInput[], requestedAda: number) {
    const sum = milestones.reduce((acc, m) => acc + m.amountAda, 0);
    if (sum !== requestedAda) {
      throw new BadRequestException(`milestone amounts (${sum}) must sum to requested amount (${requestedAda})`);
    }
  }

  /** §12 fee tiers from platform_config (with defaults). */
  private async computeFee(requestedAda: number, isCommercial: boolean): Promise<number> {
    const pctKey = isCommercial ? 'FEE_COMMERCIAL_PCT' : 'FEE_OSS_PCT';
    const capKey = isCommercial ? 'FEE_COMMERCIAL_CAP_ADA' : 'FEE_OSS_CAP_ADA';
    const pct = await this.cfg(pctKey);
    const cap = await this.cfg(capKey);
    return Math.min((requestedAda * pct) / 100, cap);
  }

  private async cfg(key: keyof typeof PLATFORM_CONFIG_DEFAULTS): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    const v = row?.value;
    return typeof v === 'number' ? v : (PLATFORM_CONFIG_DEFAULTS[key] as number);
  }
}
