import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { boardActionMessage } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AnchorService } from '../cardano/anchor.service';
import { verifyCip30Signature } from '../auth/cip30';

const ADA = 1_000_000;
const APPROVAL_THRESHOLD = 3; // 3-of-5 board multisig
const HOT_WALLET_MIN_ADA = 100; // below this, the platform prepares a top-up
const HOT_WALLET_TOPUP_ADA = 500;

@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cardano: CardanoQueryService,
    private readonly anchor: AnchorService,
  ) {}

  private num(key: string, fallback: number): number {
    const v = this.config.get<string>(key);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * §15 — treasury overview: the 3-of-5 multisig balance + budget buckets
   * (rewards, operations, per-round) with allocated / spent / remaining, plus
   * the anchor hot wallet. Budgets are configurable; spend is read from data.
   */
  async overview() {
    const treasury = this.config.get<string>('TREASURY_ADDRESS') || null;
    const hot = this.anchor.hotWalletAddress();
    const addrs = [treasury, hot].filter((a): a is string => !!a);
    const bal = await this.cardano.addressBalance(addrs);
    const ada = (a: string | null) => (a ? Number(bal.get(a) ?? 0n) / ADA : 0);

    // Spend so far (from data we have): rewards paid out; ops spend via multisig.
    const rewardsPaid = await this.prisma.rewardEntry.aggregate({
      _sum: { amountAda: true },
      where: { paidAt: { not: null } },
    });
    const opsSpent = await this.prisma.multisigAction.aggregate({
      _sum: { amountAda: true },
      where: { kind: 'OPS', status: 'CONFIRMED' },
    });
    const rounds = await this.prisma.round.findMany({ orderBy: { number: 'asc' } });

    const bucket = (key: string, name: string, allocatedAda: number, spentAda: number, address: string | null) => ({
      key,
      name,
      allocatedAda,
      spentAda,
      remainingAda: Math.max(0, allocatedAda - spentAda),
      address,
    });

    const buckets = [
      bucket('rewards', 'Rewards', this.num('REWARDS_BUDGET_ADA', 600_000_000), Number(rewardsPaid._sum.amountAda ?? 0n) / ADA, this.config.get<string>('REWARDS_ADDRESS') || treasury),
      bucket('operations', 'Operations', this.num('OPERATIONS_BUDGET_ADA', 600_000_000), Number(opsSpent._sum.amountAda ?? 0n) / ADA, this.config.get<string>('OPERATIONS_ADDRESS') || treasury),
      ...rounds.map((r) =>
        bucket(`round-${r.number}`, `Round #${r.number}${r.name ? ` — ${r.name}` : ''}`, Number(r.budgetAda) / ADA, 0, r.multisigAddress || treasury),
      ),
    ];

    return {
      treasury: { address: treasury, balanceAda: ada(treasury), configured: !!treasury },
      hotWallet: { address: hot, balanceAda: ada(hot), minAda: HOT_WALLET_MIN_ADA },
      buckets,
      totalAllocatedAda: buckets.reduce((s, b) => s + b.allocatedAda, 0),
      totalSpentAda: buckets.reduce((s, b) => s + b.spentAda, 0),
    };
  }

  /** Pending board actions for a board member (drives the notification badge).
   *  Returns enriched fields per action: proposalTitle, milestoneIdx, full
   *  destAddress, the on-chain payout tx hash, and an `insufficient` flag
   *  computed against the live treasury balance so the board can SEE the
   *  funding gap before they approve. */
  async boardActionsFor(userId: string, includeHistory = false) {
    const board = await this.boardDrep(userId);
    if (!board) return { count: 0, actions: [], history: [], treasury: null };
    await this.maybePrepareTopUp(); // platform prepares a top-up if the hot wallet is low

    const treasuryAddress = this.config.get<string>('TREASURY_ADDRESS') || null;
    const balMap = treasuryAddress ? await this.cardano.addressBalance([treasuryAddress]) : new Map<string, bigint>();
    const treasuryBalanceAda = treasuryAddress ? Number(balMap.get(treasuryAddress) ?? 0n) / ADA : 0;

    const actions = await this.prisma.multisigAction.findMany({
      where: { status: 'PENDING_SIGS' },
      include: { signatures: true },
      orderBy: { createdAt: 'asc' },
    });
    type Row = {
      id: string; kind: string; description: string | null; amountAda: bigint | null; status: string;
      txHash: string | null; createdAt: Date; signatures: { boardDrepId: string }[];
      proposalId: string | null; milestoneId: string | null; milestoneIdx: number | null;
      proposalTitle: string | null; destAddress: string | null; paidAt: Date | null;
    };
    const map = (a: Row) => {
      const amt = a.amountAda ? Number(a.amountAda) / ADA : null;
      return {
        id: a.id,
        kind: a.kind,
        description: a.description,
        amountAda: amt,
        status: a.status,
        txHash: a.txHash,
        approvals: a.signatures.length,
        threshold: APPROVAL_THRESHOLD,
        mineApproved: a.signatures.some((s) => s.boardDrepId === board.id),
        createdAt: a.createdAt,
        proposalId: a.proposalId,
        milestoneId: a.milestoneId,
        milestoneIdx: a.milestoneIdx,
        proposalTitle: a.proposalTitle,
        destAddress: a.destAddress,
        paidAt: a.paidAt,
        // Live insufficiency check: treasury can't cover this disbursement.
        // The board can still keep signing (other actions might be cancelled
        // / funds may arrive) but they SEE the gap right away.
        insufficient: amt != null && treasuryBalanceAda < amt,
      };
    };
    const view = (actions as unknown as Row[]).map(map);
    // Past actions (executed / no longer awaiting signatures), newest first — for the history view.
    const history = includeHistory
      ? ((await this.prisma.multisigAction.findMany({
          where: { status: { not: 'PENDING_SIGS' } },
          include: { signatures: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })) as unknown as Row[]).map(map)
      : [];
    return {
      count: view.filter((a) => !a.mineApproved).length,
      actions: view,
      history,
      treasury: { address: treasuryAddress, balanceAda: treasuryBalanceAda },
    };
  }

  /** §15.3 — platform prepares a treasury→hot-wallet top-up when the hot wallet runs low. */
  async maybePrepareTopUp() {
    const hot = this.anchor.hotWalletAddress();
    if (!hot) return;
    const open = await this.prisma.multisigAction.findFirst({ where: { kind: 'OPS', status: 'PENDING_SIGS', description: { contains: 'hot wallet' } } });
    if (open) return;
    const bal = await this.cardano.addressBalance([hot]);
    if (Number(bal.get(hot) ?? 0n) / ADA >= HOT_WALLET_MIN_ADA) return;
    await this.prisma.multisigAction.create({
      data: {
        kind: 'OPS',
        status: 'PENDING_SIGS',
        amountAda: BigInt(HOT_WALLET_TOPUP_ADA * ADA),
        description: `Top up the anchor hot wallet (${hot.slice(0, 24)}…) — balance below ${HOT_WALLET_MIN_ADA} ₳`,
      },
    });
  }

  /** Board member explicitly prepares a top-up (in addition to the auto-trigger). */
  async prepareTopUp(userId: string, amountAda: number) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    const hot = this.anchor.hotWalletAddress();
    if (!hot) throw new BadRequestException('no hot wallet configured');
    if (!(amountAda > 0)) throw new BadRequestException('amount must be > 0');
    return this.prisma.multisigAction.create({
      data: {
        kind: 'OPS',
        status: 'PENDING_SIGS',
        amountAda: BigInt(Math.round(amountAda * ADA)),
        description: `Top up the anchor hot wallet (${hot.slice(0, 24)}…)`,
      },
    });
  }

  /** A board member approves an action with a CIP-30 signature (3-of-5 to proceed). */
  async approve(userId: string, actionId: string, dto: { signature?: string; signingKey?: string; ts?: string }) {
    const board = await this.boardDrep(userId);
    if (!board) throw new ForbiddenException('board members only');
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId }, include: { signatures: true } });
    if (!action || action.status !== 'PENDING_SIGS') throw new ConflictException('action is not pending signatures');

    // A treasury approval MUST carry a valid CIP-30 signature from the board member's own
    // wallet — never record an unsigned/cancelled approval (it moves funds at 3-of-5).
    if (!dto.signature || !dto.signingKey || !dto.ts) {
      throw new BadRequestException('a wallet signature is required to approve a treasury action');
    }
    const message = boardActionMessage({
      actionId,
      kind: action.kind,
      amountAda: action.amountAda ? Number(action.amountAda) / ADA : 0,
      voterStakeAddress: board.stakeAddress,
      ts: dto.ts,
    });
    if (!verifyCip30Signature(dto.signature, dto.signingKey, message, board.stakeAddress)) {
      throw new BadRequestException('approval signature verification failed');
    }
    const witnessCbor = dto.signature;

    await this.prisma.multisigSignature.upsert({
      where: { actionId_boardDrepId: { actionId, boardDrepId: board.id } },
      update: { witnessCbor },
      create: { actionId, boardDrepId: board.id, witnessCbor },
    });

    const count = await this.prisma.multisigSignature.count({ where: { actionId } });
    let status = action.status;
    if (count >= APPROVAL_THRESHOLD) {
      // 3-of-5 reached. Before flipping to READY, sanity-check that the
      // treasury can actually cover the amount — otherwise the disbursement
      // would fail at broadcast and the action would sit in limbo. Refuse
      // here so the board knows to wait for funds (or cancel) instead of
      // collecting a 4th/5th signature that can't be acted on.
      if (action.amountAda) {
        const treasuryAddr = this.config.get<string>('TREASURY_ADDRESS') || null;
        if (treasuryAddr) {
          const bal = await this.cardano.addressBalance([treasuryAddr]);
          const treasuryLovelace = bal.get(treasuryAddr) ?? 0n;
          if (treasuryLovelace < action.amountAda) {
            const need = Number(action.amountAda) / ADA;
            const have = Number(treasuryLovelace) / ADA;
            throw new ConflictException(
              `treasury has only ${have.toLocaleString()} ₳ on-chain — this action needs ${need.toLocaleString()} ₳. Top up the treasury (or wait for incoming funds) and try again; your signature is recorded.`,
            );
          }
        }
      }
      status = 'READY';
      await this.prisma.multisigAction.update({ where: { id: actionId }, data: { status } });
    }
    return { approvals: count, threshold: APPROVAL_THRESHOLD, status };
  }

  /**
   * §11/§15 — once 3-of-5 signatures are collected (status=READY) the board
   * member who broadcasts the assembled multisig tx pastes the on-chain hash
   * here. The platform verifies it against the destination address + the
   * amount via Koios (mirrors the pledge + fee verification flow) and only
   * then flips the action to CONFIRMED + stamps paidAt. The corresponding
   * milestone is then displayed as PAID with the tx link.
   */
  async submitPayoutTxHash(userId: string, actionId: string, txHash: string) {
    const board = await this.boardDrep(userId);
    if (!board) throw new ForbiddenException('board members only');
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId } });
    if (!action) throw new ConflictException('action not found');
    if (action.status === 'CONFIRMED') return { status: 'CONFIRMED', txHash: action.txHash, paidAt: action.paidAt };
    if (action.status !== 'READY' && action.status !== 'BROADCASTED') {
      throw new ConflictException('this action is not ready for broadcast yet (still collecting signatures)');
    }
    const hash = txHash.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new BadRequestException('a Cardano tx hash is 64 hex characters');
    }
    if (!action.destAddress) {
      throw new ConflictException('this action has no destination address on file — cannot verify');
    }
    const v = await this.cardano.verifyPayment(hash, action.destAddress, action.amountAda ?? 0n);
    if (!v.koiosAvailable) {
      // Don't move state on a transient chain-reader failure; the board can retry.
      await this.prisma.multisigAction.update({ where: { id: actionId }, data: { status: 'BROADCASTED', txHash: hash } });
      return { status: 'BROADCASTED', txHash: hash, koiosAvailable: false, found: false, paid: false };
    }
    if (!v.found) {
      await this.prisma.multisigAction.update({ where: { id: actionId }, data: { status: 'BROADCASTED', txHash: hash } });
      return { status: 'BROADCASTED', txHash: hash, koiosAvailable: true, found: false, paid: false };
    }
    if (!v.paid) {
      throw new ConflictException(
        `the tx is on-chain but didn't pay ${(Number(action.amountAda ?? 0n) / ADA).toLocaleString()} ₳ to the destination address. Did you submit the right tx?`,
      );
    }
    await this.prisma.multisigAction.update({
      where: { id: actionId },
      data: { status: 'CONFIRMED', txHash: hash, paidAt: new Date() },
    });
    return { status: 'CONFIRMED', txHash: hash, paid: true, paidLovelace: v.paidLovelace.toString() };
  }

  /** The user's seated-board Drep (id + stake address), or null. */
  private async boardDrep(userId: string) {
    const d = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { drepKeyHash: true, stakeAddress: true } } },
    });
    if (!d?.user.drepKeyHash) return null;
    const seat = await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: d.user.drepKeyHash } });
    return seat ? { id: d.id, stakeAddress: d.user.stakeAddress } : null;
  }
}
