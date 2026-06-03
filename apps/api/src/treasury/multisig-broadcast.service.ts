import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { PrismaService } from '../prisma/prisma.service';

const LOVELACE = 1_000_000;

/**
 * §15 — real native-script multisig broadcast — 1-phase, N-of-N.
 *
 * Cardano's CIP-30 + native-script combination doesn't allow a true M-of-N
 * flow without an out-of-band commit step picking the M signers BEFORE
 * building the tx. So we use N-of-N: every board member must sign every
 * action. Fault tolerance comes from re-electing a smaller board (not from
 * the script).
 *
 * Per action:
 *   1. prepareTxBody(actionId) — fetch UTxOs at the source script address,
 *      build an unsigned Cardano tx body via CSL with
 *      `required_signers = all N script keys`, cache the full Transaction
 *      hex on the action so every signer signs the SAME bytes.
 *   2. submitWitness(actionId, witnessHex, userId) — board member's wallet
 *      called `api.signTx(txBodyHex, partialSign=true)` and returned a
 *      TransactionWitnessSet. We verify the embedded vkey hash is in the
 *      action's native script (so a non-board signer can't poison the set),
 *      store it as a MultisigSignature. When all N witnesses are collected:
 *   3. combineAndSubmit(actionId) — merge every vkey witness + the native
 *      script into one TransactionWitnessSet, wrap the cached tx body,
 *      submit via Koios `/submittx`, stamp the action CONFIRMED + tx hash.
 *
 * Source script is determined by action kind:
 *   • OPS / PROJECT_FUNDING / REWARD_PAYOUT / BOARD_TRANSFER → active multisig.
 *   • MIGRATION → the OLD multisig (action.fromConfigId), signed by the
 *     keyholders of THAT script (typically the previous board).
 */
@Injectable()
export class MultisigBroadcastService {
  private readonly logger = new Logger(MultisigBroadcastService.name);
  private readonly networkId: number;
  private readonly base: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const net = (this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod').trim();
    this.networkId = net === 'Mainnet' ? 1 : 0;
    this.base = this.config.get<string>('KOIOS_URL')
      ?? (net === 'Mainnet' ? 'https://api.koios.rest/api/v1' : 'https://preprod.koios.rest/api/v1');
  }

