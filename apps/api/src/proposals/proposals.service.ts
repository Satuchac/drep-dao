import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ROUND_SETTING_DEFAULTS,
  ProposalStatus,
  ProposalStage,
  ProposalType,
  RoundStatus,
  VotingType,
} from '@drep-dao/shared';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { CreateProposalDto, MilestoneInput, SubmitProposalDto, UpdateProposalDto } from './dto';

const LOVELACE = 1_000_000;
const toLovelace = (ada: number): bigint => BigInt(Math.round(ada * LOVELACE));
const toAda = (l: bigint | null): number => (l == null ? 0 : Number(l) / LOVELACE);

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cardano: CardanoQueryService,
  ) {}

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
    // §5.2 — the requested amount must fit the category's min/max ask (when the board set them).
    const catMin = category.minAda == null ? null : toAda(category.minAda);
    const catMax = category.maxAda == null ? null : toAda(category.maxAda);
    if (catMin != null && dto.requestedAmountAda < catMin) {
      throw new BadRequestException(
        `requested ${dto.requestedAmountAda.toLocaleString()} ₳ is below the "${category.name}" minimum ask of ${catMin.toLocaleString()} ₳`,
      );
    }
    if (catMax != null && dto.requestedAmountAda > catMax) {
      throw new BadRequestException(
        `requested ${dto.requestedAmountAda.toLocaleString()} ₳ exceeds the "${category.name}" maximum ask of ${catMax.toLocaleString()} ₳`,
      );
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
        // §3.4 funding fields (stored in the existing Json columns as markdown strings).
        ...(dto.teamInfoMd ? { teamInfo: dto.teamInfoMd } : {}),
        ...(dto.revenueSharingMd ? { revenueSharing: dto.revenueSharingMd } : {}),
        votingType: VotingType.ONE_PERSON_ONE_VOTE,
        milestones: {
          create: dto.milestones.map((m, idx) => ({
            idx,
            title: m.title ?? null,
            description: m.description,
            acceptanceCriteria: m.acceptanceCriteria ?? null,
            amountAda: toLovelace(m.amountAda),
            status: 'NOT_STARTED',
          })),
        },
      },
    });
    return this.get(proposal.id, userId);
  }

  /**
   * Edit a proposal. Allowed while DRAFT, or — per §7/§8 — by the submitter during
   * the FILTERING stage and the DEBATE_VOTE stage *before voting opens*. Every edit
   * after submission snapshots the prior content into ProposalVersion (audit + diff)
   * and bumps `version`. Milestones can only be (re)structured while still a DRAFT.
   */
  async updateDraft(userId: string, id: string, dto: UpdateProposalDto) {
    const { proposal: p, postSubmission } = await this.ownEditable(userId, id);
    if (dto.milestones) {
      if (postSubmission) {
        throw new ConflictException('milestones cannot be restructured after submission');
      }
      const total = dto.requestedAmountAda ?? toAda(p.requestedAmountAda);
      this.assertMilestonesSum(dto.milestones, total);
    }
    await this.prisma.$transaction(async (tx) => {
      if (postSubmission) {
        // Snapshot the version being replaced so reviewers can see what changed.
        await tx.proposalVersion.create({
          data: { proposalId: id, version: p.version, contentMd: p.contentMd, editedBy: userId },
        });
      }
      await tx.proposal.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.contentMd !== undefined ? { contentMd: dto.contentMd } : {}),
          ...(dto.isCommercial !== undefined ? { isCommercial: dto.isCommercial } : {}),
          ...(dto.requestedAmountAda !== undefined ? { requestedAmountAda: toLovelace(dto.requestedAmountAda) } : {}),
          ...(dto.subcategoryIds !== undefined ? { subcategoryIds: dto.subcategoryIds } : {}),
          ...(dto.costBreakdownMd !== undefined ? { costBreakdownMd: dto.costBreakdownMd } : {}),
          ...(dto.teamInfoMd !== undefined ? { teamInfo: dto.teamInfoMd } : {}),
          ...(dto.revenueSharingMd !== undefined ? { revenueSharing: dto.revenueSharingMd } : {}),
          ...(postSubmission ? { version: { increment: 1 } } : {}),
          updatedAt: new Date(),
        },
      });
      if (dto.milestones && !postSubmission) {
        await tx.milestone.deleteMany({ where: { proposalId: id } });
        await tx.milestone.createMany({
          data: dto.milestones.map((m, idx) => ({
            proposalId: id,
            idx,
            title: m.title ?? null,
            description: m.description,
            acceptanceCriteria: m.acceptanceCriteria ?? null,
            amountAda: toLovelace(m.amountAda),
            status: 'NOT_STARTED',
          })),
        });
      }
    });
    return this.get(id, userId);
  }

  /** Content version history (snapshots + the current head) for the diff view. */
  async versions(id: string) {
    const p = await this.prisma.proposal.findUnique({
      where: { id },
      select: { version: true, contentMd: true, updatedAt: true, status: true, submitterUserId: true },
    });
    if (!p || p.status === ProposalStatus.DRAFT) return [];
    const snapshots = await this.prisma.proposalVersion.findMany({
      where: { proposalId: id },
      orderBy: { version: 'asc' },
      include: { editor: { select: { displayName: true } } },
    });
    const history = snapshots.map((s) => ({
      version: s.version,
      contentMd: s.contentMd,
      editedAt: s.editedAt,
      editor: s.editor?.displayName ?? null,
      current: false,
    }));
    history.push({ version: p.version, contentMd: p.contentMd, editedAt: p.updatedAt, editor: null, current: true });
    return history;
  }

  /** §3.3 — submit: compute fee, move DRAFT → PENDING (awaiting fee confirmation). */
  async submit(userId: string, id: string, dto: SubmitProposalDto) {
    const p = await this.ownDraft(userId, id);
    const fee = await this.computeFee(toAda(p.requestedAmountAda), p.isCommercial ?? false, p.roundId);
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

  // §16 — a proposal is public only once its fee is confirmed; DRAFT (private) and
  // PENDING (submitted, fee not yet confirmed) are never shown in public listings.
  private static readonly PRIVATE_STATUSES: ProposalStatus[] = [ProposalStatus.DRAFT, ProposalStatus.PENDING];

  async listByRound(roundId: string, status?: string) {
    const statusFilter =
      status && !ProposalsService.PRIVATE_STATUSES.includes(status as ProposalStatus)
        ? status
        : { notIn: ProposalsService.PRIVATE_STATUSES };
    const proposals = await this.prisma.proposal.findMany({
      where: { roundId, status: statusFilter },
      orderBy: { createdAt: 'asc' },
      include: { category: { select: { name: true } } },
    });
    return proposals.map((p) => this.summary(p));
  }

  /**
   * §16 — proposals awaiting board fee confirmation (drives the board notification +
   * My-area list). The platform verifies each fee ON-CHAIN: it looks up the provided
   * tx hash and checks that ≥ the expected fee was paid to the submission-fee address,
   * surfacing a paid/not-paid hint so the board doesn't have to eyeball the explorer.
   */
  async listPendingFee() {
    const rows = await this.prisma.proposal.findMany({
      where: { status: ProposalStatus.PENDING },
      orderBy: { submittedAt: 'asc' },
      include: {
        submitterUser: { select: { displayName: true } },
        category: { select: { name: true } },
        round: { select: { number: true } },
      },
    });
    const feeAddress = this.config.get<string>('SUBMISSION_FEE_ADDRESS') ?? this.config.get<string>('TREASURY_ADDRESS') ?? '';
    return Promise.all(
      rows.map(async (p) => {
        const v =
          p.submissionFeeTxHash && feeAddress
            ? await this.cardano.verifyPayment(p.submissionFeeTxHash, feeAddress, p.submissionFeeAda ?? 0n)
            : { found: false, paid: false, paidLovelace: 0n };
        return {
          id: p.id,
          title: p.title,
          roundNumber: p.round?.number ?? null,
          categoryName: p.category?.name ?? null,
          isCommercial: p.isCommercial,
          requestedAmountAda: toAda(p.requestedAmountAda),
          submissionFeeAda: toAda(p.submissionFeeAda),
          submissionFeeTxHash: p.submissionFeeTxHash,
          submitter: p.submitterUser?.displayName ?? null,
          submittedAt: p.submittedAt,
          // On-chain verification result for the board's "fee paid?" hint.
          feeVerified: { found: v.found, paid: v.paid, paidAda: toAda(v.paidLovelace) },
        };
      }),
    );
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
      include: {
        milestones: { orderBy: { idx: 'asc' } },
        category: { select: { name: true, minAda: true, maxAda: true, conditions: true } },
      },
    });
    if (!p) throw new NotFoundException('proposal not found');
    // DRAFT + PENDING (fee not yet confirmed) are visible only to their submitter.
    if (ProposalsService.PRIVATE_STATUSES.includes(p.status as ProposalStatus) && p.submitterUserId !== viewerUserId) {
      throw new NotFoundException('proposal not found');
    }
    return {
      ...this.summary(p),
      contentMd: p.contentMd,
      costBreakdownMd: p.costBreakdownMd,
      // §3.4 — stored as markdown strings in the Json columns.
      teamInfoMd: typeof p.teamInfo === 'string' ? p.teamInfo : null,
      revenueSharingMd: typeof p.revenueSharing === 'string' ? p.revenueSharing : null,
      submissionFeeAda: toAda(p.submissionFeeAda),
      submissionFeeTxHash: p.submissionFeeTxHash,
      subcategoryIds: p.subcategoryIds,
      // §5.2 — the category's funding-request bounds + conditions, for display.
      categoryAsk: {
        minAda: p.category?.minAda == null ? null : toAda(p.category.minAda),
        maxAda: p.category?.maxAda == null ? null : toAda(p.category.maxAda),
        conditions: p.category?.conditions ?? null,
      },
      milestones: p.milestones.map((m) => ({
        id: m.id,
        idx: m.idx,
        title: m.title,
        description: m.description,
        acceptanceCriteria: m.acceptanceCriteria,
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

  /**
   * §7/§8 editing windows. Returns the proposal and whether this is a
   * post-submission edit (which must be versioned). Editable while:
   *  - DRAFT, or
   *  - FILTERING stage (status ACTIVE) — submitter revises during the feedback rounds, or
   *  - DEBATE_VOTE stage *before voting opens* (votingStartAt null) — the editing sub-phase.
   * No edits during the D&V voting phase or after a final decision.
   */
  private async ownEditable(userId: string, id: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    if (p.status === ProposalStatus.DRAFT) return { proposal: p, postSubmission: false };
    const inFiltering = p.stage === ProposalStage.FILTERING && p.status === ProposalStatus.ACTIVE;
    const inDvEditing = p.stage === ProposalStage.DEBATE_VOTE && p.votingStartAt == null;
    if (inFiltering || inDvEditing) return { proposal: p, postSubmission: true };
    throw new ConflictException(
      'editing is closed: proposals can be edited while in DRAFT, during Filtering, or during Debate & Vote before voting opens',
    );
  }

  private assertMilestonesSum(milestones: MilestoneInput[], requestedAda: number) {
    const sum = milestones.reduce((acc, m) => acc + m.amountAda, 0);
    if (sum !== requestedAda) {
      throw new BadRequestException(`milestone amounts (${sum}) must sum to requested amount (${requestedAda})`);
    }
  }

  /** §12 fee tiers — per-round settings (fall back to the ROUND_SETTING_DEFAULTS value). */
  private async computeFee(requestedAda: number, isCommercial: boolean, roundId: string | null): Promise<number> {
    const round = roundId
      ? await this.prisma.round.findUnique({
          where: { id: roundId },
          select: { feeCommercialPct: true, feeCommercialCapAda: true, feeOssPct: true, feeOssCapAda: true },
        })
      : null;
    const pct = isCommercial
      ? round?.feeCommercialPct ?? ROUND_SETTING_DEFAULTS.feeCommercialPct
      : round?.feeOssPct ?? ROUND_SETTING_DEFAULTS.feeOssPct;
    const cap = isCommercial
      ? round?.feeCommercialCapAda ?? ROUND_SETTING_DEFAULTS.feeCommercialCapAda
      : round?.feeOssCapAda ?? ROUND_SETTING_DEFAULTS.feeOssCapAda;
    return Math.min((requestedAda * pct) / 100, cap);
  }
}
