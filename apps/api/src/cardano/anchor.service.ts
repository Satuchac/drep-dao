import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bip39 from 'bip39';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import {
  GOVERNANCE_METADATA_LABEL,
  GovSubject,
  VotingStyle,
  buildResultMetadata,
  buildSubmissionMetadata,
  type AnchorResultMetadata,
  type AnchorSubmissionMetadata,
  type GovVoteEvent,
} from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from './cardano-query.service';

const harden = (n: number): number => n + 0x80000000;
const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

export interface AnchorResult {
  hash: string;
  txHash: string | null;
  submitted: boolean;
}

interface Utxo {
  tx_hash: string;
  tx_index: number;
  value: string;
}

/**
 * §18 anchor hot wallet. Posts ONE Cardano tx per voting decision that commits
 * (by hash) to the full set of signed votes + the tally, so anyone can re-verify
 * — without a fee/tx per vote. If ANCHOR_MNEMONIC is unset it still records the
 * computed anchor (txHash null) so the app degrades gracefully.
 */
@Injectable()
export class AnchorService implements OnModuleInit {
  private readonly logger = new Logger(AnchorService.name);
  private readonly base: string;
  private readonly networkId: number;
  private mnemonic?: string; // mutable: an in-platform SEED rotation (admin) replaces it
  private readonly treasuryAddress?: string;