  /** Returns the cached / freshly-built unsigned tx body hex for an action,
   *  plus the source script address (so the UI can say "signing as wallet X
   *  for multisig Y"). Idempotent: subsequent calls return the cached body. */
  async prepareTxBody(actionId: string) {
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException('action not found');
    if (action.status === 'CONFIRMED') throw new ConflictException('action already broadcast');
    const source = await this.resolveSource(action);
    if (action.txCbor) {
      return {
        txBodyHex: action.txCbor,
        sourceAddress: source.bech32Address,
        scriptHash: source.scriptHash,
        keyHashes: source.keyHashes,
      };
    }
    if (!action.destAddress) throw new ConflictException('action has no destination address');
    if (!action.amountAda) throw new ConflictException('action has no amount');

    const utxos = await this.koiosPost<{ tx_hash: string; tx_index: number; value: string }[]>(
      '/address_utxos', { _addresses: [source.bech32Address] },
    );
    if (!utxos.length) {
      throw new ConflictException(`source multisig has no on-chain UTxOs (${source.bech32Address})`);
    }

    const pp = (await this.koiosGet<Record<string, string | number>[]>('/epoch_params'))[0];
    const txb = CSL.TransactionBuilder.new(this.builderCfg(pp));
    const srcAddr = CSL.Address.from_bech32(source.bech32Address);

    // Build the native script that locks the source UTxOs: N-of-N (every key
    // must sign). Attach it with every input so the builder sizes the
    // witness set + fee correctly.
    const nativeScript = this.buildNativeScript(source.keyHashes);

    let totalIn = 0n;
    for (const u of utxos) {
      const input = CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index));
      const value = CSL.Value.new(CSL.BigNum.from_str(String(u.value)));
      txb.add_native_script_input(nativeScript, input, value);
      totalIn += BigInt(u.value);
    }

    const destAddr = CSL.Address.from_bech32(action.destAddress);
    if (action.kind === 'MIGRATION') {
      // Drain: route change to dest, no explicit output (change = full balance minus fee).
      txb.add_change_if_needed(destAddr);
    } else {
      txb.add_output(CSL.TransactionOutput.new(destAddr, CSL.Value.new(CSL.BigNum.from_str(String(action.amountAda)))));
      txb.add_change_if_needed(srcAddr);
    }
    // required_signers = ALL N script keyhashes. This is what makes wallets
    // pop a sign prompt for the multisig key holders (without it they refuse
    // to sign script-locked txs they don't own), AND keeps the chain rule
    // consistent with the N-of-N native script.
    for (const kh of source.keyHashes) {
      txb.add_required_signer(CSL.Ed25519KeyHash.from_hex(kh));
    }

    const txBody = txb.build();
    void totalIn;
    // CIP-30 signTx expects a full Transaction CBOR (Array), not a raw
    // TransactionBody (Map). Wrap with an empty witness set.
    const emptyWs = CSL.TransactionWitnessSet.new();
    const tx = CSL.Transaction.new(txBody, emptyWs);
    const txHex = Buffer.from(tx.to_bytes()).toString('hex');
    await this.prisma.multisigAction.update({ where: { id: actionId }, data: { txCbor: txHex } });
    return {
      txBodyHex: txHex,
      sourceAddress: source.bech32Address,
      scriptHash: source.scriptHash,
      keyHashes: source.keyHashes,
    };
  }

  /** Accept one board member's vkey witness. Verifies the vkey's hash is in
   *  the action's source script so a random signature can't pollute the set.
   *  When all N witnesses are collected, broadcasts. */
  async submitWitness(actionId: string, witnessHex: string, userId: string): Promise<{ status: string; approvals: number; threshold: number; txHash?: string | null; stored?: number }> {
    const action = await this.prisma.multisigAction.findUnique({
      where: { id: actionId },
      include: { signatures: true },
    });
    if (!action) throw new NotFoundException('action not found');
    const source = await this.resolveSource(action);
    const threshold = source.keyHashes.length; // N-of-N
    if (action.status === 'CONFIRMED') {
      return { status: 'CONFIRMED', txHash: action.txHash, approvals: action.signatures.length, threshold };
    }
    if (!action.txCbor) {
      // Lazily build the tx body if the witness arrived before prepare was called.
      await this.prepareTxBody(actionId);
      return this.submitWitness(actionId, witnessHex, userId);
    }
    const scriptKeyHashes = new Set(source.keyHashes.map((k) => k.toLowerCase()));

    let ws: CSL.TransactionWitnessSet;
    try { ws = CSL.TransactionWitnessSet.from_hex(witnessHex); }
    catch { throw new BadRequestException('witness CBOR is not a valid TransactionWitnessSet'); }
    const vkeys = ws.vkeys();
    if (!vkeys || vkeys.len() === 0) {
      throw new BadRequestException('wallet returned no vkey witnesses — switch your wallet to the account that holds your submitted multisig key, then click Sign again.');
    }

    const ourWitnesses: { keyHashHex: string; vkeyWitnessHex: string }[] = [];
    for (let i = 0; i < vkeys.len(); i++) {
      const v = vkeys.get(i);
      const keyHashHex = v.vkey().public_key().hash().to_hex();
      if (!scriptKeyHashes.has(keyHashHex.toLowerCase())) continue;
      ourWitnesses.push({ keyHashHex, vkeyWitnessHex: Buffer.from(v.to_bytes()).toString('hex') });
    }
    if (ourWitnesses.length === 0) {
      throw new BadRequestException('none of the wallet\'s vkey witnesses correspond to a board signing key for this multisig — switch wallet account and try again.');
    }

    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new ForbiddenException('signer has no DRep record — cannot bind witness to identity');
    let stored = 0;
    for (const w of ourWitnesses) {
      try {
        await this.prisma.multisigSignature.upsert({
          where: { actionId_boardDrepId: { actionId, boardDrepId: drep.id } },
          update: { witnessCbor: w.vkeyWitnessHex },
          create: { actionId, boardDrepId: drep.id, witnessCbor: w.vkeyWitnessHex },
        });
        stored++;
      } catch (e) {
        void e;
      }
    }

    const all = await this.prisma.multisigSignature.findMany({ where: { actionId } });
    if (all.length >= threshold) {
      try { return await this.combineAndSubmit(actionId); }
      catch (e) {
        this.logger.warn(`combine+submit failed for ${actionId}: ${e instanceof Error ? e.message : e}`);
        await this.prisma.multisigAction.update({ where: { id: actionId }, data: { status: 'READY' } });
        throw e;
      }
    }
    return { status: 'PENDING_SIGS', approvals: all.length, threshold, stored };
  }

  /** Combine every stored vkey witness with the source script, wrap the
   *  cached tx body, submit via Koios, stamp the action CONFIRMED. */
  private async combineAndSubmit(actionId: string) {
    const action = await this.prisma.multisigAction.findUnique({
      where: { id: actionId },
      include: { signatures: true },
    });
    if (!action) throw new NotFoundException('action not found');
    if (!action.txCbor) throw new ConflictException('tx body not prepared');
    const source = await this.resolveSource(action);
    const threshold = source.keyHashes.length;

    const cachedTx = CSL.Transaction.from_hex(action.txCbor);
    const txBody = cachedTx.body();
    const vkeyWitnesses = CSL.Vkeywitnesses.new();
    const seen = new Set<string>();
    for (const s of action.signatures) {
      try {
        const v = CSL.Vkeywitness.from_hex(s.witnessCbor);
        const kh = v.vkey().public_key().hash().to_hex().toLowerCase();
        if (seen.has(kh)) continue;
        seen.add(kh);
        vkeyWitnesses.add(v);
      } catch (e) {
        this.logger.warn(`skipping un-parseable witness on action ${actionId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (vkeyWitnesses.len() < threshold) {
      throw new ConflictException(`only ${vkeyWitnesses.len()} valid vkey witnesses; need all ${threshold} board members to sign`);
    }

    const witnessSet = CSL.TransactionWitnessSet.new();
    witnessSet.set_vkeys(vkeyWitnesses);
    const nativeScripts = CSL.NativeScripts.new();
    nativeScripts.add(this.buildNativeScript(source.keyHashes));
    witnessSet.set_native_scripts(nativeScripts);

    const tx = CSL.Transaction.new(txBody, witnessSet);
    const fixed = CSL.FixedTransaction.from_hex(Buffer.from(tx.to_bytes()).toString('hex'));
    const txHash = fixed.transaction_hash().to_hex();
    const txHex = fixed.to_hex();

    const res = await fetch(`${this.base}/submittx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor' },
      body: Buffer.from(txHex, 'hex'),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Koios submittx ${res.status}: ${body.slice(0, 400)}`);
    }

    await this.prisma.multisigAction.update({
      where: { id: actionId },
      data: { status: 'CONFIRMED', txHash, paidAt: new Date() },
    });
    this.logger.warn(`multisig action ${actionId} broadcast: ${txHash}`);
    return { status: 'CONFIRMED', txHash, approvals: vkeyWitnesses.len(), threshold };
  }

  /** Resolve which script address + keyhashes the action moves funds OUT of. */
  private async resolveSource(action: { kind: string; fromConfigId: string | null }): Promise<{ bech32Address: string; scriptHash: string; keyHashes: string[]; threshold: number }> {
    if (action.kind === 'MIGRATION' && action.fromConfigId) {
      const c = await this.prisma.multisigConfig.findUnique({ where: { id: action.fromConfigId } });
      if (!c) throw new ConflictException('migration source multisig missing');
      const keyHashes = ((c.scriptJson as { scripts?: { keyHash: string }[] } | null)?.scripts ?? []).map((s) => s.keyHash);
      return { bech32Address: c.bech32Address, scriptHash: c.scriptHash, keyHashes, threshold: c.threshold };
    }
    const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
    if (!active) throw new ConflictException('no active multisig — assemble the board signing keys first');
    const keyHashes = ((active.scriptJson as { scripts?: { keyHash: string }[] } | null)?.scripts ?? []).map((s) => s.keyHash);
    return { bech32Address: active.bech32Address, scriptHash: active.scriptHash, keyHashes, threshold: active.threshold };
  }

  /** N-of-N native script: every key in the multisig must sign. */
  private buildNativeScript(keyHashes: string[]): CSL.NativeScript {
    const scripts = CSL.NativeScripts.new();
    for (const kh of keyHashes) {
      const ed = CSL.Ed25519KeyHash.from_hex(kh);
      scripts.add(CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(ed)));
    }
    return CSL.NativeScript.new_script_all(CSL.ScriptAll.new(scripts));
  }

  private builderCfg(pp: Record<string, string | number>) {
    const num = (k: string) => Number(pp[k]);
    return CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(num('min_fee_a'))), CSL.BigNum.from_str(String(num('min_fee_b')))))
      .pool_deposit(CSL.BigNum.from_str(String(num('pool_deposit'))))
      .key_deposit(CSL.BigNum.from_str(String(num('key_deposit'))))
      .max_value_size(num('max_val_size'))
      .max_tx_size(num('max_tx_size'))
      .coins_per_utxo_byte(CSL.BigNum.from_str(String(num('coins_per_utxo_size'))))
      .build();
  }

  private async koiosPost<T>(p: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`koios ${p}: ${r.status}`);
    return r.json() as Promise<T>;
  }
  private async koiosGet<T>(p: string): Promise<T> {
    const r = await fetch(`${this.base}${p}`);
    if (!r.ok) throw new Error(`koios ${p}: ${r.status}`);
    return r.json() as Promise<T>;
  }
}
