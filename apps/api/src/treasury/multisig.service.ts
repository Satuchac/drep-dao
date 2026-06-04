import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AnchorService } from '../cardano/anchor.service';
import {
  assembleMultisigTx,
  buildBoardNativeScript,
  buildMultisigSpendTx,
  keyHashOfVkeyWitness,
  scriptHashHex,
  treasuryAddressFromScript,
  vkeyWitnessFromWalletWitnessSet,
  vkeyWitnessSignsTx,
  type EpochParams,
  type MultisigUtxo,
} from './multisig';

const ADA = 1_000_000;
const REQUIRED = 3; // 3-of-5 board quorum

const isKeyHashHex = (h: string) => /^[0-9a-fA-F]{56}$/.test(h.trim());

interface PolicyMember {
  keyHash: string;
  drepKeyHash?: string;
  name?: string;
}

/**
 * §15 — native-script (3-of-5) treasury: turns the board quorum into a real
 * on-chain spend. The board registers their payment key hashes (from their own
 * wallets); the platform assembles the `atLeast 3` script + treasury address,
 * builds each unsigned spend, collects 3 wallet `signTx` witnesses, and merges +
 * broadcasts them. No treasury key ever touches the server (cf. `ANCHOR-WALLET.md`).
 *
 * Crypto lives in `./multisig.ts` (pure, offline-tested in `tools/test-multisig.cjs`);
 * this service is the DB + Koios + policy/quorum orchestration around it.
 */
