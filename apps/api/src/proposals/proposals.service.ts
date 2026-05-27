import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
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
import { AnchorService } from '../cardano/anchor.service';
import { BudgetChangeDto, CreateProposalDto, MilestoneInput, ReviewFeeDto, SubmitProposalDto, UpdateProposalDto } from './dto';

const LOVELACE = 1_000_000;
const toLovelace = (ada: number): bigint => BigInt(Math.round(ada * LOVELACE));
const toAda = (l: bigint | null): number => (l == null ? 0 : Number(l) / LOVELACE);

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cardano: CardanoQueryService,
    // Optional so service-level test scripts can `new ProposalsService(prisma, config, cardano)`
    // without an anchor wallet — anchoring is then simply skipped.
    @Optional() private readonly anchor?: AnchorService,
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
        // §12 — the fee tx hash can be saved with the draft and is verified on-chain at submission.
        submissionFeeTxHash: dto.submissionFeeTxHash ?? null,
        submissionFeeTxHashes: dto.submissionFeeTxHash ? [dto.submissionFeeTxHash] : [],
        payoutAddress: dto.payoutAddress?.trim() || null,
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
    // A draft may be re-categorised, but only within its own round.
    if (dto.categoryId && dto.categoryId !== p.categoryId) {
      const cat = await this.prisma.roundCategory.findUnique({ where: { id: dto.categoryId } });
      if (!cat || cat.roundId !== p.roundId) {
        throw new BadRequestException('category does not belong to this proposal’s round');
      }
    }
    // §12 anti-gaming — the fee-determining inputs (requested amount + commercial flag) are
    // LOCKED once a fee has been quoted (anything past DRAFT/fee-REJECTED). Otherwise a
    // submitter could quote+pay a small fee, then raise the budget for free. A fee-rejected
    // proposal has no accepted payment, so it (like a draft) is still freely editable; an
    // ACTIVE budget change goes through requestBudgetChange (which settles the fee delta).
    const feeRejected = p.status === ProposalStatus.REJECTED && p.stage == null;
    const amountLocked = !(p.status === ProposalStatus.DRAFT || feeRejected);
    if (amountLocked) {
      if (dto.requestedAmountAda != null && dto.requestedAmountAda !== toAda(p.requestedAmountAda)) {
        throw new BadRequestException('the requested amount is locked after submission — request a budget change instead');
      }
      if (dto.isCommercial != null && dto.isCommercial !== (p.isCommercial ?? false)) {
        throw new BadRequestException('the commercial flag is locked after submission (it determines the fee)');
      }
    }
    // The fee tx hash is editable only while pre-public (DRAFT/PENDING/fee-REJECTED; locked
    // once ACTIVE); each new distinct value is appended to the history the reviewer sees.
    const txEditable = p.status === ProposalStatus.DRAFT || p.status === ProposalStatus.PENDING || feeRejected;
    let feeHashData: { submissionFeeTxHash?: string | null; submissionFeeTxHashes?: string[] } = {};
    if (dto.submissionFeeTxHash !== undefined && txEditable) {
      const hash = dto.submissionFeeTxHash || null;
      const history = hash && !p.submissionFeeTxHashes.includes(hash) ? [...p.submissionFeeTxHashes, hash] : p.submissionFeeTxHashes;
      feeHashData = { submissionFeeTxHash: hash, submissionFeeTxHashes: history };
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
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.contentMd !== undefined ? { contentMd: dto.contentMd } : {}),
          ...(dto.isCommercial !== undefined ? { isCommercial: dto.isCommercial } : {}),
          ...(dto.requestedAmountAda !== undefined ? { requestedAmountAda: toLovelace(dto.requestedAmountAda) } : {}),
          ...(dto.subcategoryIds !== undefined ? { subcategoryIds: dto.subcategoryIds } : {}),
          ...(dto.costBreakdownMd !== undefined ? { costBreakdownMd: dto.costBreakdownMd } : {}),
          ...(dto.payoutAddress !== undefined ? { payoutAddress: dto.payoutAddress || null } : {}),
          ...feeHashData,
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

  /**
   * §3.3/§12 — submit. If the round's fee for this proposal type is **0%**, no payment is
   * needed and the proposal goes straight to ACTIVE (Filtering). Otherwise a fee tx hash is
   * required and the proposal moves to PENDING for the board to confirm the on-chain payment.
   */
  async submit(userId: string, id: string, dto: SubmitProposalDto) {
    const p = await this.ownDraft(userId, id);
    const fee = await this.computeFee(toAda(p.requestedAmountAda), p.isCommercial ?? false, p.roundId);
    if (fee <= 0) {
      // No fee for this proposal type → admit immediately, no board fee confirmation.
      const publicId = p.publicId ?? (await this.nextPublicId(p.roundId));
      await this.prisma.proposal.update({
        where: { id },
        data: { status: ProposalStatus.ACTIVE, stage: ProposalStage.FILTERING, submissionFeeAda: 0n, submittedAt: new Date(), feeReviewFeedback: null, publicId },
      });
      await this.anchorActivation(id, { required: false, paid: false, ada: 0, txHash: null });
      return this.get(id, userId);
    }
    const hash = dto.submissionFeeTxHash?.trim();
    if (!hash) {
      throw new BadRequestException('a submission-fee transaction hash is required for this proposal');
    }
    const history = p.submissionFeeTxHashes.includes(hash) ? p.submissionFeeTxHashes : [...p.submissionFeeTxHashes, hash];
    await this.prisma.proposal.update({
      where: { id },
      data: {
        status: ProposalStatus.PENDING,
        submissionFeeAda: toLovelace(fee),
        submissionFeeTxHash: hash,
        submissionFeeTxHashes: history,
        submittedAt: new Date(),
        // A re-submission after a fee rejection starts a fresh review.
        feeReviewFeedback: null,
      },
    });
    return this.get(id, userId);
  }

  /**
   * §26.5 board fee review of a PENDING proposal. APPROVE → ACTIVE in Filtering (the tx is
   * now locked); REJECT → REJECTED (feedback required). The feedback (also optional on
   * approve) is shown to the submitter in the red FEEDBACK box next to the fee tx.
   */
  async reviewFee(id: string, dto: ReviewFeeDto) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.status !== ProposalStatus.PENDING) {
      throw new ConflictException('proposal is not awaiting fee confirmation');
    }
    const feedback = dto.feedback?.trim() || null;
    if (dto.decision === 'REJECT' && !feedback) {
      throw new BadRequestException('a reason is required when rejecting a submission fee');
    }
    if (dto.decision === 'APPROVE') {
      const publicId = p.publicId ?? (await this.nextPublicId(p.roundId));
      await this.prisma.proposal.update({
        where: { id },
        data: { status: ProposalStatus.ACTIVE, stage: ProposalStage.FILTERING, feeReviewFeedback: feedback, publicId },
      });
      // Fee was paid + confirmed → anchor the acceptance with the paying tx.
      await this.anchorActivation(id, { required: true, paid: true, ada: toAda(p.submissionFeeAda), txHash: p.submissionFeeTxHash });
    } else {
      await this.prisma.proposal.update({ where: { id }, data: { status: ProposalStatus.REJECTED, feeReviewFeedback: feedback } });
    }
    return this.get(id);
  }

  /**
   * §12 — the submitter changes an ACTIVE proposal's budget. The amount + milestones update
   * immediately, and the **fee delta** becomes a settlement task for the board: increasing the
   * budget owes MORE fee (TOPUP), decreasing returns fee (REFUND). The board records the tx
   * (My Area → Payments). Locked elsewhere (see updateDraft) so this is the only way to move it.
   */
  async requestBudgetChange(userId: string, id: string, dto: BudgetChangeDto) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    if (p.status !== ProposalStatus.ACTIVE) {
      throw new ConflictException('the budget can only be changed once the proposal is ACTIVE (fee settled)');
    }
    const newAmount = dto.requestedAmountAda;
    const oldAmount = toAda(p.requestedAmountAda);
    if (newAmount === oldAmount) throw new BadRequestException('the requested amount is unchanged');
    await this.assertAmountInCategory(p.categoryId, newAmount);
    this.assertMilestonesSum(dto.milestones, newAmount);

    const oldFee = toAda(p.submissionFeeAda); // fee accounted for so far
    const newFee = await this.computeFee(newAmount, p.isCommercial ?? false, p.roundId);
    const delta = Math.round((newFee - oldFee) * 1e6) / 1e6;

    await this.prisma.$transaction(async (tx) => {
      await tx.proposal.update({
        where: { id },
        data: { requestedAmountAda: toLovelace(newAmount), submissionFeeAda: toLovelace(newFee) },
      });
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
      if (delta !== 0) {
        const kind = delta > 0 ? 'TOPUP' : 'REFUND';
        await tx.feeAdjustment.create({
          data: {
            proposalId: id,
            kind,
            amountAda: toLovelace(Math.abs(delta)),
            prevAmountAda: toLovelace(oldAmount),
            newAmountAda: toLovelace(newAmount),
            prevFeeAda: toLovelace(oldFee),
            newFeeAda: toLovelace(newFee),
            status: 'PENDING',
            note: `Budget ${delta > 0 ? 'increased' : 'decreased'} ${oldAmount.toLocaleString()} → ${newAmount.toLocaleString()} ₳`,
          },
        });
      }
    });
    return this.get(id, userId);
  }

  /**
   * §12 — board fee settlements (top-ups owed by submitters / refunds owed to them). By default
   * only the outstanding (PENDING) ones; `includeSettled` adds the settled history for auditing.
   */
  async listPayments(includeSettled = false) {
    const rows = await this.prisma.feeAdjustment.findMany({
      where: includeSettled ? {} : { status: 'PENDING' },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], // PENDING before SETTLED, newest first
      include: {
        proposal: {
          select: { publicId: true, title: true, payoutAddress: true, submitterUser: { select: { displayName: true } }, submitterDrep: { select: { drepIdOnchain: true } } },
        },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      kind: a.kind, // TOPUP | REFUND
      status: a.status, // PENDING | SETTLED
      txHash: a.txHash,
      settledAt: a.settledAt,
      amountAda: toAda(a.amountAda),
      prevAmountAda: toAda(a.prevAmountAda),
      newAmountAda: toAda(a.newAmountAda),
      prevFeeAda: a.prevFeeAda == null ? null : toAda(a.prevFeeAda),
      newFeeAda: a.newFeeAda == null ? null : toAda(a.newFeeAda),
      note: a.note,
      proposalId: a.proposalId,
      proposalPublicId: a.proposal?.publicId ?? null,
      proposalTitle: a.proposal?.title ?? null,
      submitter: a.proposal?.submitterUser?.displayName ?? a.proposal?.submitterDrep?.drepIdOnchain ?? null,
      // The submitter's payout address — where the board sends a REFUND (copyable in the UI).
      payoutAddress: a.proposal?.payoutAddress ?? null,
      createdAt: a.createdAt,
    }));
  }

  /** §12 — a board member records the on-chain tx that settles a top-up/refund → SETTLED. */
  async settlePayment(userId: string, adjustmentId: string, txHash: string) {
    const a = await this.prisma.feeAdjustment.findUnique({ where: { id: adjustmentId } });
    if (!a) throw new NotFoundException('payment not found');
    if (a.status !== 'PENDING') throw new ConflictException('payment is already settled');
    await this.prisma.feeAdjustment.update({
      where: { id: adjustmentId },
      data: { status: 'SETTLED', txHash: txHash.trim(), settledAt: new Date(), settledByUserId: userId },
    });
    return { status: 'SETTLED' as const };
  }

  /** §5.2 — assert an amount fits a category's min/max ask (shared by create + budget change). */
  private async assertAmountInCategory(categoryId: string | null, amountAda: number) {
    if (!categoryId) return;
    const category = await this.prisma.roundCategory.findUnique({ where: { id: categoryId } });
    if (!category) return;
    const min = category.minAda == null ? null : toAda(category.minAda);
    const max = category.maxAda == null ? null : toAda(category.maxAda);
    if (min != null && amountAda < min) {
      throw new BadRequestException(`requested ${amountAda.toLocaleString()} ₳ is below the "${category.name}" minimum ask of ${min.toLocaleString()} ₳`);
    }
    if (max != null && amountAda > max) {
      throw new BadRequestException(`requested ${amountAda.toLocaleString()} ₳ exceeds the "${category.name}" maximum ask of ${max.toLocaleString()} ₳`);
    }
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
      include: { category: { select: { name: true } }, submitterUser: { select: { displayName: true } }, submitterDrep: { select: { drepIdOnchain: true } } },
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
        // The submitter may have entered several tx hashes (corrected/replaced) — show & verify
        // each one so the board can find the one that actually paid. Fall back to the latest.
        const hashes = p.submissionFeeTxHashes.length ? p.submissionFeeTxHashes : p.submissionFeeTxHash ? [p.submissionFeeTxHash] : [];
        const txs = await Promise.all(
          hashes.map(async (h) => {
            const v = feeAddress ? await this.cardano.verifyPayment(h, feeAddress, p.submissionFeeAda ?? 0n) : { found: false, paid: false, paidLovelace: 0n };
            return { hash: h, found: v.found, paid: v.paid, paidAda: toAda(v.paidLovelace) };
          }),
        );
        const anyPaid = txs.find((t) => t.paid);
        const anyFound = txs.find((t) => t.found);
        return {
          id: p.id,
          title: p.title,
          roundNumber: p.round?.number ?? null,
          categoryName: p.category?.name ?? null,
          isCommercial: p.isCommercial,
          requestedAmountAda: toAda(p.requestedAmountAda),
          submissionFeeAda: toAda(p.submissionFeeAda),
          submissionFeeTxHash: p.submissionFeeTxHash,
          // Every tx the submitter entered, each with its own on-chain verification result.
          txs,
          submitter: p.submitterUser?.displayName ?? null,
          submittedAt: p.submittedAt,
          // Summary hint: paid if ANY entered tx covered the fee.
          feeVerified: anyPaid
            ? { found: true, paid: true, paidAda: anyPaid.paidAda }
            : anyFound
              ? { found: true, paid: false, paidAda: anyFound.paidAda }
              : { found: false, paid: false, paidAda: 0 },
        };
      }),
    );
  }

  async listMine(userId: string) {
    const proposals = await this.prisma.proposal.findMany({
      where: { submitterUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: { category: { select: { name: true } }, submitterUser: { select: { displayName: true } }, submitterDrep: { select: { drepIdOnchain: true } } },
    });
    return proposals.map((p) => this.summary(p));
  }

  async get(id: string, viewerUserId?: string) {
    const p = await this.prisma.proposal.findUnique({
      where: { id },
      include: {
        milestones: { orderBy: { idx: 'asc' } },
        category: { select: { name: true, minAda: true, maxAda: true, conditions: true } },
        submitterUser: { select: { displayName: true } },
        submitterDrep: { select: { drepIdOnchain: true } },
      },
    });
    if (!p) throw new NotFoundException('proposal not found');
    // DRAFT + PENDING (fee not yet confirmed) are visible only to their submitter.
    if (ProposalsService.PRIVATE_STATUSES.includes(p.status as ProposalStatus) && p.submitterUserId !== viewerUserId) {
      throw new NotFoundException('proposal not found');
    }
    return {
      ...this.summary(p),
      categoryId: p.categoryId,
      contentMd: p.contentMd,
      costBreakdownMd: p.costBreakdownMd,
      // §3.4 — stored as markdown strings in the Json columns.
      teamInfoMd: typeof p.teamInfo === 'string' ? p.teamInfo : null,
      revenueSharingMd: typeof p.revenueSharing === 'string' ? p.revenueSharing : null,
      submissionFeeAda: toAda(p.submissionFeeAda),
      submissionFeeTxHash: p.submissionFeeTxHash,
      submissionFeeTxHashes: p.submissionFeeTxHashes,
      feeReviewFeedback: p.feeReviewFeedback,
      payoutAddress: p.payoutAddress,
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
    publicId?: string | null;
    type: string;
    status: string;
    stage: string | null;
    title: string;
    categoryId: string | null;
    roundId: string | null;
    isCommercial: boolean | null;
    requestedAmountAda: bigint | null;
    submissionFeeTxHash?: string | null;
    createdAt: Date;
    category?: { name: string } | null;
    submitterUser?: { displayName: string | null } | null;
    submitterDrep?: { drepIdOnchain: string } | null;
  }) {
    return {
      id: p.id,
      publicId: p.publicId ?? null,
      type: p.type,
      status: p.status,
      stage: p.stage,
      title: p.title,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      roundId: p.roundId,
      isCommercial: p.isCommercial,
      requestedAmountAda: toAda(p.requestedAmountAda),
      submissionFeeTxHash: p.submissionFeeTxHash ?? null,
      // Who submitted it — display name, falling back to the DRep id (shown next to the title).
      submitter: p.submitterUser?.displayName ?? p.submitterDrep?.drepIdOnchain ?? null,
      createdAt: p.createdAt,
    };
  }

  /** Next structured public id for a round, e.g. "R6-P3" (per-round sequence; unique). */
  private async nextPublicId(roundId: string | null): Promise<string> {
    const round = roundId ? await this.prisma.round.findUnique({ where: { id: roundId }, select: { number: true } }) : null;
    const used = await this.prisma.proposal.count({ where: { roundId, publicId: { not: null } } });
    return `R${round?.number ?? 0}-P${used + 1}`;
  }

  /**
   * §3/§12 — when a proposal first becomes ACTIVE (fee confirmed or none required), write the
   * on-chain acceptance anchor: structured proposal id + submitter (DRep id, or stake address
   * if not a DRep) + the fee facts. Best-effort (degrades like every other anchor).
   */
  private async anchorActivation(proposalRowId: string, fee: { required: boolean; paid: boolean; ada: number; txHash?: string | null }): Promise<void> {
    if (!this.anchor) return;
    try {
      const p = await this.prisma.proposal.findUnique({
        where: { id: proposalRowId },
        include: {
          round: { select: { number: true } },
          submitterDrep: { select: { drepIdOnchain: true } },
          submitterUser: { select: { stakeAddress: true } },
        },
      });
      if (!p) return;
      const drepId = p.submitterDrep?.drepIdOnchain ?? null;
      await this.anchor.anchorSubmission({
        proposalRowId: p.id,
        publicId: p.publicId ?? p.id,
        roundId: p.roundId,
        roundNumber: p.round?.number ?? null,
        submitter: drepId ?? p.submitterUser?.stakeAddress ?? 'unknown',
        submitterType: drepId ? 'DRep' : 'Wallet',
        feeRequired: fee.required,
        feePaid: fee.paid,
        feeAda: fee.ada,
        feeTxHash: fee.txHash ?? null,
      });
    } catch {
      /* best-effort: never block activation on the anchor */
    }
  }

  /** A proposal that can be (re)submitted: a DRAFT, or one a fee review REJECTED (never public). */
  private async ownDraft(userId: string, id: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    const feeRejected = p.status === ProposalStatus.REJECTED && p.stage == null;
    if (p.status !== ProposalStatus.DRAFT && !feeRejected) {
      throw new ConflictException('only a draft or a fee-rejected proposal can be submitted');
    }
    return p;
  }

  /**
   * §7/§8 editing windows. Returns the proposal and whether this is a
   * post-submission edit (which must be versioned). Editable while:
   *  - DRAFT, or
   *  - PENDING (submitted, awaiting the board's fee confirmation — still private), or
   *  - FILTERING stage (status ACTIVE) — submitter revises during the feedback rounds, or
   *  - DEBATE_VOTE stage *before voting opens* (votingStartAt null) — the editing sub-phase.
   * No edits during the D&V voting phase or after a final decision.
   */
  private async ownEditable(userId: string, id: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    // Pre-public states → full editing (all fields, no version snapshot):
    //  DRAFT, PENDING (awaiting fee confirmation), and a fee-REJECTED proposal (REJECTED
    //  before it ever entered Filtering) which the submitter fixes and re-submits.
    const feeRejected = p.status === ProposalStatus.REJECTED && p.stage == null;
    if (p.status === ProposalStatus.DRAFT || p.status === ProposalStatus.PENDING || feeRejected) {
      return { proposal: p, postSubmission: false };
    }
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
