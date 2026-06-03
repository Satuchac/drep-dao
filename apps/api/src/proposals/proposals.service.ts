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
  VotePhase,
  VotingType,
} from '@drep-dao/shared';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AnchorService } from '../cardano/anchor.service';
import { BudgetChangeDto, CreateProposalDto, MilestoneInput, ReviewFeeDto, ReviewPledgeDto, SubmitProposalDto, UpdateProposalDto } from './dto';

const LOVELACE = 1_000_000;
const toLovelace = (ada: number): bigint => BigInt(Math.round(ada * LOVELACE));
const toAda = (l: bigint | null): number => (l == null ? 0 : Number(l) / LOVELACE);

/** Group an iterable into a Map<key, items[]> for cheap per-id lookup. */
function group<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = out.get(k);
    if (arr) arr.push(it);
    else out.set(k, [it]);
  }
  return out;
}

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
    this.assertPledge(round, dto.pledgeAmountAda, dto.pledgeReturnMethod);

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
        // §3 — optional pledge promise (paid on-chain later, after approval).
        pledgeAmountAda: dto.pledgeAmountAda ? toLovelace(dto.pledgeAmountAda) : null,
        pledgeReturnMethod: dto.pledgeAmountAda ? (dto.pledgeReturnMethod?.trim() || null) : null,
        // §3.4 — revenue-sharing gate (board verifies before funding unblocks).
        revenueSharingRequired: !!dto.revenueSharingRequired,
        // §3.4 funding fields (stored in the existing Json columns as markdown strings).
        ...(dto.teamInfoMd ? { teamInfo: dto.teamInfoMd } : {}),
        ...(dto.revenueSharingMd ? { revenueSharing: dto.revenueSharingMd } : {}),
        ...(dto.ecosystemImpactMd ? { ecosystemImpactMd: dto.ecosystemImpactMd } : {}),
        ...(dto.successMetricsMd ? { successMetricsMd: dto.successMetricsMd } : {}),
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
    // §7.4 — resubmit cycle (REJECTED at filtering) AND §8.1 — DEBATE phase
    // both let the team rework the budget shape: filtering has just finished
    // and no D&V ballots have been cast on the current shape yet, so changes
    // don't invalidate live votes. The fee that was paid stays put.
    const inResubmitCycle = p.status === ProposalStatus.REJECTED && p.stage === ProposalStage.FILTERING;
    const inDebate = (p as { round?: { status?: string } | null }).round?.status === RoundStatus.DEBATE && p.status === ProposalStatus.ACTIVE;
    const fullRevisionPhase = inResubmitCycle || inDebate;
    if (dto.milestones) {
      if (postSubmission && !fullRevisionPhase) {
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
    // Exception §7.4: during the resubmit cycle the proposal hasn't passed Filtering yet,
    // so the team is allowed to rework the budget shape with the rest of the proposal.
    const feeRejected = p.status === ProposalStatus.REJECTED && p.stage == null;
    const amountLocked = !(p.status === ProposalStatus.DRAFT || feeRejected || fullRevisionPhase);
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
    // §3 — pledge promise (amount + return method) editable until the team actually
    // pays on-chain in FUNDING. Once `pledgeConfirmedAt` is set the pledge is locked.
    let pledgeData: { pledgeAmountAda?: bigint | null; pledgeReturnMethod?: string | null } = {};
    if (dto.pledgeAmountAda !== undefined || dto.pledgeReturnMethod !== undefined) {
      if (p.pledgeConfirmedAt) {
        throw new ConflictException('the pledge has been confirmed on-chain and can no longer be changed');
      }
      const round = await this.prisma.round.findUnique({ where: { id: p.roundId! }, select: { pledgeThresholdAda: true } });
      const nextAmount = dto.pledgeAmountAda !== undefined ? dto.pledgeAmountAda : Number(p.pledgeAmountAda ?? 0n) / LOVELACE;
      const nextMethod = dto.pledgeReturnMethod !== undefined ? dto.pledgeReturnMethod : (p.pledgeReturnMethod ?? null);
      this.assertPledge(round ?? {}, nextAmount, nextMethod);
      pledgeData = {
        pledgeAmountAda: nextAmount > 0 ? toLovelace(nextAmount) : null,
        pledgeReturnMethod: nextAmount > 0 ? (nextMethod?.trim() || null) : null,
      };
    }
    // §3 — for post-submission edits, the proposal must remain valid (every
    // mandatory text field meets the round's word minimum). Compute the merged
    // final state from dto + current values and validate before the write.
    if (postSubmission) {
      const finalMilestones = dto.milestones
        ? dto.milestones.map((m, idx) => ({ idx, title: m.title ?? null, description: m.description, acceptanceCriteria: m.acceptanceCriteria ?? null }))
        : await this.prisma.milestone.findMany({
            where: { proposalId: id },
            orderBy: { idx: 'asc' },
            select: { idx: true, title: true, description: true, acceptanceCriteria: true },
          });
      await this.assertMandatoryWords(p.roundId, this.mandatoryProposalFields(
        {
          title: dto.title ?? p.title,
          contentMd: dto.contentMd ?? p.contentMd,
          ecosystemImpactMd: dto.ecosystemImpactMd ?? p.ecosystemImpactMd,
          successMetricsMd: dto.successMetricsMd ?? p.successMetricsMd,
          costBreakdownMd: dto.costBreakdownMd ?? p.costBreakdownMd,
          teamInfo: dto.teamInfoMd ?? (typeof p.teamInfo === 'string' ? p.teamInfo : null),
        },
        finalMilestones,
      ));
    }

    await this.prisma.$transaction(async (tx) => {
      if (postSubmission) {
        // Snapshot the version being replaced so reviewers can diff what changed.
        // Captures every editable field (not just pitch) so the diff view can show
        // changes across milestones / ecosystem impact / budget / etc.
        const snapshot = await this.buildProposalSnapshot(tx, id);
        await tx.proposalVersion.create({
          data: { proposalId: id, version: p.version, contentMd: p.contentMd, snapshot: (snapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue, editedBy: userId },
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
          ...pledgeData,
          ...(dto.teamInfoMd !== undefined ? { teamInfo: dto.teamInfoMd } : {}),
          ...(dto.revenueSharingMd !== undefined ? { revenueSharing: dto.revenueSharingMd } : {}),
          ...(dto.revenueSharingRequired !== undefined ? { revenueSharingRequired: !!dto.revenueSharingRequired } : {}),
          ...(dto.ecosystemImpactMd !== undefined ? { ecosystemImpactMd: dto.ecosystemImpactMd } : {}),
          ...(dto.successMetricsMd !== undefined ? { successMetricsMd: dto.successMetricsMd } : {}),
          ...(postSubmission ? { version: { increment: 1 } } : {}),
          updatedAt: new Date(),
        },
      });
      if (dto.milestones && (!postSubmission || fullRevisionPhase)) {
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

  /**
   * Full per-version snapshot of every editable proposal field — title, pitch,
   * descriptive markdown blocks, payout, expertise, amount + commercial flag,
   * milestone plan. Used by the diff view so a change to ANY field shows up,
   * not just the pitch text. Accepts a transaction client so it can be called
   * mid-transaction (snapshot the pre-update state, then mutate).
   */
  private async buildProposalSnapshot(tx: Prisma.TransactionClient | typeof this.prisma, proposalId: string) {
    const p = await tx.proposal.findUnique({
      where: { id: proposalId },
      include: { milestones: { orderBy: { idx: 'asc' } } },
    });
    if (!p) return null;
    return {
      title: p.title,
      contentMd: p.contentMd,
      ecosystemImpactMd: p.ecosystemImpactMd ?? null,
      successMetricsMd: p.successMetricsMd ?? null,
      costBreakdownMd: p.costBreakdownMd ?? null,
      teamInfoMd: typeof p.teamInfo === 'string' ? p.teamInfo : null,
      revenueSharingMd: typeof p.revenueSharing === 'string' ? p.revenueSharing : null,
      payoutAddress: p.payoutAddress ?? null,
      subcategoryIds: p.subcategoryIds ?? [],
      requestedAmountAda: toAda(p.requestedAmountAda),
      isCommercial: !!p.isCommercial,
      milestones: p.milestones.map((m) => ({
        idx: m.idx,
        title: m.title ?? null,
        description: m.description ?? '',
        acceptanceCriteria: m.acceptanceCriteria ?? null,
        amountAda: toAda(m.amountAda),
      })),
    };
  }

  /** Content version history (snapshots + the current head) for the diff view. */
  async versions(id: string) {
    const p = await this.prisma.proposal.findUnique({
      where: { id },
      select: { version: true, contentMd: true, updatedAt: true, status: true, submitterUserId: true },
    });
    if (!p || p.status === ProposalStatus.DRAFT) return [];
    const [snapshots, currentSnapshot] = await Promise.all([
      this.prisma.proposalVersion.findMany({
        where: { proposalId: id },
        orderBy: { version: 'asc' },
        include: { editor: { select: { displayName: true } } },
      }),
      this.buildProposalSnapshot(this.prisma, id),
    ]);
    const history = snapshots.map((s) => ({
      version: s.version,
      contentMd: s.contentMd,
      // Older rows pre-dating the snapshot column have it null — the diff view
      // falls back to contentMd-only for those.
      snapshot: (s.snapshot as Record<string, unknown> | null) ?? null,
      editedAt: s.editedAt,
      editor: s.editor?.displayName ?? null,
      current: false,
    }));
    history.push({ version: p.version, contentMd: p.contentMd, snapshot: currentSnapshot, editedAt: p.updatedAt, editor: null, current: true });
    return history;
  }

  /**
   * §3.3/§12 — submit. If the round's fee for this proposal type is **0%**, no payment is
   * needed and the proposal goes straight to ACTIVE (Filtering). Otherwise a fee tx hash is
   * required and the proposal moves to PENDING for the board to confirm the on-chain payment.
   */
  async submit(userId: string, id: string, dto: SubmitProposalDto) {
    const p = await this.ownDraft(userId, id);
    // §3 — payout / refund address is required to submit (the DAO needs an
    // address to send fee refunds + the funded budget to). Drafts can be
    // saved without it; submission can't.
    if (!p.payoutAddress?.trim()) {
      throw new BadRequestException('a payout / refund address is required to submit (the DAO needs somewhere to send refunds and the funded budget)');
    }
    // §3 — every mandatory text field (proposal + each milestone) must meet
    // the round's word-count minimum. Skipped in test mode (mandatoryWords=0).
    const milestonesAtSubmit = await this.prisma.milestone.findMany({
      where: { proposalId: id },
      orderBy: { idx: 'asc' },
      select: { idx: true, title: true, description: true, acceptanceCriteria: true },
    });
    await this.assertMandatoryWords(p.roundId, this.mandatoryProposalFields(p, milestonesAtSubmit));
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
   * §26.5 board fee review.
   *
   * **Initial review** of a PENDING proposal: APPROVE → ACTIVE in Filtering;
   * REJECT → REJECTED (feedback required).
   *
   * **Re-review** of an already-decided proposal: allowed ONLY while the round
   * is still in its SUBMISSION stage (a board member can correct a mistake —
   * approved by accident, or rejected too harshly). Once the round moves on to
   * FILTERING, fee decisions are frozen (the round is past the point where
   * undoing matters). State transitions:
   *   APPROVED (ACTIVE+FILTERING) + APPROVE → no-op, update note
   *   APPROVED (ACTIVE+FILTERING) + REJECT  → REJECTED + stage=null
   *   REJECTED (no stage)          + APPROVE → ACTIVE+FILTERING (un-reject)
   *   REJECTED (no stage)          + REJECT  → no-op, update note
   * Each APPROVE writes a fresh acceptance anchor with the current tx hash so
   * the latest on-chain proof reflects the latest decision. The board's note
   * is shown to the submitter in the FEEDBACK box.
   */
  async reviewFee(id: string, dto: ReviewFeeDto) {
    const p = await this.prisma.proposal.findUnique({
      where: { id },
      include: { round: { select: { status: true } } },
    });
    if (!p) throw new NotFoundException('proposal not found');

    // §3 — re-review is allowed only while the round is still in its SUBMISSION
    // stage. Once SUBMISSION→FILTERING happens, fee decisions are frozen — undoing
    // an approval after the proposal entered FILTERING would unwind votes.
    const feeStageRejected = p.status === ProposalStatus.REJECTED && p.stage == null;
    const wasDecided = p.status !== ProposalStatus.PENDING;
    if (wasDecided) {
      const isApproved = p.status === ProposalStatus.ACTIVE && p.stage === ProposalStage.FILTERING;
      if (!isApproved && !feeStageRejected) {
        throw new ConflictException('this proposal is not in a fee-review state any more');
      }
      if (p.round && p.round.status !== RoundStatus.SUBMISSION) {
        throw new ConflictException(
          `fee decisions are locked once the round leaves SUBMISSION (current: ${p.round.status})`,
        );
      }
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
      // A re-decision writes a fresh anchor; anchors are append-only on-chain
      // so the latest one is the canonical state.
      await this.anchorActivation(id, { required: true, paid: true, ada: toAda(p.submissionFeeAda), txHash: p.submissionFeeTxHash });
    } else {
      // Reject (or re-reject after undo): clear the stage; status=REJECTED with
      // stage=null is the fee-stage rejection signature.
      await this.prisma.proposal.update({
        where: { id },
        data: { status: ProposalStatus.REJECTED, stage: null, feeReviewFeedback: feedback },
      });
    }
    return this.get(id);
  }

  /**
   * §12 — let the submitter verify on-chain how much of the submission fee has been
   * paid so far across all the tx hashes saved on the proposal. Useful before
   * actually submitting: "send 1 ADA as a test → click Verify → see 1 paid / 499
   * missing → send the rest → click Verify again → fully paid → submit." Sums the
   * amount each saved tx sent to the configured fee address; cumulative so a team
   * can split the payment across several txs.
   */
  /**
   * §3 — submitter-driven on-chain check for the pledge payment. Mirrors
   * verifyFeeOnChain: looks up the pasted tx via Koios against the configured
   * pledge address and reports whether the promised pledge amount has landed.
   * Auto-called by the UI after the team pastes the hash and on a slow poll
   * until the board confirms.
   */
  async verifyPledgeOnChain(id: string, userId: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    const pledgeAddress = this.config.get<string>('PLEDGE_ADDRESS')
      ?? this.config.get<string>('SUBMISSION_FEE_ADDRESS')
      ?? this.config.get<string>('TREASURY_ADDRESS')
      ?? '';
    const requiredAda = toAda(p.pledgeAmountAda);
    const hash = p.pledgeTxHash;
    if (!pledgeAddress || !hash || requiredAda <= 0) {
      return {
        requiredAda,
        paidAda: 0,
        missingAda: requiredAda,
        fullyPaid: requiredAda === 0 && !hash,
        koiosAvailable: true,
        tx: null as { hash: string; found: boolean; paidAda: number; koiosAvailable: boolean } | null,
      };
    }
    // Pass 0n so we get the actual paid amount without applying a threshold.
    const v = await this.cardano.verifyPayment(hash, pledgeAddress, 0n);
    const paidAda = toAda(v.paidLovelace);
    const missing = Math.max(0, requiredAda - paidAda);
    return {
      requiredAda,
      paidAda,
      missingAda: missing,
      fullyPaid: paidAda >= requiredAda,
      koiosAvailable: v.koiosAvailable,
      tx: { hash, found: v.found, paidAda, koiosAvailable: v.koiosAvailable },
    };
  }

  async verifyFeeOnChain(id: string, userId: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    const feeAddress = this.config.get<string>('SUBMISSION_FEE_ADDRESS')
      ?? this.config.get<string>('TREASURY_ADDRESS') ?? '';
    // The stored fee only exists once the team has submitted. While the proposal
    // is still a DRAFT we compute the EXPECTED fee from the form's current state
    // (requested amount + commercial flag + round settings) so the on-chain
    // verify is meaningful before submission. Without this, requiredAda would
    // be 0 and "0 ≥ 0" would falsely report `fullyPaid` for any pasted hash.
    const requiredAda = p.submissionFeeAda
      ? toAda(p.submissionFeeAda)
      : await this.computeFee(toAda(p.requestedAmountAda), p.isCommercial ?? false, p.roundId);
    const hashes = p.submissionFeeTxHashes.length
      ? p.submissionFeeTxHashes
      : (p.submissionFeeTxHash ? [p.submissionFeeTxHash] : []);
    if (!feeAddress || hashes.length === 0 || requiredAda <= 0) {
      return {
        requiredAda,
        paidAda: 0,
        missingAda: requiredAda,
        // Only "fully paid by default" when the round genuinely has no fee for
        // this proposal (requiredAda actually 0) AND no hashes were entered.
        fullyPaid: requiredAda === 0 && hashes.length === 0,
        koiosAvailable: true,
        txs: [] as { hash: string; found: boolean; paidAda: number; koiosAvailable: boolean }[],
      };
    }
    const txs = await Promise.all(
      hashes.map(async (h) => {
        // Pass 0n so verifyPayment returns the actual paid amount without applying a
        // pass/fail threshold — we sum across txs ourselves.
        const v = await this.cardano.verifyPayment(h, feeAddress, 0n);
        return { hash: h, found: v.found, paidAda: toAda(v.paidLovelace), koiosAvailable: v.koiosAvailable };
      }),
    );
    const paidAda = txs.reduce((s, t) => s + t.paidAda, 0);
    // If every tx couldn't be checked on-chain right now, surface that to the UI
    // — "tx not found" vs "Koios is down/throttling" are very different fixes.
    const koiosAvailable = txs.some((t) => t.koiosAvailable);
    return {
      requiredAda,
      paidAda,
      missingAda: Math.max(0, requiredAda - paidAda),
      fullyPaid: paidAda >= requiredAda,
      koiosAvailable,
      txs,
    };
  }

  // ===========================================================================
  // §3 Pledge — paid on-chain AFTER approval, board confirms (mirrors fee flow)
  // ===========================================================================

  /**
   * Submitter pastes the on-chain pledge payment tx hash. Allowed once the proposal
   * is APPROVED (in FUNDING) and a pledge was promised; locked once the board has
   * confirmed it. Can be re-pasted (board rejected with feedback → fix + repaste).
   */
  async submitPledgeTxHash(userId: string, id: string, txHash: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    if (!p.pledgeAmountAda || p.pledgeAmountAda === 0n) {
      throw new ConflictException('no pledge was promised on this proposal');
    }
    if (p.status !== ProposalStatus.APPROVED || p.stage !== ProposalStage.FUNDING) {
      throw new ConflictException('the pledge is paid after the proposal is APPROVED and reaches FUNDING');
    }
    if (p.pledgeConfirmedAt) {
      throw new ConflictException('pledge is already confirmed on-chain');
    }
    await this.prisma.proposal.update({
      where: { id },
      data: { pledgeTxHash: txHash.trim() || null, pledgeFeedback: null },
    });
    return this.get(id, userId);
  }

  /**
   * Board confirms (or rejects) the on-chain pledge payment. APPROVE records
   * pledgeConfirmedAt (now locks the pledge fields). REJECT clears the tx hash so
   * the team can paste a corrected one, and the (required) feedback is shown.
   */
  async reviewPledge(id: string, dto: ReviewPledgeDto) {
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (!p.pledgeAmountAda || p.pledgeAmountAda === 0n) {
      throw new ConflictException('no pledge was promised on this proposal');
    }
    if (!p.pledgeTxHash) {
      throw new ConflictException('no pledge tx hash to review — the team has not paid yet');
    }
    if (p.pledgeConfirmedAt) {
      throw new ConflictException('pledge is already confirmed');
    }
    const feedback = dto.feedback?.trim() || null;
    if (dto.decision === 'REJECT' && !feedback) {
      throw new BadRequestException('a reason is required when rejecting a pledge payment');
    }
    if (dto.decision === 'APPROVE') {
      await this.prisma.proposal.update({
        where: { id },
        data: { pledgeConfirmedAt: new Date(), pledgeFeedback: feedback },
      });
    } else {
      await this.prisma.proposal.update({
        where: { id },
        data: { pledgeTxHash: null, pledgeFeedback: feedback },
      });
    }
    return this.get(id);
  }

  /**
   * §3/§15 — proposals awaiting board pledge confirmation. Each row carries the
   * pasted tx hash + an ON-CHAIN verification (paid?, paid ADA, found?) against
   * the configured pledge address so the board can confirm at a glance.
   */
  async listPendingPledge() {
    const rows = await this.prisma.proposal.findMany({
      where: {
        status: ProposalStatus.APPROVED,
        stage: ProposalStage.FUNDING,
        pledgeAmountAda: { gt: 0n },
        pledgeTxHash: { not: null },
        pledgeConfirmedAt: null,
      },
      orderBy: { updatedAt: 'asc' },
      include: {
        submitterUser: { select: { displayName: true } },
        category: { select: { name: true } },
        round: { select: { number: true } },
      },
    });
    const pledgeAddress = this.config.get<string>('PLEDGE_ADDRESS')
      ?? this.config.get<string>('SUBMISSION_FEE_ADDRESS')
      ?? this.config.get<string>('TREASURY_ADDRESS')
      ?? '';
    return Promise.all(
      rows.map(async (p) => {
        const verification = pledgeAddress && p.pledgeTxHash
          ? await this.cardano.verifyPayment(p.pledgeTxHash, pledgeAddress, p.pledgeAmountAda ?? 0n)
          : { found: false, paid: false, paidLovelace: 0n };
        return {
          id: p.id,
          publicId: p.publicId,
          title: p.title,
          roundNumber: p.round?.number ?? null,
          categoryName: p.category?.name ?? null,
          submitter: p.submitterUser?.displayName ?? null,
          pledgeAmountAda: toAda(p.pledgeAmountAda),
          pledgeReturnMethod: p.pledgeReturnMethod ?? null,
          pledgeTxHash: p.pledgeTxHash,
          pledgeAddress,
          verification: {
            found: verification.found,
            paid: verification.paid,
            paidAda: toAda(verification.paidLovelace),
          },
        };
      }),
    );
  }

  /**
   * §3.4 — board verifies the team's revenue-sharing action (e.g. token contribution
   * to the Treasury). Unblocks milestone POAs. Idempotent: re-verifying is a no-op.
   */
  async verifyRevenueSharing(boardUserId: string, id: string) {
    void boardUserId;
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('proposal not found');
    if (!p.revenueSharingRequired) {
      throw new ConflictException('this proposal does not require revenue-sharing verification');
    }
    if (p.revenueSharingVerifiedAt) {
      return this.get(id);
    }
    await this.prisma.proposal.update({
      where: { id },
      data: { revenueSharingVerifiedAt: new Date() },
    });
    return this.get(id);
  }

  /** §3.4 — board's to-do list: approved proposals waiting on the revenue-sharing
   *  verification before milestone work can start. */
  async listPendingRevenueSharing() {
    const rows = await this.prisma.proposal.findMany({
      where: {
        status: ProposalStatus.APPROVED,
        stage: ProposalStage.FUNDING,
        revenueSharingRequired: true,
        revenueSharingVerifiedAt: null,
      },
      orderBy: { updatedAt: 'asc' },
      include: {
        submitterUser: { select: { displayName: true } },
        category: { select: { name: true } },
        round: { select: { number: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      publicId: p.publicId,
      title: p.title,
      roundNumber: p.round?.number ?? null,
      categoryName: p.category?.name ?? null,
      submitter: p.submitterUser?.displayName ?? null,
      revenueSharingMd: typeof p.revenueSharing === 'string' ? p.revenueSharing : null,
      // The submission-fee address is the canonical "send things to the platform"
      // address — surfaced here so the board can sanity-check on-chain receipts.
      hintAddress: this.config.get<string>('SUBMISSION_FEE_ADDRESS') ?? '',
    }));
  }

  /**
   * §12 — the submitter changes an ACTIVE proposal's budget. The amount + milestones update
   * immediately, and the **fee delta** becomes a settlement task for the board: increasing the
   * budget owes MORE fee (TOPUP), decreasing returns fee (REFUND). The board records the tx
   * (My Area → Payments). Locked elsewhere (see updateDraft) so this is the only way to move it.
   */
  /**
   * §12 — submitter requests a budget change. Creates a PENDING BudgetChangeRequest
   * for a board member to approve or reject. The proposal itself is NOT mutated and
   * the filtering votes are NOT cleared until the board approves — so a proposal
   * that's currently passing stays passing if the board rejects the change.
   */
  async requestBudgetChange(userId: string, id: string, dto: BudgetChangeDto) {
    const p = await this.prisma.proposal.findUnique({
      where: { id },
      include: { round: { select: { status: true, filterBudgetChangesAllowed: true } } },
    });
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

    const inFiltering = p.round?.status === RoundStatus.FILTERING;
    const budgetCap = p.round?.filterBudgetChangesAllowed ?? ROUND_SETTING_DEFAULTS.filterBudgetChangesAllowed;
    if (inFiltering && p.budgetChangesUsed >= budgetCap) {
      throw new ConflictException(`no in-filter budget changes left (used ${p.budgetChangesUsed} of ${budgetCap})`);
    }

    const existingPending = await this.prisma.budgetChangeRequest.findFirst({
      where: { proposalId: id, status: 'PENDING' },
    });
    if (existingPending) {
      throw new ConflictException('there is already a pending budget-change request on this proposal — wait for the board to decide');
    }

    const req = await this.prisma.budgetChangeRequest.create({
      data: {
        proposalId: id,
        requesterId: userId,
        prevAmountAda: toLovelace(oldAmount),
        proposedAmountAda: toLovelace(newAmount),
        proposedMilestones: dto.milestones.map((m) => ({
          title: m.title ?? null,
          description: m.description,
          acceptanceCriteria: m.acceptanceCriteria ?? null,
          amountAda: m.amountAda,
        })) as Prisma.InputJsonValue,
        reason: dto.reason?.trim() || null,
        status: 'PENDING',
      },
    });
    return { id: req.id, status: req.status };
  }

  /**
   * §12 — board approves a pending budget change. Mutates the proposal (amount +
   * milestones + new fee), records the version snapshot, and — if the round is in
   * FILTERING — clears the filtering votes + resets the proposal to ACTIVE+FILTERING
   * so the jury votes again on the revised budget. Queues a FeeAdjustment if the
   * fee changed. The request flips to APPROVED.
   */
  async approveBudgetChange(boardUserId: string, requestId: string, feedback?: string) {
    const req = await this.prisma.budgetChangeRequest.findUnique({
      where: { id: requestId },
      include: { proposal: { include: { round: { select: { status: true, filterBudgetChangesAllowed: true } } } } },
    });
    if (!req) throw new NotFoundException('budget-change request not found');
    if (req.status !== 'PENDING') throw new ConflictException(`request already ${req.status.toLowerCase()}`);
    const p = req.proposal;
    if (p.status !== ProposalStatus.ACTIVE) {
      throw new ConflictException('proposal is no longer ACTIVE — cannot apply budget change');
    }
    const inFiltering = p.round?.status === RoundStatus.FILTERING;
    const budgetCap = p.round?.filterBudgetChangesAllowed ?? ROUND_SETTING_DEFAULTS.filterBudgetChangesAllowed;
    if (inFiltering && p.budgetChangesUsed >= budgetCap) {
      throw new ConflictException(`no in-filter budget changes left (used ${p.budgetChangesUsed} of ${budgetCap})`);
    }

    const newAmount = toAda(req.proposedAmountAda);
    const oldAmount = toAda(req.prevAmountAda);
    const proposedMilestones = req.proposedMilestones as Array<{ title: string | null; description: string; acceptanceCriteria: string | null; amountAda: number }>;
    const oldFee = toAda(p.submissionFeeAda);
    const newFee = await this.computeFee(newAmount, p.isCommercial ?? false, p.roundId);
    const delta = Math.round((newFee - oldFee) * 1e6) / 1e6;

    await this.prisma.$transaction(async (tx) => {
      const snapshot = await this.buildProposalSnapshot(tx, p.id);
      await tx.proposalVersion.create({
        data: {
          proposalId: p.id,
          version: p.version,
          contentMd: p.contentMd,
          snapshot: (snapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          editedBy: boardUserId,
        },
      });
      await tx.proposal.update({
        where: { id: p.id },
        data: {
          requestedAmountAda: toLovelace(newAmount),
          submissionFeeAda: toLovelace(newFee),
          version: { increment: 1 },
          ...(inFiltering
            ? {
                status: ProposalStatus.ACTIVE,
                stage: ProposalStage.FILTERING,
                budgetChangesUsed: { increment: 1 },
              }
            : {}),
        },
      });
      if (inFiltering) {
        await tx.vote.deleteMany({ where: { proposalId: p.id, phase: VotePhase.FILTERING } });
      }
      await tx.milestone.deleteMany({ where: { proposalId: p.id } });
      await tx.milestone.createMany({
        data: proposedMilestones.map((m, idx) => ({
          proposalId: p.id,
          idx,
          title: m.title ?? null,
          description: m.description,
          acceptanceCriteria: m.acceptanceCriteria ?? null,
          amountAda: toLovelace(m.amountAda),
          status: 'NOT_STARTED',
        })),
      });
      if (delta !== 0) {
        await tx.feeAdjustment.create({
          data: {
            proposalId: p.id,
            kind: delta > 0 ? 'TOPUP' : 'REFUND',
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
      await tx.budgetChangeRequest.update({
        where: { id: req.id },
        data: { status: 'APPROVED', decidedByUserId: boardUserId, decidedFeedback: feedback?.trim() || null, decidedAt: new Date() },
      });
    });
    return this.get(p.id, boardUserId);
  }

  /**
   * §12 — board rejects a pending budget change. The proposal and its filtering
   * votes are left exactly as they were — if the proposal was already passing
   * filtering, it stays passing. Feedback is required (so the team knows why).
   */
  async rejectBudgetChange(boardUserId: string, requestId: string, feedback: string) {
    if (!feedback?.trim()) throw new BadRequestException('feedback is required when rejecting a budget change');
    const req = await this.prisma.budgetChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('budget-change request not found');
    if (req.status !== 'PENDING') throw new ConflictException(`request already ${req.status.toLowerCase()}`);
    await this.prisma.budgetChangeRequest.update({
      where: { id: req.id },
      data: { status: 'REJECTED', decidedByUserId: boardUserId, decidedFeedback: feedback.trim(), decidedAt: new Date() },
    });
    return this.get(req.proposalId, boardUserId);
  }

  /** Pending budget-change requests across all proposals — the board's to-do list. */
  async listPendingBudgetChanges() {
    const rows = await this.prisma.budgetChangeRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: {
        proposal: { select: { id: true, publicId: true, title: true, requestedAmountAda: true, isCommercial: true } },
        requester: { select: { displayName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      proposalId: r.proposalId,
      proposalTitle: r.proposal.title,
      proposalPublicId: r.proposal.publicId,
      requester: r.requester.displayName ?? null,
      prevAmountAda: toAda(r.prevAmountAda),
      proposedAmountAda: toAda(r.proposedAmountAda),
      proposedMilestones: r.proposedMilestones,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
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

  // §16 — DRAFTs are private (submitter is still drafting, never submitted).
  // PENDING (submitted, fee not yet confirmed) and everything past it are PUBLIC
  // in the round listing — the title + status + sub-status (e.g. "awaiting
  // board fee confirmation") are visible so the round overview matches the
  // count chip ("1 pending"). The detail page still gates PENDING content to
  // the owner via PRIVATE_DETAIL_STATUSES below.
  private static readonly LIST_HIDDEN_STATUSES: ProposalStatus[] = [ProposalStatus.DRAFT];
  private static readonly PRIVATE_DETAIL_STATUSES: ProposalStatus[] = [ProposalStatus.DRAFT, ProposalStatus.PENDING];
  /** @deprecated kept for backwards-compatibility in the detail-access check. */
  private static readonly PRIVATE_STATUSES = ProposalsService.PRIVATE_DETAIL_STATUSES;

  async listByRound(roundId: string, status?: string) {
    const statusFilter =
      status && !ProposalsService.LIST_HIDDEN_STATUSES.includes(status as ProposalStatus)
        ? status
        : { notIn: ProposalsService.LIST_HIDDEN_STATUSES };
    const proposals = await this.prisma.proposal.findMany({
      where: { roundId, status: statusFilter },
      orderBy: { createdAt: 'asc' },
      include: {
        category: { select: { name: true } },
        submitterUser: { select: { displayName: true } },
        submitterDrep: { select: { drepIdOnchain: true } },
        round: { select: { status: true, filterReviewerCount: true, filterApprovalVotes: true, milestoneApprovalVotes: true } },
      },
    });
    return this.enrichSummaries(proposals);
  }

  /**
   * §26.2 — enrich each list row with stage-specific context so a viewer of the
   * round's proposals can see at a glance "what's needed now": for ACTIVE rows in
   * FILTERING — assigned/voted/threshold (or "awaiting reviewer draw"); for ACTIVE
   * in DEBATE_VOTE — eligible/cast snapshot count; for APPROVED in FUNDING — the
   * milestone progress + any open stop-funding. For REJECTED rows — the NO
   * rationales (filtering / D&V) and the fee-rejection feedback (if any), so the
   * reader sees WHY without having to open the proposal.
   *
   * Batches the per-stage queries so the list is one round-trip per data type, not
   * one per proposal.
   */
  private async enrichSummaries(
    proposals: Array<Parameters<ProposalsService['summary']>[0] & {
      feeReviewFeedback?: string | null;
      round?: { status?: string; filterReviewerCount: number | null; filterApprovalVotes: number | null; milestoneApprovalVotes: number | null } | null;
    }>,
  ) {
    if (proposals.length === 0) return [];
    const ids = proposals.map((p) => p.id);

    // Batch queries.
    const filterAssign = await this.prisma.filterAssignment.findMany({
      where: { proposalId: { in: ids }, releasedAt: null },
      select: { proposalId: true, drepId: true },
    });
    const filterVotes = await this.prisma.vote.findMany({
      where: { proposalId: { in: ids }, phase: 'FILTERING' },
      include: { drep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } },
      orderBy: { castAt: 'asc' },
    });
    const dvSnapshots = await this.prisma.voteSnapshot.findMany({
      where: { proposalId: { in: ids } },
      orderBy: { takenAt: 'desc' },
      // finalPower is needed for the live YES/NO threshold indicator (next to
      // the "X/N voted" chip) that tells the board at a glance whether each
      // D&V proposal would currently pass.
      include: { entries: { select: { drepId: true, finalPower: true } } },
    });
    const dvVotes = await this.prisma.vote.findMany({
      where: { proposalId: { in: ids }, phase: 'DEBATE_VOTE' },
      include: { drep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } },
    });
    // §8.2 — board members who toggled off votesOnFundingProposals are skipped
    // at tally time. Pull every drep referenced by any current snapshot entry
    // so the round-overview YES/NO chip matches what DvService.result reports.
    const snapDrepIds = Array.from(new Set(dvSnapshots.flatMap((s) => s.entries.map((e) => e.drepId))));
    const snapDreps = snapDrepIds.length
      ? await this.prisma.drep.findMany({
          where: { id: { in: snapDrepIds } },
          select: { id: true, votesOnFundingProposals: true, user: { select: { drepKeyHash: true } } },
        })
      : [];
    const boardKeys = new Set(
      (await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    const skipDrepIds = new Set(
      snapDreps
        .filter((d) => !d.votesOnFundingProposals && d.user?.drepKeyHash && boardKeys.has(d.user.drepKeyHash))
        .map((d) => d.id),
    );
    const ms = await this.prisma.milestone.findMany({
      where: { proposalId: { in: ids } },
      select: { id: true, idx: true, proposalId: true, status: true },
    });
    const msVotes = await this.prisma.vote.findMany({
      where: { milestoneId: { in: ms.map((m) => m.id) }, phase: 'MILESTONE' },
      select: { milestoneId: true, choice: true },
    });
    const activeStops = await this.prisma.stopFundingProposal.findMany({
      where: { proposalId: { in: ids }, status: 'ACTIVE' },
      include: { votes: { select: { choice: true } } },
    });
    // §12 — pending budget-change requests outrank the normal progress chip:
    // a proposal blocked on board approval should read that way, not "0/4 voted".
    const pendingBudgets = await this.prisma.budgetChangeRequest.findMany({
      where: { proposalId: { in: ids }, status: 'PENDING' },
      select: { proposalId: true },
    });

    // Index per proposal.
    const fAssignBy = group(filterAssign, (a) => a.proposalId);
    const fVotesBy = group(filterVotes, (v) => v.proposalId);
    const dvSnapBy = new Map<string, (typeof dvSnapshots)[number]>();
    for (const s of dvSnapshots) if (!dvSnapBy.has(s.proposalId)) dvSnapBy.set(s.proposalId, s);
    const dvVotesBy = group(dvVotes, (v) => v.proposalId);
    const msByProposal = group(ms, (m) => m.proposalId);
    const msVotesById = group(msVotes, (v) => v.milestoneId ?? '');
    const stopBy = new Map(activeStops.map((s) => [s.proposalId, s]));
    const pendingBudgetSet = new Set(pendingBudgets.map((b) => b.proposalId));

    return proposals.map((p) => {
      const base = this.summary(p);
      const status = p.status as ProposalStatus;
      const stage = p.stage as ProposalStage | null;
      const filterThreshold = p.round?.filterApprovalVotes ?? ROUND_SETTING_DEFAULTS.filterApprovalVotes;
      const filterWantCount = p.round?.filterReviewerCount ?? ROUND_SETTING_DEFAULTS.filterReviewerCount;
      const milestoneThreshold = p.round?.milestoneApprovalVotes ?? ROUND_SETTING_DEFAULTS.milestoneApprovalVotes;

      // Build the "what's needed now" hint for ACTIVE proposals.
      type Tone = 'amber' | 'emerald' | 'neutral' | 'red';
      let progress: { stage: string; label: string; tone: Tone; extra?: { label: string; tone: Tone } } | null = null;
      if (status === ProposalStatus.PENDING) {
        // §3/§12 — distinguish "fee tx not entered yet" from "fee tx entered, board hasn't
        // reviewed". Both block the proposal from advancing past SUBMISSION; the second is
        // a board responsibility, the first is the submitter's.
        const txHash = (p as { submissionFeeTxHash?: string | null }).submissionFeeTxHash;
        if (!txHash) {
          progress = { stage: 'FEE', label: 'submission fee not paid yet (submitter)', tone: 'red' };
        } else {
          progress = { stage: 'FEE', label: 'submission fee paid, awaiting board confirmation', tone: 'amber' };
        }
      } else if (status === ProposalStatus.ACTIVE && stage === ProposalStage.FILTERING) {
        const assigned = fAssignBy.get(p.id) ?? [];
        const votes = fVotesBy.get(p.id) ?? [];
        const roundStatus = p.round?.status ?? null;
        // §3 — while the round is still in SUBMISSION the proposal is "ready" but
        // voting is closed. After SUBMISSION ends (round → FILTERING) the jury votes.
        if (roundStatus && roundStatus !== 'FILTERING') {
          progress = assigned.length === 0
            ? { stage: 'FILTERING', label: 'fee confirmed · awaiting board to assign reviewers', tone: 'amber' }
            : { stage: 'FILTERING', label: `fee confirmed · ${assigned.length} reviewers pre-assigned · voting opens when round moves to FILTERING`, tone: 'emerald' };
        } else if (assigned.length === 0) {
          progress = { stage: 'FILTERING', label: 'awaiting reviewer draw (board)', tone: 'amber' };
        } else {
          const yes = votes.filter((v) => v.choice === 'YES').length;
          const no = votes.filter((v) => v.choice === 'NO').length;
          // §7.2 — rejection only when YES is mathematically out of reach
          // (every remaining unvoted reviewer would have to vote YES).
          const maxPossibleYes = Math.max(0, assigned.length - no);
          const passed = yes >= filterThreshold;
          const failed = maxPossibleYes < filterThreshold;
          // Board scan: show YES / NO counts inline + an outcome tag so they can
          // tell at a glance which proposals are ready to advance vs. still need votes.
          progress = passed
            ? { stage: 'FILTERING', label: `✓ ${yes} YES · approved (advancing)`, tone: 'emerald' }
            : failed
              ? { stage: 'FILTERING', label: `✗ ${no} NO · rejected (YES no longer possible)`, tone: 'red' }
              : { stage: 'FILTERING', label: `${yes} YES · ${no} NO · need ${filterThreshold} to decide`, tone: 'amber' };
        }
      } else if (status === ProposalStatus.ACTIVE && stage === ProposalStage.DEBATE_VOTE) {
        const snap = dvSnapBy.get(p.id);
        const roundStatus = p.round?.status ?? null;
        // §8 — DEBATE is the discussion window (no ballots yet); VOTE is the
        // ballot window. DV is the deprecated alias treated as VOTE. Anything
        // earlier means the proposal just passed filtering and is waiting on
        // the board to advance the round.
        if (roundStatus === 'DEBATE') {
          progress = { stage: 'DEBATE', label: '✓ passed filtering · in Debate (DReps comment; voting opens in Vote)', tone: 'emerald' };
        } else if (roundStatus !== 'VOTE' && roundStatus !== 'DV') {
          progress = { stage: 'DV', label: '✓ passed filtering · Debate opens when round advances', tone: 'emerald' };
        } else if (!snap) {
          progress = { stage: 'VOTE', label: 'awaiting board to open Vote', tone: 'amber' };
        } else {
          // §8.2 — skip opted-out board members at tally time so the chip
          // matches what DvService.result reports.
          const eligibleEntries = snap.entries.filter((e) => !skipDrepIds.has(e.drepId));
          const eligible = eligibleEntries.length;
          const votes = dvVotesBy.get(p.id) ?? [];
          const voteByDrep = new Map(votes.map((v) => [v.drepId, v.choice]));
          const cast = eligibleEntries.filter((e) => voteByDrep.has(e.drepId)).length;
          // Live threshold check: would the proposal pass right now? Missing
          // voters count as implicit NO; abstain reduces the denominator.
          let yesPower = 0, abstainPower = 0, totalPower = 0;
          for (const e of eligibleEntries) {
            const fp = Number(e.finalPower ?? 0);
            totalPower += fp;
            const c = voteByDrep.get(e.drepId);
            if (c === 'YES') yesPower += fp;
            else if (c === 'ABSTAIN') abstainPower += fp;
          }
          const approvalThresholdPct = (p as { approvalThresholdPct?: unknown }).approvalThresholdPct;
          const thresholdPct = approvalThresholdPct != null
            ? Number(approvalThresholdPct)
            : ROUND_SETTING_DEFAULTS.dvApprovalThresholdPct;
          const denom = Math.max(0, totalPower - abstainPower);
          const ratioPct = denom > 0 ? (yesPower / denom) * 100 : 0;
          const passingNow = denom > 0 && ratioPct >= thresholdPct;
          progress = {
            stage: 'VOTE',
            label: `${cast}/${eligible} DReps voted`,
            tone: cast >= eligible ? 'emerald' : 'amber',
            extra: passingNow
              ? { label: `✓ YES · ${ratioPct.toFixed(0)}% / ${thresholdPct}%`, tone: 'emerald' }
              : { label: `✗ NO · ${ratioPct.toFixed(0)}% / ${thresholdPct}%`, tone: 'red' },
          };
        }
      } else if (status === ProposalStatus.APPROVED && stage === ProposalStage.FUNDING) {
        const active = stopBy.get(p.id);
        // §3 — pledge gate: if a pledge was promised but not confirmed on-chain by
        // the board, milestone work is blocked. Surface this clearly in the list.
        const pledgeRow = p as { pledgeAmountAda?: bigint | null; pledgeTxHash?: string | null; pledgeConfirmedAt?: Date | null };
        const pledgePromised = !!(pledgeRow.pledgeAmountAda && pledgeRow.pledgeAmountAda > 0n);
        const pledgeNotPaid = pledgePromised && !pledgeRow.pledgeTxHash;
        const pledgePending = pledgePromised && !!pledgeRow.pledgeTxHash && !pledgeRow.pledgeConfirmedAt;
        if (active) {
          const yes = active.votes.filter((v) => v.choice === 'YES').length;
          progress = { stage: 'FUNDING', label: `stop-funding open · ${yes}/3 YES`, tone: 'red' };
        } else if (pledgeNotPaid) {
          progress = { stage: 'FUNDING', label: 'pledge not paid yet (team)', tone: 'red' };
        } else if (pledgePending) {
          progress = { stage: 'FUNDING', label: 'pledge paid, awaiting board confirmation', tone: 'amber' };
        } else {
          const milestones = msByProposal.get(p.id) ?? [];
          if (milestones.length === 0) {
            progress = { stage: 'FUNDING', label: 'no milestones defined', tone: 'neutral' };
          } else {
            const approved = milestones.filter((m) => m.status === 'APPROVED').length;
            const inReview = milestones.find((m) => m.status === 'POA_SUBMITTED');
            // §11.2 — REJECTED needs submitter action: the team must post a
            // revised POA. Surface this red so it stands out in My-proposals.
            const rejected = milestones.find((m) => m.status === 'REJECTED');
            if (inReview) {
              const v = msVotesById.get(inReview.id) ?? [];
              const yes = v.filter((x) => x.choice === 'YES').length;
              progress = { stage: 'FUNDING', label: `M#${inReview.idx + 1} POA under review · ${yes}/${milestoneThreshold} YES`, tone: 'amber' };
            } else if (rejected) {
              progress = { stage: 'FUNDING', label: `M#${rejected.idx + 1} POA rejected — resubmit needed`, tone: 'red' };
            } else {
              progress = {
                stage: 'FUNDING',
                label: `${approved}/${milestones.length} milestones approved`,
                tone: approved === milestones.length ? 'emerald' : 'neutral',
              };
            }
          }
        }
      }

      // Build the "why was this rejected" snippets for REJECTED proposals.
      let rejectionReasons: { stage: string; from: string | null; rationale: string }[] | null = null;
      if (status === ProposalStatus.REJECTED) {
        const reasons: { stage: string; from: string | null; rationale: string }[] = [];
        // Fee rejection feedback comes from the board, not a DRep.
        if (!p.stage && p.feeReviewFeedback) {
          reasons.push({ stage: 'FEE', from: 'board (fee review)', rationale: p.feeReviewFeedback });
        } else if (p.stage === 'FILTERING') {
          for (const v of (fVotesBy.get(p.id) ?? []).filter((x) => x.choice === 'NO' && x.rationale)) {
            reasons.push({ stage: 'FILTERING', from: v.drep.user?.displayName ?? v.drep.drepIdOnchain ?? null, rationale: v.rationale ?? '' });
          }
        } else if (p.stage === 'DEBATE_VOTE') {
          for (const v of (dvVotesBy.get(p.id) ?? []).filter((x) => x.choice === 'NO' && x.rationale)) {
            reasons.push({ stage: 'DV', from: v.drep.user?.displayName ?? v.drep.drepIdOnchain ?? null, rationale: v.rationale ?? '' });
          }
        }
        if (reasons.length > 0) rejectionReasons = reasons;
      }

      // §12 — a pending budget change supersedes the normal progress chip so
      // every list view (My proposals, round overview) surfaces this state
      // without needing to open the proposal.
      if (pendingBudgetSet.has(p.id)) {
        progress = {
          stage: 'BUDGET',
          label: 'budget change pending board approval',
          tone: 'amber',
        };
      }

      return { ...base, progress, rejectionReasons };
    });
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

  /**
   * §16 — board fee-review HISTORY: every proposal whose fee has been decided
   * (approved → status moved past PENDING with a real `submittedAt`; or
   * rejected at fee → status REJECTED + stage=null + feeReviewFeedback set).
   * Paged so the panel can scale to many rounds. Newest decision first.
   */
  async listFeeHistory(limit = 20, offset = 0) {
    const safeLimit = Math.min(Math.max(1, limit), 50);
    const safeOffset = Math.max(0, offset);
    const where = {
      OR: [
        // Approved: it left PENDING and made it to ACTIVE / advanced further.
        { status: { in: [ProposalStatus.ACTIVE, ProposalStatus.APPROVED, ProposalStatus.COMPLETE, ProposalStatus.FAILED] }, submittedAt: { not: null } },
        // Rejected AT THE FEE STAGE — stage is still null, feedback is set.
        { status: ProposalStatus.REJECTED, stage: null, feeReviewFeedback: { not: null } },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.proposal.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        take: safeLimit,
        skip: safeOffset,
        include: {
          submitterUser: { select: { displayName: true } },
          category: { select: { name: true } },
          round: { select: { number: true, status: true } },
        },
      }),
      this.prisma.proposal.count({ where }),
    ]);
    return {
      total,
      limit: safeLimit,
      offset: safeOffset,
      rows: rows.map((p) => ({
        id: p.id,
        publicId: p.publicId,
        title: p.title,
        roundNumber: p.round?.number ?? null,
        categoryName: p.category?.name ?? null,
        isCommercial: p.isCommercial,
        submitter: p.submitterUser?.displayName ?? null,
        submittedAt: p.submittedAt,
        submissionFeeAda: toAda(p.submissionFeeAda),
        submissionFeeTxHash: p.submissionFeeTxHash,
        // Decision: status REJECTED + stage=null = fee REJECTED, else APPROVED.
        decision: (p.status === ProposalStatus.REJECTED && p.stage === null) ? 'REJECTED' as const : 'APPROVED' as const,
        feedback: p.feeReviewFeedback,
        // §3 — board can still flip the decision while the round hasn't moved
        // past SUBMISSION. UI uses this to render the "Undo / change" button.
        canChange: p.round?.status === RoundStatus.SUBMISSION,
      })),
    };
  }

  async listMine(userId: string) {
    const proposals = await this.prisma.proposal.findMany({
      where: { submitterUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { name: true } },
        submitterUser: { select: { displayName: true } },
        submitterDrep: { select: { drepIdOnchain: true } },
        // Needed by enrichSummaries to compute the per-row "what's needed now" chip
        // so the My-area list surfaces vote progress / pending budget changes / etc.
        round: { select: { status: true, filterReviewerCount: true, filterApprovalVotes: true, milestoneApprovalVotes: true } },
      },
    });
    return this.enrichSummaries(proposals);
  }

  async get(id: string, viewerUserId?: string) {
    const [p, pendingBudget] = await Promise.all([
      this.prisma.proposal.findUnique({
        where: { id },
        include: {
          milestones: { orderBy: { idx: 'asc' } },
          category: { select: { name: true, minAda: true, maxAda: true, conditions: true } },
          submitterUser: { select: { displayName: true } },
          submitterDrep: { select: { drepIdOnchain: true } },
          round: { select: { status: true, filterResubmissionsAllowed: true, filterBudgetChangesAllowed: true } },
        },
      }),
      this.prisma.budgetChangeRequest.findFirst({
        where: { proposalId: id, status: 'PENDING' },
        include: { requester: { select: { displayName: true } } },
      }),
    ]);
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
      ecosystemImpactMd: p.ecosystemImpactMd,
      successMetricsMd: p.successMetricsMd,
      submissionFeeAda: toAda(p.submissionFeeAda),
      submissionFeeTxHash: p.submissionFeeTxHash,
      submissionFeeTxHashes: p.submissionFeeTxHashes,
      feeReviewFeedback: p.feeReviewFeedback,
      filterResubmissionsUsed: p.filterResubmissionsUsed,
      filterResubmissionsAllowed:
        p.round?.filterResubmissionsAllowed ?? ROUND_SETTING_DEFAULTS.filterResubmissionsAllowed,
      budgetChangesUsed: p.budgetChangesUsed,
      filterBudgetChangesAllowed:
        p.round?.filterBudgetChangesAllowed ?? ROUND_SETTING_DEFAULTS.filterBudgetChangesAllowed,
      // §12 — a pending board-approval-needed budget change, if any. Hides the
      // "Request a budget change" button and surfaces a banner for everyone.
      pendingBudgetChange: pendingBudget
        ? {
            id: pendingBudget.id,
            prevAmountAda: toAda(pendingBudget.prevAmountAda),
            proposedAmountAda: toAda(pendingBudget.proposedAmountAda),
            proposedMilestones: pendingBudget.proposedMilestones,
            reason: pendingBudget.reason,
            createdAt: pendingBudget.createdAt.toISOString(),
            requester: pendingBudget.requester?.displayName ?? null,
          }
        : null,
      roundStatus: p.round?.status ?? null,
      submittedAt: p.submittedAt,
      // §9.3 — set when the board (or auto-finalize on VOTE → FUNDING) publishes
      // the D&V tally. Lets the rejection banner distinguish a D&V rejection
      // (stage=null, resultFinalizedAt set) from a fee-stage rejection.
      resultFinalizedAt: p.resultFinalizedAt,
      payoutAddress: p.payoutAddress,
      // §3 — pledge promise + confirmation state.
      pledgeAmountAda: toAda(p.pledgeAmountAda),
      pledgeReturnMethod: p.pledgeReturnMethod,
      pledgeTxHash: p.pledgeTxHash,
      pledgeConfirmedAt: p.pledgeConfirmedAt,
      pledgeFeedback: p.pledgeFeedback,
      // §3.4 — revenue-sharing gate. When required, the board must verify
      // before milestone work begins (the verifiedAt timestamp unlocks it).
      revenueSharingRequired: p.revenueSharingRequired,
      revenueSharingVerifiedAt: p.revenueSharingVerifiedAt,
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
   *  - DRAFT / PENDING / fee-REJECTED (pre-public, no snapshot), OR
   *  - the round is in SUBMISSION (the team polishes a submitted proposal), OR
   *  - the proposal was REJECTED at filtering AND the round is still in FILTERING
   *    AND the per-round resubmission budget isn't exhausted (the resubmit cycle).
   * No edits while the round is in FILTERING (without a prior rejection), D&V,
   * FUNDING, or after a final decision.
   */
  private async ownEditable(userId: string, id: string) {
    const p = await this.prisma.proposal.findUnique({
      where: { id },
      include: { round: { select: { status: true, filterResubmissionsAllowed: true, filterBudgetChangesAllowed: true } } },
    });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    // Pre-public states → full editing (all fields, no version snapshot):
    //  DRAFT, PENDING (awaiting fee confirmation), and a fee-REJECTED proposal (REJECTED
    //  before it ever entered Filtering) which the submitter fixes and re-submits.
    const feeRejected = p.status === ProposalStatus.REJECTED && p.stage == null;
    if (p.status === ProposalStatus.DRAFT || p.status === ProposalStatus.PENDING || feeRejected) {
      return { proposal: p, postSubmission: false };
    }
    const roundStatus = p.round?.status ?? null;
    // §3 — during the round's SUBMISSION window the team can polish a submitted
    // proposal (ACTIVE+FILTERING). Snapshots a version on each edit.
    if (roundStatus === RoundStatus.SUBMISSION && p.status === ProposalStatus.ACTIVE) {
      return { proposal: p, postSubmission: true };
    }
    // §8.1 — during DEBATE the team can revise based on reviewer feedback (no
    // voting yet). Editing closes the moment the round advances to VOTE.
    if (roundStatus === RoundStatus.DEBATE && p.status === ProposalStatus.ACTIVE) {
      return { proposal: p, postSubmission: true };
    }
    // §7.4 — REJECTED at filtering. The submitter can revise while the round is
    // still in FILTERING, up to filterResubmissionsAllowed times; the next
    // resubmit clears the jury votes and reopens the proposal as ACTIVE.
    if (p.status === ProposalStatus.REJECTED && p.stage === ProposalStage.FILTERING && roundStatus === RoundStatus.FILTERING) {
      const allowed = p.round?.filterResubmissionsAllowed ?? ROUND_SETTING_DEFAULTS.filterResubmissionsAllowed;
      if (p.filterResubmissionsUsed < allowed) {
        return { proposal: p, postSubmission: true };
      }
      throw new ConflictException(
        `no resubmissions left for this proposal (used ${p.filterResubmissionsUsed} of ${allowed})`,
      );
    }
    throw new ConflictException(
      "editing is closed: proposals can be edited during the round's SUBMISSION window, or revised after a filtering rejection (until resubmissions are exhausted)",
    );
  }

  /**
   * §7.4 — submitter resubmits a proposal that was REJECTED at filtering. Increments
   * filterResubmissionsUsed, deletes the existing filtering votes (the jury votes
   * again on the revised content) and clears any fee-review feedback. Proposal
   * goes back to ACTIVE/FILTERING and re-enters the filtering decision loop. The
   * original rejection's on-chain anchor is left in place — anchors are append-only;
   * a fresh anchor fires when the new round of voting decides.
   */
  async resubmit(userId: string, id: string) {
    const p = await this.prisma.proposal.findUnique({
      where: { id },
      include: { round: { select: { id: true, status: true, filterResubmissionsAllowed: true, filterBudgetChangesAllowed: true } } },
    });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your proposal');
    if (p.status !== ProposalStatus.REJECTED || p.stage !== ProposalStage.FILTERING) {
      throw new ConflictException('resubmit is only available for a proposal rejected at filtering');
    }
    if (p.round?.status !== RoundStatus.FILTERING) {
      throw new ConflictException(
        `the round is in ${p.round?.status ?? 'no round'}, not FILTERING — the resubmit window is closed`,
      );
    }
    const allowed = p.round.filterResubmissionsAllowed ?? ROUND_SETTING_DEFAULTS.filterResubmissionsAllowed;
    if (p.filterResubmissionsUsed >= allowed) {
      throw new ConflictException(`no resubmissions left (used ${p.filterResubmissionsUsed} of ${allowed})`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.vote.deleteMany({ where: { proposalId: id, phase: VotePhase.FILTERING } });
      await tx.proposal.update({
        where: { id },
        data: {
          status: ProposalStatus.ACTIVE,
          stage: ProposalStage.FILTERING,
          feeReviewFeedback: null,
          filterResubmissionsUsed: { increment: 1 },
        },
      });
    });
    return this.get(id, userId);
  }

  private wordCount(text: string | null | undefined): number {
    return (text ?? '').trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * §3 — every listed text field must have at least the round's `mandatoryWords`
   * count. 0 disables the check (test mode). Validates on submit and on every
   * post-submission edit; pre-public drafts can stay partial.
   */
  private async assertMandatoryWords(
    roundId: string | null,
    fields: { label: string; text: string | null | undefined }[],
  ) {
    if (!roundId) return;
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: { mandatoryWords: true },
    });
    const min = round?.mandatoryWords ?? ROUND_SETTING_DEFAULTS.mandatoryWords;
    if (min <= 0) return;
    const short = fields.filter((f) => this.wordCount(f.text) < min);
    if (short.length === 0) return;
    const detail = short
      .map((f) => `${f.label} (${this.wordCount(f.text)}/${min})`)
      .join(', ');
    throw new BadRequestException(
      `Each mandatory field needs at least ${min} word${min === 1 ? '' : 's'}. Too short: ${detail}.`,
    );
  }

  private mandatoryProposalFields(
    p: {
      title: string;
      contentMd: string;
      ecosystemImpactMd: string | null;
      successMetricsMd: string | null;
      costBreakdownMd: string | null;
      teamInfo?: unknown;
    },
    milestones: { idx?: number; title: string | null; description: string | null; acceptanceCriteria: string | null }[],
  ): { label: string; text: string | null | undefined }[] {
    const teamText = typeof p.teamInfo === 'string' ? p.teamInfo : null;
    const out: { label: string; text: string | null | undefined }[] = [
      { label: 'Title', text: p.title },
      { label: 'Pitch / summary', text: p.contentMd },
      { label: 'Expected ecosystem impact', text: p.ecosystemImpactMd },
      { label: 'Success metrics / KPIs', text: p.successMetricsMd },
      { label: 'Cost breakdown', text: p.costBreakdownMd },
      { label: 'Team info', text: teamText },
    ];
    milestones.forEach((m, i) => {
      const n = (m.idx != null ? m.idx : i) + 1;
      out.push({ label: `Milestone ${n} title`, text: m.title });
      out.push({ label: `Milestone ${n} description`, text: m.description });
      out.push({ label: `Milestone ${n} acceptance criteria`, text: m.acceptanceCriteria });
    });
    return out;
  }

  private assertMilestonesSum(milestones: MilestoneInput[], requestedAda: number) {
    const sum = milestones.reduce((acc, m) => acc + m.amountAda, 0);
    if (sum !== requestedAda) {
      throw new BadRequestException(`milestone amounts (${sum}) must sum to requested amount (${requestedAda})`);
    }
  }

  /**
   * §3 — pledge validation. Pledges are OPTIONAL: the team decides at proposal
   * creation whether to provide one. When opting in (pledgeAmountAda > 0):
   *   - the round's pledgeThresholdAda (or the platform default) sets the MINIMUM
   *     the team may pledge,
   *   - a return-method description is required (how the pledge will be repaid).
   * A pledgeAmountAda of 0 / null means "no pledge promised" — fine if either the
   * round has pledges disabled OR the team simply chose not to opt in.
   */
  private assertPledge(
    round: { pledgeThresholdAda?: number | null },
    amountAda: number | null | undefined,
    returnMethod: string | null | undefined,
  ) {
    if (!amountAda) return; // no pledge promised — always allowed
    const min = round.pledgeThresholdAda ?? ROUND_SETTING_DEFAULTS.pledgeThresholdAda;
    if (min > 0 && amountAda < min) {
      throw new BadRequestException(
        `pledge of ${amountAda.toLocaleString()} ₳ is below the round's minimum of ${min.toLocaleString()} ₳`,
      );
    }
    if (!returnMethod?.trim()) {
      throw new BadRequestException('a return-method description is required when opting in to a pledge');
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
