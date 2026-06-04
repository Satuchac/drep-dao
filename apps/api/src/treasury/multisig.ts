/**
 * §15 — native-script (3-of-5) treasury multisig: the cryptographic core that
 * turns a board quorum into a real on-chain spend. Pure, dependency-injected
 * helpers (CSL only) so they're unit-testable offline with deterministic keys
 * (see `tools/test-multisig.cjs`) and reusable by `TreasuryService`.
 *
 * The board holds the keys in their own wallets; the platform only assembles the
 * `atLeast N` native script, derives the treasury address, builds the unsigned
 * spend tx, and merges the wallet-produced vkey witnesses. No treasury key ever
 * touches the server (mirrors the hot-wallet rule in `ANCHOR-WALLET.md`).
 */
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';

export interface MultisigUtxo {
  tx_hash: string;
  tx_index: number;
  value: string; // lovelace, as a decimal string (Koios `/address_utxos`)
}

/** Protocol params shape we read from Koios `/epoch_params` (same as AnchorService). */
export type EpochParams = Record<string, string | number>;

const lc = (h: string) => h.trim().toLowerCase();

/**
 * Build the board's `atLeast N of [keyHashes]` native script. The key hashes are
 * the board members' **payment** key hashes (28-byte hex) — the credential their
 * wallet signs a spend with, NOT their DRep/stake key. Order-independent: callers
 * sort so the script (and thus the treasury address) is deterministic.
 */
export function buildBoardNativeScript(paymentKeyHashesHex: string[], required: number): CSL.NativeScript {
  const hashes = [...new Set(paymentKeyHashesHex.map(lc))].sort();
  if (hashes.length < required) {
    throw new Error(`need at least ${required} board key hashes, got ${hashes.length}`);
  }
  if (!(required >= 1)) throw new Error('required must be >= 1');
  const scripts = CSL.NativeScripts.new();
  for (const h of hashes) {
    scripts.add(CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(CSL.Ed25519KeyHash.from_hex(h))));
  }
  return CSL.NativeScript.new_script_n_of_k(CSL.ScriptNOfK.new(required, scripts));
}

/** Script hash (policy id) hex of a native script — stable id for the policy. */
export function scriptHashHex(script: CSL.NativeScript): string {
  return script.hash().to_hex();
}

/**
 * Treasury address (bech32) for a native script: an **enterprise** address whose
 * payment credential is the script hash. Enterprise (no stake part) keeps the
 * address a pure function of the board policy — anyone can re-derive + verify it.
 */
export function treasuryAddressFromScript(script: CSL.NativeScript, networkId: number): string {
  const cred = CSL.Credential.from_scripthash(script.hash());
  return CSL.EnterpriseAddress.new(networkId, cred).to_address().to_bech32();
}

function builderCfg(pp: EpochParams) {
  return CSL.TransactionBuilderConfigBuilder.new()
    .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(pp.min_fee_a)), CSL.BigNum.from_str(String(pp.min_fee_b))))
    .pool_deposit(CSL.BigNum.from_str(String(pp.pool_deposit)))
    .key_deposit(CSL.BigNum.from_str(String(pp.key_deposit)))
    .max_value_size(Number(pp.max_val_size))
    .max_tx_size(Number(pp.max_tx_size))
    .coins_per_utxo_byte(CSL.BigNum.from_str(String(pp.coins_per_utxo_size)))
    .build();
}

export interface UnsignedSpend {
  /** Unsigned tx hex (empty witness set) — what each board wallet signs via signTx. */
  txHex: string;
  /** Transaction id (body hash) hex — stable across the partial signatures. */
  txHash: string;
}

/**
 * Build the unsigned native-multisig spend: pay `amountLovelace` from the treasury
 * script address to `recipient`, change back to the treasury. Inputs are spent as
 * native-script inputs (so the script's required signers are recorded); the script
 * itself is attached at assembly time. The tx is left **unsigned** — the 3-of-5
 * vkey witnesses come from the board's wallets.
 */
