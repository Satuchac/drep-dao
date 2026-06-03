import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
// §15.3 — hard cap on a single board-prepared top-up. The hot wallet only
// pays Cardano fees for anchor txs, so a small running balance is enough;
// large amounts shouldn't sit there unsigned. Configurable later if needed.
const HOT_WALLET_TOPUP_MAX_ADA = 1000;

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
  /**
   * §15.3 — the LIVE treasury address. Once the board has assembled the
   * multisig, that script address is the canonical home; the env
   * TREASURY_ADDRESS is only used as a fallback while no multisig exists
   * (fresh install, or after a reset). Inbound flows (submission fees,
   * pledges) and outbound flows (payouts, top-ups) all read through here so
   * the address auto-rotates when the board changes.
   */
  async resolveTreasuryAddress(): Promise<string | null> {
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
      select: { bech32Address: true },
    });
    return active?.bech32Address ?? this.config.get<string>('TREASURY_ADDRESS') ?? null;
  }

  async overview() {
    const treasury = await this.resolveTreasuryAddress();
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
      // Budget caps default to 0 ₳ — they only show real numbers when the
      // operator sets REWARDS_BUDGET_ADA / OPERATIONS_BUDGET_ADA explicitly.
      // The previous 600M default was nonsensical right after a reset
      // ("allocated 1.2B ₳" when the treasury actually held 19K).
      bucket('rewards', 'Rewards', this.num('REWARDS_BUDGET_ADA', 0), Number(rewardsPaid._sum.amountAda ?? 0n) / ADA, this.config.get<string>('REWARDS_ADDRESS') || treasury),
      bucket('operations', 'Operations', this.num('OPERATIONS_BUDGET_ADA', 0), Number(opsSpent._sum.amountAda ?? 0n) / ADA, this.config.get<string>('OPERATIONS_ADDRESS') || treasury),
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

    const treasuryAddress = await this.resolveTreasuryAddress();
    const balMap = treasuryAddress ? await this.cardano.addressBalance([treasuryAddress]) : new Map<string, bigint>();
    const treasuryBalanceAda = treasuryAddress ? Number(balMap.get(treasuryAddress) ?? 0n) / ADA : 0;

    const actions = await this.prisma.multisigAction.findMany({
      where: { status: 'PENDING_SIGS' },
      include: { signatures: { select: { boardDrepId: true } }, commitments: { select: { userId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    type Row = {
      id: string; kind: string; description: string | null; amountAda: bigint | null; status: string;
      txHash: string | null; createdAt: Date;
      signatures: { boardDrepId: string }[];
      commitments: { userId: string }[];
      committedKeyHashes: string[];
      proposalId: string | null; milestoneId: string | null; milestoneIdx: number | null;
      proposalTitle: string | null; destAddress: string | null; paidAt: Date | null;
    };
    const map = (a: Row) => {
      const amt = a.amountAda ? Number(a.amountAda) / ADA : null;
      // §15 phase tracking: PENDING_SIGS splits into AUTHORIZE (collecting
      // commits) vs SIGN (committed keyhashes snapshotted; tx body buildable;
      // collecting real witnesses).
      const inSignPhase = (a.committedKeyHashes?.length ?? 0) >= APPROVAL_THRESHOLD;
      return {
        id: a.id,
        kind: a.kind,
        description: a.description,
        amountAda: amt,
        status: a.status,
        txHash: a.txHash,
        approvals: a.signatures.length,
        commitments: a.commitments.length,
        threshold: APPROVAL_THRESHOLD,
        phase: inSignPhase ? 'SIGN' : 'AUTHORIZE',
        mineApproved: a.signatures.some((s) => s.boardDrepId === board.id),
        mineCommitted: a.commitments.some((c) => c.userId === userId),
        createdAt: a.createdAt,
        proposalId: a.proposalId,
        milestoneId: a.milestoneId,
        milestoneIdx: a.milestoneIdx,
        proposalTitle: a.proposalTitle,
        destAddress: a.destAddress,
        paidAt: a.paidAt,
        insufficient: amt != null && treasuryBalanceAda < amt,
      };
    };
    const view = (actions as unknown as Row[]).map(map);
    const history = includeHistory
      ? ((await this.prisma.multisigAction.findMany({
          where: { status: { not: 'PENDING_SIGS' } },
          include: { signatures: { select: { boardDrepId: true } }, commitments: { select: { userId: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })) as unknown as Row[]).map(map)
      : [];
    return {
      // §15 — each action contributes 1 to the to-do count when this user
      // hasn't done their part of the CURRENT phase yet. Phase 1: hasn't
      // committed. Phase 2: hasn't signed.
      count: view.filter((a) => (a.phase === 'AUTHORIZE' ? !a.mineCommitted : !a.mineApproved)).length,
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
        // destAddress = hot wallet so the Actions UI shows the full destination + Copy button.
        destAddress: hot,
        description: `Top up the anchor hot wallet — balance below ${HOT_WALLET_MIN_ADA} ₳`,
      },
    });
  }

  /** §15.3 — board member explicitly prepares a top-up (in addition to the
   *  auto-trigger). Capped at HOT_WALLET_TOPUP_MAX_ADA so we never sit a
   *  large balance on a single-sig hot wallet. */
  async prepareTopUp(userId: string, amountAda: number) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    const hot = this.anchor.hotWalletAddress();
    if (!hot) throw new BadRequestException('no hot wallet configured');
    if (!(amountAda > 0)) throw new BadRequestException('amount must be > 0');
    if (amountAda > HOT_WALLET_TOPUP_MAX_ADA) {
      throw new BadRequestException(`a single top-up is capped at ${HOT_WALLET_TOPUP_MAX_ADA} ₳ — split into multiple top-ups if you need more`);
    }
    // Dedup: refuse if a top-up is already pending. The board should sign or
    // cancel that one before queueing another (and avoids the duplicate-row
    // pile-up if the UI is double-clicked while waiting on a response).
    const open = await this.prisma.multisigAction.findFirst({
      where: { kind: 'OPS', status: 'PENDING_SIGS', destAddress: hot },
    });
    if (open) {
      throw new ConflictException('a hot-wallet top-up is already pending signatures — sign or wait for that one before queueing another');
    }
    const row = await this.prisma.multisigAction.create({
      data: {
        kind: 'OPS',
        status: 'PENDING_SIGS',
        amountAda: BigInt(Math.round(amountAda * ADA)),
        destAddress: hot,
        description: `Top up the anchor hot wallet (board-requested)`,
      },
    });
    // Strip BigInt so the JSON serializer doesn't choke; the UI only needs
    // a confirmation it landed.
    return { id: row.id, status: row.status, amountAda };
  }

  /** §15.4 — any board member can initiate an arbitrary transfer of ADA from
   *  the treasury (multisig) to an address of their choice. Requires the
   *  same 3-of-N board signing flow (via the Approve & sign queue) and a
   *  written context that gets recorded as the action description (audit
   *  trail). Refuses when the destination address is malformed, the amount
   *  is non-positive, or the live treasury balance can't cover it. */
  async prepareBoardTransfer(userId: string, dto: { destAddress: string; amountAda: number; context: string }) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    const dest = (dto.destAddress ?? '').trim();
    if (!/^addr(_test)?[a-z0-9]+$/i.test(dest)) {
      throw new BadRequestException('destAddress must be a Cardano bech32 address (addr… / addr_test…)');
    }
    if (!Number.isFinite(dto.amountAda) || dto.amountAda <= 0) {
      throw new BadRequestException('amountAda must be a positive number');
    }
    const context = (dto.context ?? '').trim();
    if (context.length < 10) {
      throw new BadRequestException('please provide at least 10 characters of context — every transfer is audited');
    }
    if (context.length > 2000) {
      throw new BadRequestException('context is capped at 2000 characters');
    }
    // No queue-time balance precheck on purpose: a board member may want to
    // queue + collect authorizations BEFORE funds arrive (e.g. waiting on an
    // incoming sweep). The 3rd-signature path (approve()) already refuses to
    // push to READY when the treasury can't cover the amount, so queueing
    // when underfunded is harmless — boardActionsFor() also flags it with
    // `insufficient: true` so signers see the gap before they approve.
    const row = await this.prisma.multisigAction.create({
      data: {
        kind: 'BOARD_TRANSFER',
        status: 'PENDING_SIGS',
        amountAda: BigInt(Math.round(dto.amountAda * ADA)),
        destAddress: dest,
        description: context,
      },
    });
    return { id: row.id, status: row.status, amountAda: dto.amountAda, destAddress: dest };
  }

  /** §15.4 — any board member can cancel a pending multisig action. Single
   *  click (no threshold). Marks the action FAILED so it disappears from
   *  the live queue + appears in history with the cancellation reason.
   *  Allowed only while the action is still PENDING_SIGS or READY — once a
   *  tx is broadcast (BROADCASTED) or confirmed on-chain (CONFIRMED) it
   *  cannot be cancelled. */
  async cancelBoardAction(userId: string, actionId: string, reason: string) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException('action not found');
    if (action.status !== 'PENDING_SIGS' && action.status !== 'READY') {
      throw new ConflictException(`cannot cancel an action in status ${action.status}`);
    }
    const r = (reason ?? '').trim();
    if (r.length < 5) {
      throw new BadRequestException('please provide a short cancellation reason (audit trail)');
    }
    if (r.length > 500) {
      throw new BadRequestException('cancellation reason is capped at 500 characters');
    }
    const me = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { displayName: true } });
    const note = `[CANCELLED by ${me?.displayName ?? 'board'}: ${r}]`;
    await this.prisma.multisigAction.update({
      where: { id: actionId },
      data: {
        status: 'FAILED',
        // Preserve the original description; append the cancellation note so
        // the history row says WHY it was cancelled and by whom.
        description: action.description ? `${action.description}\n\n${note}` : note,
      },
    });
    return { id: actionId, status: 'FAILED' };
  }

  /** §15.3 — board-callable sweep of ALL hot-wallet funds back into the
   *  multisig treasury. Single-click: the hot wallet is single-sig (its
   *  mnemonic is platform-held) so no multisig threshold is required to move
   *  funds INTO the treasury. We persist the sweep so the Treasury history
   *  panel can show what moved + link the explorer even after a refresh. */
  async sweepHotWallet(userId: string) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    // Snapshot the balance BEFORE the sweep — this is what the tx is moving
    // (minus the fee). The post-sweep balance read would already be 0 / dust.
    const hotAddr = this.anchor.hotWalletAddress();
    let preBalance = 0n;
    if (hotAddr) {
      const m = await this.cardano.addressBalance([hotAddr]).catch(() => new Map<string, bigint>());
      preBalance = m.get(hotAddr) ?? 0n;
    }
    const r = await this.anchor.sweepToMultisig();
    // Best-effort persistence — never block the user on a history-record
    // failure (the on-chain tx already broadcast).
    try {
      await this.prisma.hotWalletSweep.create({
        data: {
          txHash: r.txHash,
          amountLovelace: preBalance,
          fromAddress: hotAddr ?? '',
          toAddress: r.to,
          initiatedByUserId: userId,
        },
      });
    } catch (e) {
      // Unique-conflict on txHash means we already persisted (e.g. retry) —
      // that's fine.
      void e;
    }
    return r;
  }

  /**
   * §15.3 — merged hot-wallet TX history. Combines:
   *   • TREASURY → HOT (top-ups): every OPS-kind MultisigAction whose
   *     destAddress matches the hot wallet, regardless of status — so the
   *     UI can show "pending signatures" / "awaiting broadcast" / "PAID"
   *     all in one place (not just the CONFIRMED end-state).
   *   • HOT → TREASURY (sweeps): rows from the HotWalletSweep table.
   * Sorted newest first; capped at 50.
   */
  async hotWalletHistory(limit = 50) {
    const hotAddr = this.anchor.hotWalletAddress();
    if (!hotAddr) return { items: [], hotWalletAddress: null };
    const [topups, sweeps] = await Promise.all([
      this.prisma.multisigAction.findMany({
        where: { kind: 'OPS', destAddress: hotAddr },
        include: { signatures: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.hotWalletSweep.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { initiatedBy: { select: { displayName: true } } },
      }),
    ]);
    type Item = {
      id: string;
      direction: 'TOP_UP' | 'SWEEP';
      amountAda: number;
      txHash: string | null;
      at: Date;
      description: string | null;
      initiatedBy: string | null;
      status: string;       // PENDING_SIGS / READY / BROADCASTED / CONFIRMED / FAILED / SWEPT
      approvals?: number;   // for top-ups: how many sigs collected
      threshold?: number;   // for top-ups: how many needed (always 3)
    };
    const items: Item[] = [];
    for (const t of topups) {
      items.push({
        id: t.id,
        direction: 'TOP_UP',
        amountAda: t.amountAda ? Number(t.amountAda) / ADA : 0,
        txHash: t.txHash,
        at: t.paidAt ?? t.createdAt,
        description: t.description,
        initiatedBy: null,
        status: t.status,
        approvals: t.signatures.length,
        threshold: APPROVAL_THRESHOLD,
      });
    }
    for (const s of sweeps) {
      items.push({
        id: s.id,
        direction: 'SWEEP',
        amountAda: Number(s.amountLovelace) / ADA,
        txHash: s.txHash,
        at: s.createdAt,
        description: null,
        initiatedBy: s.initiatedBy?.displayName ?? null,
        status: 'SWEPT',
      });
    }
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { items: items.slice(0, limit), hotWalletAddress: hotAddr };
  }

  /** Surface the per-platform constants the UI needs (top-up cap, low-balance
   *  threshold) so the form can validate locally + show the right help text. */
  hotWalletPolicy() {
    return {
      minAda: HOT_WALLET_MIN_ADA,
      topUpMaxAda: HOT_WALLET_TOPUP_MAX_ADA,
      autoTopUpAda: HOT_WALLET_TOPUP_ADA,
    };
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
        const treasuryAddr = await this.resolveTreasuryAddress();
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
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: d.user.drepKeyHash } });
    return seat ? { id: d.id, stakeAddress: d.user.stakeAddress } : null;
  }
}
