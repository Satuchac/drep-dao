/**
 * §15 native-script (3-of-5) treasury multisig — OFFLINE crypto/assembly proof.
 *
 * Unlike the other suites this needs no DB, Koios, env, or persona wallets: it
 * derives 5 deterministic ed25519 keys, builds the board `atLeast 3` script +
 * treasury address, builds an unsigned spend, signs with 3 keys, and asserts the
 * assembled tx is valid — and that 2-of-5 is below quorum and a non-board key is
 * rejected. Proves the READY→BROADCASTED core that the wallet signTx flow feeds.
 *
 *   node tools/test-multisig.cjs
 */
const path = require('node:path');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');

const dist = path.join(__dirname, '..', 'apps/api/dist/treasury/multisig.js');
const {
  buildBoardNativeScript,
  scriptHashHex,
  treasuryAddressFromScript,
  buildMultisigSpendTx,
  vkeyWitnessFromWalletWitnessSet,
  keyHashOfVkeyWitness,
  vkeyWitnessSignsTx,
  assembleMultisigTx,
} = require(dist);

let fail = 0;
const ok = (label, cond, detail) => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fail++;
};

const NETWORK = 0; // testnet
// Preprod-like protocol params, so the tx builder runs fully offline.
const PP = {
  min_fee_a: 44,
  min_fee_b: 155381,
  pool_deposit: 500000000,
  key_deposit: 2000000,
  max_val_size: 5000,
  max_tx_size: 16384,
  coins_per_utxo_size: 4310,
};

/** Deterministic ed25519 key from a fixed 32-byte seed (one per board member). */
function keyFromSeed(byte) {
  const prv = CSL.PrivateKey.from_normal_bytes(Buffer.alloc(32, byte));
  return { prv, keyHash: prv.to_public().hash().to_hex() };
}

/** A wallet's signTx(partialSign) result: a TransactionWitnessSet carrying one vkey. */
function walletPartialSign(txHashHex, prv) {
  const w = CSL.make_vkey_witness(CSL.TransactionHash.from_hex(txHashHex), prv);
  const vkeys = CSL.Vkeywitnesses.new();
  vkeys.add(w);
  const ws = CSL.TransactionWitnessSet.new();
  ws.set_vkeys(vkeys);
  return ws.to_hex();
}

console.log('\n████ test-multisig — native-script 3-of-5 treasury (offline) ████');

// 5 board members + 1 outsider (non-board) + a recipient key.
const board = [1, 2, 3, 4, 5].map(keyFromSeed);
const outsider = keyFromSeed(9);
const recipient = CSL.EnterpriseAddress.new(
  NETWORK,
  CSL.Credential.from_keyhash(keyFromSeed(7).prv.to_public().hash()),
).to_address().to_bech32();

// --- Policy: script + treasury address are deterministic & order-independent ---
const hashes = board.map((b) => b.keyHash);
const script = buildBoardNativeScript(hashes, 3);
const addr = treasuryAddressFromScript(script, NETWORK);
const addr2 = treasuryAddressFromScript(buildBoardNativeScript([...hashes].reverse(), 3), NETWORK);
ok('treasury address derives from the 3-of-5 script', /^addr_test1[0-9a-z]+$/.test(addr), addr.slice(0, 24) + '…');
ok('address is order-independent (deterministic policy)', addr === addr2);
ok('script hash is stable', scriptHashHex(script) === scriptHashHex(buildBoardNativeScript([...hashes].reverse(), 3)));

// --- Build the unsigned spend (10k ADA UTxO → pay 1000 ADA, change back) ---
const utxos = [{ tx_hash: 'a'.repeat(64), tx_index: 0, value: '10000000000' }];
const amount = 1000n * 1_000_000n;
const { txHex, txHash } = buildMultisigSpendTx({
  script,
  treasuryAddressBech32: addr,
  recipientBech32: recipient,
  amountLovelace: amount,
  utxos,
  pp: PP,
});
ok('unsigned spend tx builds', typeof txHex === 'string' && /^[0-9a-f]+$/.test(txHash), `tx ${txHash.slice(0, 16)}…`);

// --- 3 board wallets partial-sign; verify each witness over THIS tx ---
const signers = [board[0], board[2], board[4]]; // members #1, #3, #5
const witnesses = signers.map((s) => {
  const wsHex = walletPartialSign(txHash, s.prv); // what CIP-30 signTx returns
  return vkeyWitnessFromWalletWitnessSet(wsHex); // server extracts the vkey witness
});
ok('each witness signs this exact tx', witnesses.every((w) => vkeyWitnessSignsTx(w, txHash)));
ok('witness key hashes are all board members', witnesses.every((w) => hashes.includes(keyHashOfVkeyWitness(w))));
ok('a witness does NOT verify against a different tx hash', !vkeyWitnessSignsTx(witnesses[0], 'b'.repeat(64)));

// --- Non-board key is recognisably not a board member ---
const outsiderW = vkeyWitnessFromWalletWitnessSet(walletPartialSign(txHash, outsider.prv));
ok('an outsider witness is rejected by board-membership check', !hashes.includes(keyHashOfVkeyWitness(outsiderW)));

// --- Assemble final signed tx with 3 witnesses + the native script ---
const assembled = assembleMultisigTx({ unsignedTxHex: txHex, vkeyWitnessHexes: witnesses, script });
ok('3-of-5 assembled tx has 3 distinct signers', assembled.signerCount === 3);
ok('assembled tx hash matches the signed body', assembled.txHash === txHash);
const parsed = CSL.Transaction.from_hex(assembled.signedTxHex);
ok('assembled tx carries the native script witness', !!parsed.witness_set().native_scripts());
ok('assembled tx carries 3 vkey witnesses', parsed.witness_set().vkeys()?.len() === 3);

// --- Duplicate signer is de-duplicated; 2-of-5 is below quorum ---
const dup = assembleMultisigTx({ unsignedTxHex: txHex, vkeyWitnessHexes: [witnesses[0], witnesses[0], witnesses[1]], script });
ok('duplicate signatures are de-duplicated', dup.signerCount === 2);
ok('2-of-5 is below the 3-of-5 quorum', dup.signerCount < 3);

console.log(fail === 0 ? '\n  ✅ all multisig assembly checks passed\n' : `\n  ❌ ${fail} check(s) failed\n`);
process.exit(fail === 0 ? 0 : 1);