  /** On boot, prefer a DB-stored (rotated) anchor seed over the env default. */
  async onModuleInit() {
    const row = await this.prisma.platformSecret.findUnique({ where: { key: 'ANCHOR_MNEMONIC' } });
    if (row?.value) {
      this.mnemonic = row.value;
      this.logger.log('anchor hot-wallet seed loaded from platform_secret (rotated)');
    }
  }

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
  ) {
    const net = config.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    this.networkId = net === 'Mainnet' ? 1 : 0;
    this.base =
      net === 'Mainnet'
        ? 'https://api.koios.rest/api/v1'
        : net === 'Preview'
          ? 'https://preview.koios.rest/api/v1'
          : 'https://preprod.koios.rest/api/v1';
    this.mnemonic = config.get<string>('ANCHOR_MNEMONIC') || undefined;
    this.treasuryAddress = config.get<string>('TREASURY_ADDRESS') || undefined;
  }

  /** Bech32 address of the configured anchor hot wallet (or null if unset). */
  hotWalletAddress(): string | null {
    return this.mnemonic ? this.anchorKeys(this.mnemonic).addr.to_bech32() : null;
  }

  /**
   * Board view of the platform's on-chain wallets: the low-balance anchor HOT
   * wallet (pays tx fees) and the TREASURY (3-of-5 multisig) that tops it up.
   * The hot wallet's signing key is an operator secret (env/KMS), never exposed
   * here — the board sees the address + balance for oversight.
   */
  async walletStatus() {
    const hot = this.hotWalletAddress();
    const envTreasury = this.treasuryAddress ?? null;
    // §15.3 — the actual on-chain treasury is the assembled multisig once
    // it exists. The env TREASURY_ADDRESS is a legacy fallback used only
    // while no multisig has been built (fresh install / after reset).
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
      select: { bech32Address: true, threshold: true, totalKeys: true },
    });
    const activeMultisigAddress = active?.bech32Address ?? null;
    const addrs = [hot, envTreasury, activeMultisigAddress].filter((a): a is string => !!a);
    const bal = await this.cardano.addressBalance(addrs);
    const ada = (a: string | null) => (a ? Number(bal.get(a) ?? 0n) / 1_000_000 : 0);
    return {
      hotWallet: { address: hot, balanceAda: ada(hot), configured: !!this.mnemonic },
      treasury: { address: envTreasury, balanceAda: ada(envTreasury), configured: !!envTreasury },
      activeMultisig: active
        ? {
            address: active.bech32Address,
            balanceAda: ada(active.bech32Address),
            threshold: active.threshold,
            totalKeys: active.totalKeys,
          }
        : null,
    };
  }

  /**
   * §18/§23 (admin) — sweep ALL hot-wallet funds to the treasury (multisig). Must be
   * done before rotating the seed so nothing is stranded on the old key.
   */
  async sweepToMultisig(): Promise<{ txHash: string; to: string }> {
    if (!this.mnemonic) throw new BadRequestException('no anchor hot wallet is configured');
    if (!this.treasuryAddress) throw new BadRequestException('no treasury (multisig) address is configured');
    const { prv, addr } = this.anchorKeys(this.mnemonic);
    const utxos = await this.koiosPost<{ tx_hash: string; tx_index: number; value: string }[]>('/address_utxos', {
      _addresses: [addr.to_bech32()],
    });
    if (!utxos.length) throw new BadRequestException('the hot wallet is already empty');

    const pp = (await this.koiosGet<Record<string, string | number>[]>('/epoch_params'))[0];
    const txb = CSL.TransactionBuilder.new(this.builderCfg(pp));
    const unspent = CSL.TransactionUnspentOutputs.new();
    for (const u of utxos) {
      unspent.add(
        CSL.TransactionUnspentOutput.new(
          CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index)),
          CSL.TransactionOutput.new(addr, CSL.Value.new(CSL.BigNum.from_str(String(u.value)))),
        ),
      );
    }
    txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
    txb.add_change_if_needed(CSL.Address.from_bech32(this.treasuryAddress)); // everything (minus fee) → treasury
    const fixed = CSL.FixedTransaction.from_hex(txb.build_tx().to_hex());
    fixed.sign_and_add_vkey_signature(prv);
    const txHash = fixed.transaction_hash().to_hex();
    const res = await fetch(`${this.base}/submittx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor' },
      body: Buffer.from(fixed.to_hex(), 'hex'),
    });
    if (!res.ok) throw new Error(`submittx ${res.status}: ${await res.text()}`);
    this.logger.warn(`hot wallet swept to treasury: ${txHash}`);
    return { txHash, to: this.treasuryAddress };
  }

  /**
   * §18/§23 (admin) — rotate the anchor hot-wallet SEED. Only allowed once the hot
   * wallet is (near) empty, so no funds are lost. The platform generates + stores a
   * fresh seed (never revealed); the new address is funded afresh from the treasury.
   * SECURITY: the seed now lives in platform_secret — gate behind admin auth + audit;
   * prod should hold it in a KMS rather than the DB.
   */
  async rotateSeed(adminId?: string | null): Promise<{ address: string | null }> {
    if (!this.treasuryAddress) throw new BadRequestException('configure the treasury (multisig) address first');
    const status = await this.walletStatus();
    if (status.hotWallet.balanceAda > 2) {
      throw new BadRequestException('move the hot-wallet funds to the multisig (sweep) before exchanging the seed');
    }
    const fresh = bip39.generateMnemonic(256); // 24-word
    await this.prisma.platformSecret.upsert({
      where: { key: 'ANCHOR_MNEMONIC' },
      update: { value: fresh, updatedBy: adminId ?? null },
      create: { key: 'ANCHOR_MNEMONIC', value: fresh, updatedBy: adminId ?? null },
    });
    this.mnemonic = fresh;
    this.logger.warn('anchor hot-wallet SEED rotated (admin)');
    return { address: this.hotWalletAddress() };
  }

  private builderCfg(pp: Record<string, string | number>) {
    return CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(pp.min_fee_a)), CSL.BigNum.from_str(String(pp.min_fee_b))))
      .pool_deposit(CSL.BigNum.from_str(String(pp.pool_deposit)))
      .key_deposit(CSL.BigNum.from_str(String(pp.key_deposit)))
      .max_value_size(Number(pp.max_val_size))
      .max_tx_size(Number(pp.max_tx_size))
      .coins_per_utxo_byte(CSL.BigNum.from_str(String(pp.coins_per_utxo_size)))
      .build();
  }

  /**
   * Commit any voting decision on-chain (admission, filtering, D&V, milestone, …).
   * Posts ONE metadata tx with a self-describing result (title + each voter's
   * choice + tally) and a `proofHash` over the off-chain preimage, and records an
   * Anchor row. Degrades gracefully (txHash null) when ANCHOR_MNEMONIC is unset.
   */
  async anchorResult(params: {
    kind: string; // Anchor.kind: 'admission' | 'filtering' | 'dv' | 'milestone' | 'removal'
    subject: GovSubject;
    style: VotingStyle;
    ref: string; // readable subject reference, shown as "applicant" in the JSON
    proposalId?: string | null; // Anchor.proposalId (proposal row or applicant drep row)
    publicId?: string | null; // structured proposal id (e.g. "R3-P2", "Internal 4") embedded on-chain
    docHash?: string | null; // sha256 of title+content (internal proposals) — date-independent
    electedBoard?: { drep: string; name: string }[] | null; // §14 — set on a board-election anchor
    roundId?: string | null;
    votes: { drep: string; vote: string; power?: number }[];
    outcome: string;
    yes: number;
    no: number;
    threshold: number;
    totalPower?: number; // BAL: total eligible voting power (for the on-chain tally)
    preimageVotes?: unknown; // richer votes (rationale/signature) for the off-chain preimage
  }): Promise<AnchorResult> {
    const preimage = {
      subject: params.subject,
      style: params.style,
      ref: params.ref,
      ...(params.publicId ? { publicId: params.publicId } : {}),
      ...(params.docHash ? { docHash: params.docHash } : {}),
      ...(params.electedBoard?.length ? { electedBoard: params.electedBoard } : {}),
      votes: params.preimageVotes ?? params.votes,
      result: { outcome: params.outcome, yes: params.yes, no: params.no, threshold: params.threshold },
    };
    const hash = sha256hex(JSON.stringify(preimage));

    // §3 — self-describing on-chain JSON: title + the proposal id (if any) + every voter's choice + tally.
    const metadata = buildResultMetadata({
      subject: params.subject,
      style: params.style,
      applicant: params.ref,
      proposalId: params.publicId ?? null,
      docHash: params.docHash ?? null,
      electedBoard: params.electedBoard ?? null,
      votes: params.votes,
      yes: params.yes,
      no: params.no,
      threshold: params.threshold,
      totalPower: params.totalPower,
      outcome: params.outcome,
      proofHash: hash,
    })[GOVERNANCE_METADATA_LABEL];

    let txHash: string | null = null;
    try {
      txHash = await this.submitMetadataTx(metadata);
    } catch (e) {
      this.logger.warn(`anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`);
    }

    await this.prisma.anchor.create({
      data: {
        kind: params.kind,
        proposalId: params.proposalId ?? null,
        roundId: params.roundId ?? null,
        hash,
        preimage: preimage as unknown as object,
        metadataLabel: GOVERNANCE_METADATA_LABEL,
        txHash,
        submittedAt: txHash ? new Date() : null,
      },
    });
    return { hash, txHash, submitted: !!txHash };
  }

  /**
   * §3/§12 — anchor a funding proposal's **acceptance** into a round (fee paid + confirmed,
   * or no fee required). Records the unique proposal id, the submitter (DRep id, or stake
   * address if not a DRep), and the fee facts (paid? amount? which tx paid it).
   */
  async anchorSubmission(params: {
    proposalRowId: string;
    publicId: string;
    roundId?: string | null;
    roundNumber?: number | null;
    submitter: string;
    submitterType: 'DRep' | 'Wallet';
    feeRequired: boolean;
    feePaid: boolean;
    feeAda: number;
    feeTxHash?: string | null;
  }): Promise<AnchorResult> {
    const preimage = {
      subject: GovSubject.SUBMISSION,
      proposalId: params.publicId,
      round: params.roundNumber ?? null,
      submitter: params.submitter,
      submitterType: params.submitterType,
      fee: { required: params.feeRequired, paid: params.feePaid, ada: params.feeAda, txHash: params.feeTxHash ?? null },
      acceptedAt: new Date().toISOString(),
    };
    const hash = sha256hex(JSON.stringify(preimage));
    const metadata = buildSubmissionMetadata({
      proposalId: params.publicId,
      round: params.roundNumber ?? null,
      submitter: params.submitter,
      submitterType: params.submitterType,
      feeRequired: params.feeRequired,
      feePaid: params.feePaid,
      feeAda: params.feeAda,
      feeTxHash: params.feeTxHash ?? null,
      acceptedAt: preimage.acceptedAt,
      proofHash: hash,
    })[GOVERNANCE_METADATA_LABEL];

    let txHash: string | null = null;
    try {
      txHash = await this.submitMetadataTx(metadata);
    } catch (e) {
      this.logger.warn(`submission anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`);
    }
    await this.prisma.anchor.create({
      data: {
        kind: GovSubject.SUBMISSION,
        proposalId: params.proposalRowId,
        roundId: params.roundId ?? null,
        hash,
        preimage: preimage as unknown as object,
        metadataLabel: GOVERNANCE_METADATA_LABEL,
        txHash,
        submittedAt: txHash ? new Date() : null,
      },
    });
    return { hash, txHash, submitted: !!txHash };
  }

  /**
   * §18 (board) — force-submit an anchor that was recorded but never reached the chain
   * (e.g. the hot wallet was unconfigured/offline when the decision was made). Rebuilds
   * the self-describing metadata from the stored preimage (same `proofHash`) and submits
   * one tx. Idempotent: a no-op if it is already on-chain.
   */
  async submitPending(anchorId: string): Promise<AnchorResult> {
    const a = await this.prisma.anchor.findUnique({ where: { id: anchorId } });
    if (!a) throw new NotFoundException('anchor not found');
    if (a.txHash) return { hash: a.hash, txHash: a.txHash, submitted: true };
    if (!this.mnemonic) {
      throw new BadRequestException('no anchor hot wallet is configured — set or rotate the seed first');
    }
    const txHash = await this.submitMetadataTx(this.metadataFromAnchor(a));
    await this.prisma.anchor.update({ where: { id: anchorId }, data: { txHash, submittedAt: new Date() } });
    return { hash: a.hash, txHash, submitted: true };
  }

  /**
   * §18 (board) — submit every anchor that is recorded but not yet on-chain. Each
   * anchor is its own metadata tx, all paid from the same hot wallet. Koios's
   * `/address_utxos` lags the mempool, so we fetch UTxOs ONCE and chain each tx's
   * change output into the next input (otherwise every tx after the first reuses the
   * already-spent UTxO and is rejected — the "1 passed, 8 failed" symptom).
   */
  async submitAllPending(): Promise<{ submitted: number; failed: number; total: number }> {
    const pending = await this.prisma.anchor.findMany({ where: { txHash: null }, orderBy: { createdAt: 'asc' } });
    if (pending.length === 0) return { submitted: 0, failed: 0, total: 0 };
    if (!this.mnemonic) {
      throw new BadRequestException('no anchor hot wallet is configured — set or rotate the seed first');
    }
    const { prv, addr } = this.anchorKeys(this.mnemonic);
    const pp = (await this.koiosGet<Record<string, string | number>[]>('/epoch_params'))[0];
    let utxos = await this.koiosPost<Utxo[]>('/address_utxos', { _addresses: [addr.to_bech32()] });

    let submitted = 0;
    let failed = 0;
    for (let i = 0; i < pending.length; i++) {
      const a = pending[i];
      if (utxos.length === 0) {
        failed++;
        this.logger.warn(`force-submit ${a.id} skipped: anchor wallet has no UTxOs`);
        continue;
      }
      // Build first: a build failure (e.g. a malformed anchor) leaves the UTxO untouched,
      // so we keep chaining for the remaining anchors instead of breaking the whole batch.
      let built: { fixedHex: string; txHash: string; change: Utxo | null };
      try {
        built = this.buildMetadataTx(this.metadataFromAnchor(a), utxos, pp, prv, addr);
      } catch (e) {
        failed++;
        this.logger.warn(`force-submit ${a.id} failed to build: ${e instanceof Error ? e.message : e}`);
        continue; // UTxO not spent — leave `utxos` as-is for the next anchor
      }
      try {
        await this.submitTxHex(built.fixedHex);
        await this.prisma.anchor.update({ where: { id: a.id }, data: { txHash: built.txHash, submittedAt: new Date() } });
        this.logger.log(`anchored on-chain: ${built.txHash}`);
        submitted++;
        // Chain: the next tx spends this tx's change (Koios won't show it yet). Pause so
        // the parent propagates across Koios's load-balanced relays before the child
        // (referencing its still-unconfirmed output) hits a possibly different relay.
        utxos = built.change ? [built.change] : [];
        if (i < pending.length - 1 && utxos.length > 0) await this.sleep(4000);
      } catch (e) {
        failed++;
        this.logger.warn(`force-submit ${a.id} failed to submit: ${e instanceof Error ? e.message : e}`);
        // The input may now be consumed — re-read from Koios for the next attempt.
        utxos = await this.koiosPost<Utxo[]>('/address_utxos', { _addresses: [addr.to_bech32()] }).catch(() => []);
      }
    }
    return { submitted, failed, total: pending.length };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Rebuild the on-chain metadata for an anchor from its stored preimage. */
  private metadataFromAnchor(a: { kind: string; hash: string; preimage: unknown }): AnchorResultMetadata | AnchorSubmissionMetadata {
    const p = (a.preimage ?? {}) as {
      subject?: GovSubject;
      style?: VotingStyle;
      ref?: string;
      publicId?: string;
      docHash?: string;
      electedBoard?: { drep: string; name: string }[];
      votes?: { drep?: string; vote?: string; choice?: string; power?: number; weight?: number }[];
      result?: { outcome?: string; yes?: number; no?: number; threshold?: number; totalPower?: number };
      // submission-anchor preimage fields
      proposalId?: string;
      round?: number | null;
      submitter?: string;
      submitterType?: 'DRep' | 'Wallet';
      fee?: { required?: boolean; paid?: boolean; ada?: number; txHash?: string | null };
    };
    if ((p.subject ?? a.kind) === GovSubject.SUBMISSION) {
      return buildSubmissionMetadata({
        proposalId: p.proposalId ?? '',
        round: p.round ?? null,
        submitter: p.submitter ?? '',
        submitterType: p.submitterType ?? 'Wallet',
        feeRequired: p.fee?.required ?? false,
        feePaid: p.fee?.paid ?? false,
        feeAda: p.fee?.ada ?? 0,
        feeTxHash: p.fee?.txHash ?? null,
        proofHash: a.hash,
      })[GOVERNANCE_METADATA_LABEL];
    }
    const votes = (p.votes ?? []).map((v) => ({
      drep: v.drep ?? '',
      vote: v.vote ?? v.choice ?? '',
      power: v.power ?? v.weight,
    }));
    const r = p.result ?? {};
    return buildResultMetadata({
      subject: (p.subject ?? a.kind) as GovSubject,
      style: (p.style ?? VotingStyle.ONE_PERSON_ONE_VOTE) as VotingStyle,
      applicant: p.ref ?? '',
      proposalId: p.publicId ?? null,
      docHash: p.docHash ?? null,
      electedBoard: p.electedBoard ?? null,
      votes,
      yes: r.yes ?? 0,
      no: r.no ?? 0,
      threshold: r.threshold ?? 0,
      totalPower: r.totalPower,
      outcome: r.outcome ?? '',
      proofHash: a.hash,
    })[GOVERNANCE_METADATA_LABEL];
  }

  /** Admission decision (1P1V). `votes` carry each board member's CIP-30 signature. */
  async anchorAdmissionResult(params: {
    applicantDrepRowId: string;
    applicantDrepId: string;
    votes: (GovVoteEvent & { signature?: string | null; signingKey?: string | null })[];
    outcome: 'ADMITTED' | 'REJECTED';
    yes: number;
    no: number;
    threshold: number;
  }): Promise<AnchorResult> {
    return this.anchorResult({
      kind: 'admission',
      subject: GovSubject.ADMISSION,
      style: VotingStyle.ONE_PERSON_ONE_VOTE,
      ref: params.applicantDrepId,
      proposalId: params.applicantDrepRowId,
      votes: params.votes.map((v) => ({ drep: v.voter, vote: v.choice })),
      preimageVotes: params.votes,
      outcome: params.outcome,
      yes: params.yes,
      no: params.no,
      threshold: params.threshold,
    });
  }

  /** Build + sign + submit a single tx carrying `event` as metadata, from the anchor wallet. */
  private async submitMetadataTx(event: AnchorResultMetadata | AnchorSubmissionMetadata): Promise<string> {
    if (!this.mnemonic) throw new Error('ANCHOR_MNEMONIC not configured (anchor recorded, not submitted)');
    const { prv, addr } = this.anchorKeys(this.mnemonic);
    const pp = (await this.koiosGet<Record<string, string | number>[]>('/epoch_params'))[0];
    const utxos = await this.koiosPost<Utxo[]>('/address_utxos', { _addresses: [addr.to_bech32()] });
    if (!utxos.length) throw new Error('anchor wallet has no UTxOs');
    const built = this.buildMetadataTx(event, utxos, pp, prv, addr);
    await this.submitTxHex(built.fixedHex);
    this.logger.log(`anchored on-chain: ${built.txHash}`);
    return built.txHash;
  }

  /**
   * Build + sign one metadata tx from the given UTxOs. Returns the signed tx hex, its
   * hash, and the change output (so a batch can chain txs without re-querying Koios).
   */
  private buildMetadataTx(
    event: AnchorResultMetadata | AnchorSubmissionMetadata,
    utxos: Utxo[],
    pp: Record<string, string | number>,
    prv: CSL.PrivateKey,
    addr: CSL.Address,
  ): { fixedHex: string; txHash: string; change: Utxo | null } {
    if (!utxos.length) throw new Error('anchor wallet has no UTxOs');
    const txb = CSL.TransactionBuilder.new(this.builderCfg(pp));
    txb.add_json_metadatum_with_schema(
      CSL.BigNum.from_str(String(GOVERNANCE_METADATA_LABEL)),
      JSON.stringify(event),
      CSL.MetadataJsonSchema.NoConversions,
    );
    const unspent = CSL.TransactionUnspentOutputs.new();
    for (const u of utxos) {
      unspent.add(
        CSL.TransactionUnspentOutput.new(
          CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index)),
          CSL.TransactionOutput.new(addr, CSL.Value.new(CSL.BigNum.from_str(String(u.value)))),
        ),
      );
    }
    txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
    txb.add_change_if_needed(addr);

    const built = txb.build_tx();
    const fixed = CSL.FixedTransaction.from_hex(built.to_hex());
    fixed.sign_and_add_vkey_signature(prv);
    const txHash = fixed.transaction_hash().to_hex();

    // The single change output (back to our address) becomes the next chained input.
    const addrBech = addr.to_bech32();
    const outs = built.body().outputs();
    let change: Utxo | null = null;
    for (let i = 0; i < outs.len(); i++) {
      const o = outs.get(i);
      if (o.address().to_bech32() === addrBech) {
        change = { tx_hash: txHash, tx_index: i, value: o.amount().coin().to_str() };
        break;
      }
    }
    return { fixedHex: fixed.to_hex(), txHash, change };
  }

  private async submitTxHex(hex: string): Promise<void> {
    const res = await fetch(`${this.base}/submittx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor' },
      body: Buffer.from(hex, 'hex'),
    });
    if (!res.ok) throw new Error(`submittx ${res.status}: ${await res.text()}`);
  }

  private anchorKeys(mnemonic: string) {
    const root = CSL.Bip32PrivateKey.from_bip39_entropy(
      Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex'),
      Buffer.from(''),
    );
    const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
    const payKey = acct.derive(0).derive(0);
    const pc = CSL.Credential.from_keyhash(payKey.to_public().to_raw_key().hash());
    const sc = CSL.Credential.from_keyhash(acct.derive(2).derive(0).to_public().to_raw_key().hash());
    return { prv: payKey.to_raw_key(), addr: CSL.BaseAddress.new(this.networkId, pc, sc).to_address() };
  }

  private async koiosGet<T>(p: string): Promise<T> {
    const r = await fetch(`${this.base}${p}`);
    if (!r.ok) throw new Error(`koios ${p}: ${r.status}`);
    return (await r.json()) as T;
  }
  private async koiosPost<T>(p: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`koios ${p}: ${r.status}`);
    return (await r.json()) as T;
  }
}