@Injectable()
export class MultisigService {
  private readonly logger = new Logger(MultisigService.name);
  private readonly base: string;
  private readonly networkId: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly cardano: CardanoQueryService,
    private readonly anchor: AnchorService,
  ) {
    const net = config.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    this.networkId = net === 'Mainnet' ? 1 : 0;
    this.base =
      net === 'Mainnet'
        ? 'https://api.koios.rest/api/v1'
        : net === 'Preview'
          ? 'https://preview.koios.rest/api/v1'
          : 'https://preprod.koios.rest/api/v1';
  }

  // ---- policy setup -------------------------------------------------------

  /**
   * A board member registers the PAYMENT key hash their wallet will sign treasury
   * spends with (from CIP-30 `getUsedAddresses` → the base address payment cred).
   * Stored on their AppUser; changing it invalidates any unconfirmed policy.
   */
  async registerSigningKey(userId: string, paymentKeyHashHex: string) {
    const board = await this.boardUser(userId);
    if (!board) throw new ForbiddenException('board members only');
    const keyHash = paymentKeyHashHex.trim().toLowerCase();
    if (!isKeyHashHex(keyHash)) throw new BadRequestException('expected a 28-byte (56-hex) payment key hash');
    await this.prisma.appUser.update({ where: { id: board.userId }, data: { treasuryKeyHash: keyHash } });
    return { registered: true, keyHash };
  }

  /** Who has registered, and the current policy (if any) — drives the setup UI. */
  async policyStatus() {
    const seats = await this.prisma.boardSeat.findMany({ orderBy: { addedAt: 'asc' } });
    const users = await this.prisma.appUser.findMany({
      where: { drepKeyHash: { in: seats.map((s) => s.drepKeyHash) } },
      select: { drepKeyHash: true, treasuryKeyHash: true, displayName: true },
    });
    const byHash = new Map(users.map((u) => [u.drepKeyHash!, u]));
    const members = seats.map((s) => ({
      name: s.displayName,
      drepKeyHash: s.drepKeyHash,
      registered: !!byHash.get(s.drepKeyHash)?.treasuryKeyHash,
    }));
    const policy = await this.activePolicy();
    return {
      required: REQUIRED,
      seats: members,
      registeredCount: members.filter((m) => m.registered).length,
      canAssemble: members.length >= REQUIRED && members.every((m) => m.registered),
      policy: policy
        ? { address: policy.address, scriptHash: policy.scriptHash, required: policy.required, status: policy.status, confirmedAt: policy.confirmedAt }
        : null,
    };
  }

  /**
   * Assemble the `atLeast 3` native script from every board seat's registered key,
   * derive the treasury address, and store it CONFIRMED (retiring any prior policy).
   * Requires all seats registered so the script is the full board.
   */
  async assembleAndConfirm(userId: string) {
    if (!(await this.boardUser(userId))) throw new ForbiddenException('board members only');
    const seats = await this.prisma.boardSeat.findMany({ orderBy: { addedAt: 'asc' } });
    if (seats.length < REQUIRED) throw new BadRequestException(`need ≥ ${REQUIRED} board seats to form a ${REQUIRED}-of-N policy`);
    const users = await this.prisma.appUser.findMany({
      where: { drepKeyHash: { in: seats.map((s) => s.drepKeyHash) } },
      select: { drepKeyHash: true, treasuryKeyHash: true },
    });
    const keyByDrep = new Map(users.map((u) => [u.drepKeyHash!, u.treasuryKeyHash]));
    const members: PolicyMember[] = [];
    for (const s of seats) {
      const kh = keyByDrep.get(s.drepKeyHash);
      if (!kh) throw new BadRequestException(`${s.displayName} has not registered a treasury signing key yet`);
      members.push({ keyHash: kh, drepKeyHash: s.drepKeyHash, name: s.displayName });
    }
    const script = buildBoardNativeScript(members.map((m) => m.keyHash), REQUIRED);
    const scriptHash = scriptHashHex(script);
    const address = treasuryAddressFromScript(script, this.networkId);

    await this.prisma.$transaction([
      this.prisma.treasuryPolicy.updateMany({ where: { status: 'CONFIRMED' }, data: { status: 'RETIRED' } }),
      this.prisma.treasuryPolicy.upsert({
        where: { scriptHash },
        update: { status: 'CONFIRMED', confirmedAt: new Date(), address, required: REQUIRED, memberKeyHashes: members as unknown as object },
        create: {
          scriptHash,
          scriptCbor: script.to_hex(),
          address,
          required: REQUIRED,
          memberKeyHashes: members as unknown as object,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      }),
    ]);
    this.logger.log(`treasury policy confirmed: ${REQUIRED}-of-${members.length} → ${address}`);
    return { address, scriptHash, required: REQUIRED, members: members.map((m) => ({ name: m.name, keyHash: m.keyHash })) };
  }

  // ---- spend: build → sign → broadcast ------------------------------------

  /**
   * The unsigned spend tx a board wallet signs for an action. Built lazily on first
   * request from the live treasury UTxOs + protocol params, then cached on the row
   * (txCbor) so every signer signs the SAME tx (a stable body hash to witness).
   */
  async actionTxToSign(actionId: string): Promise<{ txHex: string; txHash: string; address: string }> {
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException('action not found');
    if (action.status !== 'PENDING_SIGS') throw new ConflictException(`action is ${action.status}, not awaiting signatures`);
    const policy = await this.confirmedPolicyOrThrow();

    if (action.txCbor && action.txHash) {
      return { txHex: action.txCbor, txHash: action.txHash, address: policy.address };
    }
    const recipient = await this.resolveRecipient(action);
    const amount = action.amountAda ?? 0n;
    if (!(amount > 0n)) throw new BadRequestException('action has no positive amount to spend');

    const utxos = await this.addressUtxos(policy.address);
    if (!utxos.length) throw new BadRequestException('the treasury address has no UTxOs to spend (fund it first)');
    const pp = await this.epochParams();
    const script = CSL.NativeScript.from_hex(policy.scriptCbor);
    const built = buildMultisigSpendTx({
      script,
      treasuryAddressBech32: policy.address,
      recipientBech32: recipient,
      amountLovelace: amount,
      utxos,
      pp,
    });
    await this.prisma.multisigAction.update({ where: { id: actionId }, data: { txCbor: built.txHex, txHash: built.txHash, recipient } });
    return { txHex: built.txHex, txHash: built.txHash, address: policy.address };
  }

  /**
   * A board member submits the witness set their wallet returned from
   * `signTx(txHex, true)`. We extract the vkey witness, verify it signs THIS action's
   * tx and that the signer is one of the policy's board keys (and this member's own
   * registered key), then store it. At 3 distinct witnesses we assemble + broadcast.
   */
  async submitWitness(userId: string, actionId: string, witnessSetHex: string) {
    const board = await this.boardUser(userId);
    if (!board) throw new ForbiddenException('board members only');
    if (!board.treasuryKeyHash) throw new BadRequestException('register your treasury signing key first');
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId }, include: { signatures: true } });
    if (!action) throw new NotFoundException('action not found');
    if (action.status !== 'PENDING_SIGS') throw new ConflictException(`action is ${action.status}, not awaiting signatures`);
    if (!action.txCbor || !action.txHash) throw new BadRequestException('the spend tx is not built yet — fetch it to sign first');
    const policy = await this.confirmedPolicyOrThrow();

    let vkey: string;
    try {
      vkey = vkeyWitnessFromWalletWitnessSet(witnessSetHex);
    } catch {
      throw new BadRequestException('could not read a vkey witness from the wallet response');
    }
    if (!vkeyWitnessSignsTx(vkey, action.txHash)) {
      throw new BadRequestException('the signature does not sign this transaction');
    }
    const signerHash = keyHashOfVkeyWitness(vkey);
    const policyKeys = new Set((policy.memberKeyHashes as unknown as PolicyMember[]).map((m) => m.keyHash.toLowerCase()));
    if (!policyKeys.has(signerHash.toLowerCase())) {
      throw new BadRequestException('the signing key is not part of the treasury policy');
    }
    if (signerHash.toLowerCase() !== board.treasuryKeyHash.toLowerCase()) {
      throw new BadRequestException('the signature is not from your registered treasury key');
    }

    await this.prisma.multisigSignature.upsert({
      where: { actionId_boardDrepId: { actionId, boardDrepId: board.drepId } },
      update: { witnessCbor: vkey },
      create: { actionId, boardDrepId: board.drepId, witnessCbor: vkey },
    });

    const sigs = await this.prisma.multisigSignature.findMany({ where: { actionId } });
    if (sigs.length < REQUIRED) {
      return { approvals: sigs.length, threshold: REQUIRED, status: 'PENDING_SIGS' as const };
    }
    return this.assembleAndBroadcast(actionId);
  }

  /** Merge the collected witnesses + native script and submit to the chain. */
  private async assembleAndBroadcast(actionId: string) {
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId }, include: { signatures: true } });
    if (!action?.txCbor) throw new BadRequestException('no built tx to assemble');
    const policy = await this.confirmedPolicyOrThrow();
    const script = CSL.NativeScript.from_hex(policy.scriptCbor);
    const assembled = assembleMultisigTx({
      unsignedTxHex: action.txCbor,
      vkeyWitnessHexes: action.signatures.map((s) => s.witnessCbor),
      script,
    });
    if (assembled.signerCount < REQUIRED) {
      throw new ConflictException(`only ${assembled.signerCount} valid signatures — need ${REQUIRED}`);
    }

    // Submit, degrading gracefully (like AnchorService): if the chain submit fails
    // the witnesses are kept and the action stays READY for a retry.
    try {
      await this.submitTxHex(assembled.signedTxHex);
      await this.prisma.multisigAction.update({ where: { id: actionId }, data: { status: 'BROADCASTED', txHash: assembled.txHash } });
      this.logger.log(`treasury multisig broadcast: ${assembled.txHash}`);
      return { approvals: assembled.signerCount, threshold: REQUIRED, status: 'BROADCASTED' as const, txHash: assembled.txHash };
    } catch (e) {
      await this.prisma.multisigAction.update({ where: { id: actionId }, data: { status: 'READY', txHash: assembled.txHash } });
      this.logger.warn(`multisig assembled but submit failed (left READY): ${e instanceof Error ? e.message : e}`);
      return { approvals: assembled.signerCount, threshold: REQUIRED, status: 'READY' as const, txHash: assembled.txHash };
    }
  }

  /** Board-triggered retry of the on-chain submit for an action that reached READY. */
  async retryBroadcast(userId: string, actionId: string) {
    if (!(await this.boardUser(userId))) throw new ForbiddenException('board members only');
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException('action not found');
    if (action.status !== 'READY') throw new ConflictException(`action is ${action.status}, not READY to broadcast`);
    return this.assembleAndBroadcast(actionId);
  }

  // ---- helpers ------------------------------------------------------------

  private async resolveRecipient(action: { recipient: string | null; kind: string; description: string | null }): Promise<string> {
    if (action.recipient) return action.recipient;
    // A hot-wallet top-up pays the anchor hot wallet (the only well-known internal sink).
    if (action.kind === 'OPS') {
      const hot = this.anchor.hotWalletAddress();
      if (hot) return hot;
    }
    throw new BadRequestException('this action has no recipient address set');
  }

  private async activePolicy() {
    return (
      (await this.prisma.treasuryPolicy.findFirst({ where: { status: 'CONFIRMED' }, orderBy: { confirmedAt: 'desc' } })) ??
      (await this.prisma.treasuryPolicy.findFirst({ orderBy: { createdAt: 'desc' } }))
    );
  }

  private async confirmedPolicyOrThrow() {
    const p = await this.prisma.treasuryPolicy.findFirst({ where: { status: 'CONFIRMED' }, orderBy: { confirmedAt: 'desc' } });
    if (!p) throw new BadRequestException('no confirmed treasury policy — assemble + confirm the 3-of-5 script first');
    return p;
  }

  /** The user's seated-board Drep (id + userId + registered treasury key), or null. */
  private async boardUser(userId: string) {
    const d = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { id: true, drepKeyHash: true, treasuryKeyHash: true } } },
    });
    if (!d?.user.drepKeyHash) return null;
    const seat = await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: d.user.drepKeyHash } });
    return seat ? { drepId: d.id, userId: d.user.id, treasuryKeyHash: d.user.treasuryKeyHash } : null;
  }

  private async addressUtxos(address: string): Promise<MultisigUtxo[]> {
    return this.koiosPost<MultisigUtxo[]>('/address_utxos', { _addresses: [address] });
  }
  private async epochParams(): Promise<EpochParams> {
    return (await this.koiosGet<EpochParams[]>('/epoch_params'))[0];
  }
  private async submitTxHex(hex: string): Promise<void> {
    const res = await fetch(`${this.base}/submittx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor' },
      body: Buffer.from(hex, 'hex'),
    });
    if (!res.ok) throw new Error(`submittx ${res.status}: ${await res.text()}`);
  }
  private async koiosGet<T>(p: string): Promise<T> {
    const r = await fetch(`${this.base}${p}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`koios ${p}: ${r.status}`);
    return (await r.json()) as T;
  }
  private async koiosPost<T>(p: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`koios ${p}: ${r.status}`);
    return (await r.json()) as T;
  }
}