export function buildMultisigSpendTx(args: {
  script: CSL.NativeScript;
  treasuryAddressBech32: string;
  recipientBech32: string;
  amountLovelace: bigint;
  utxos: MultisigUtxo[];
  pp: EpochParams;
}): UnsignedSpend {
  const { script, treasuryAddressBech32, recipientBech32, amountLovelace, utxos, pp } = args;
  if (!utxos.length) throw new Error('treasury has no UTxOs to spend');
  const treasury = CSL.Address.from_bech32(treasuryAddressBech32);
  const txb = CSL.TransactionBuilder.new(builderCfg(pp));

  // Spend each treasury UTxO as a native-script input (records the script's signers).
  for (const u of utxos) {
    txb.add_native_script_input(
      script,
      CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index)),
      CSL.Value.new(CSL.BigNum.from_str(String(u.value))),
    );
  }

  // The payment output to the recipient.
  txb.add_output(
    CSL.TransactionOutput.new(
      CSL.Address.from_bech32(recipientBech32),
      CSL.Value.new(CSL.BigNum.from_str(amountLovelace.toString())),
    ),
  );

  // Change (minus fee) returns to the treasury script address.
  txb.add_change_if_needed(treasury);

  const tx = txb.build_tx();
  const fixed = CSL.FixedTransaction.from_hex(tx.to_hex());
  return { txHex: tx.to_hex(), txHash: fixed.transaction_hash().to_hex() };
}

/**
 * Extract the single vkey witness (hex) a CIP-30 wallet returns from
 * `signTx(txHex, true)`. The wallet hands back a `TransactionWitnessSet`; for a
 * multisig partial-sign it carries exactly the signer's own vkey witness. We pull
 * the first vkey out so it can be merged with the other board members' witnesses.
 */
export function vkeyWitnessFromWalletWitnessSet(witnessSetHex: string): string {
  const ws = CSL.TransactionWitnessSet.from_hex(witnessSetHex);
  const vkeys = ws.vkeys();
  if (!vkeys || vkeys.len() === 0) throw new Error('wallet witness set carries no vkey witness');
  return vkeys.get(0).to_hex();
}

/** The board payment-key-hash (hex) a vkey witness was signed by — for board-membership checks. */
export function keyHashOfVkeyWitness(vkeyWitnessHex: string): string {
  const w = CSL.Vkeywitness.from_hex(vkeyWitnessHex);
  return w.vkey().public_key().hash().to_hex();
}

/**
 * True if `vkeyWitnessHex` is a valid signature over `txHash` (32-byte tx-body
 * hash hex) by its embedded public key. Lets the server reject a witness that
 * doesn't actually sign this exact transaction before counting it toward quorum.
 */
export function vkeyWitnessSignsTx(vkeyWitnessHex: string, txHashHex: string): boolean {
  try {
    const w = CSL.Vkeywitness.from_hex(vkeyWitnessHex);
    const pub = w.vkey().public_key();
    return pub.verify(Buffer.from(txHashHex, 'hex'), w.signature());
  } catch {
    return false;
  }
}

/**
 * Assemble the final signed multisig tx: the unsigned body + the collected vkey
 * witnesses + the native script. `requireDistinct` (default true) drops duplicate
 * signers so a member can't be double-counted.
 */
export function assembleMultisigTx(args: {
  unsignedTxHex: string;
  vkeyWitnessHexes: string[];
  script: CSL.NativeScript;
}): { signedTxHex: string; txHash: string; signerCount: number } {
  const { unsignedTxHex, vkeyWitnessHexes, script } = args;
  const tx = CSL.Transaction.from_hex(unsignedTxHex);

  const vkeys = CSL.Vkeywitnesses.new();
  const seen = new Set<string>();
  for (const hex of vkeyWitnessHexes) {
    const w = CSL.Vkeywitness.from_hex(hex);
    const kh = w.vkey().public_key().hash().to_hex();
    if (seen.has(kh)) continue;
    seen.add(kh);
    vkeys.add(w);
  }

  const ws = tx.witness_set();
  ws.set_vkeys(vkeys);
  const scripts = CSL.NativeScripts.new();
  scripts.add(script);
  ws.set_native_scripts(scripts);

  const aux = tx.auxiliary_data();
  const signed = aux ? CSL.Transaction.new(tx.body(), ws, aux) : CSL.Transaction.new(tx.body(), ws);
  const fixed = CSL.FixedTransaction.from_hex(signed.to_hex());
  return { signedTxHex: signed.to_hex(), txHash: fixed.transaction_hash().to_hex(), signerCount: vkeys.len() };
}
