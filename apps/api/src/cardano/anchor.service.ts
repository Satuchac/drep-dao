import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bip39 from 'bip39';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import {
  GOVERNANCE_METADATA_LABEL,
  GovSubject,
  VotingStyle,
  buildResultMetadata,
  type AnchorResultMetadata,
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

/**
 * §18 anchor hot wallet. Posts ONE Cardano tx per voting decision that commits
 * (by hash) to the full set of signed votes + the tally, so anyone can re-verify
 * — without a fee/tx per vote. If ANCHOR_MNEMONIC is unset it still records the
 * computed anchor (txHash null) so the app degrades gracefully.
 */
@Injectable()
export class AnchorService {
  private readonly logger = new Logger(AnchorService.name);
  private readonly base: string;
  private readonly networkId: number;
  private readonly mnemonic?: string;
  private readonly treasuryAddress?: string;

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
    const treasury = this.treasuryAddress ?? null;
    const addrs = [hot, treasury].filter((a): a is string => !!a);
    const bal = await this.cardano.addressBalance(addrs);
    const ada = (a: string | null) => (a ? Number(bal.get(a) ?? 0n) / 1_000_000 : 0);
    return {
      hotWallet: { address: hot, balanceAda: ada(hot), configured: !!this.mnemonic },
      treasury: { address: treasury, balanceAda: ada(treasury), configured: !!treasury },
    };
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
      votes: params.preimageVotes ?? params.votes,
      result: { outcome: params.outcome, yes: params.yes, no: params.no, threshold: params.threshold },
    };
    const hash = sha256hex(JSON.stringify(preimage));

    // §3 — self-describing on-chain JSON: title + every voter's choice + tally.
    const metadata = buildResultMetadata({
      subject: params.subject,
      style: params.style,
      applicant: params.ref,
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
  private async submitMetadataTx(event: AnchorResultMetadata): Promise<string> {
    if (!this.mnemonic) throw new Error('ANCHOR_MNEMONIC not configured (anchor recorded, not submitted)');
    const { prv, addr } = this.anchorKeys(this.mnemonic);
    const addrBech = addr.to_bech32();

    const pp = (await this.koiosGet<Record<string, string | number>[]>('/epoch_params'))[0];
    const utxos = await this.koiosPost<{ tx_hash: string; tx_index: number; value: string }[]>(
      '/address_utxos',
      { _addresses: [addrBech] },
    );
    if (!utxos.length) throw new Error('anchor wallet has no UTxOs');

    const cfg = CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(pp.min_fee_a)), CSL.BigNum.from_str(String(pp.min_fee_b))))
      .pool_deposit(CSL.BigNum.from_str(String(pp.pool_deposit)))
      .key_deposit(CSL.BigNum.from_str(String(pp.key_deposit)))
      .max_value_size(Number(pp.max_val_size))
      .max_tx_size(Number(pp.max_tx_size))
      .coins_per_utxo_byte(CSL.BigNum.from_str(String(pp.coins_per_utxo_size)))
      .build();
    const txb = CSL.TransactionBuilder.new(cfg);
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

    const fixed = CSL.FixedTransaction.from_hex(txb.build_tx().to_hex());
    fixed.sign_and_add_vkey_signature(prv);
    const txHash = fixed.transaction_hash().to_hex();
    const res = await fetch(`${this.base}/submittx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor' },
      body: Buffer.from(fixed.to_hex(), 'hex'),
    });
    if (!res.ok) throw new Error(`submittx ${res.status}: ${await res.text()}`);
    this.logger.log(`anchored on-chain: ${txHash}`);
    return txHash;
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
