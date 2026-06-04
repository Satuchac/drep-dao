'use client';

import { stakeAddressFromHex, drepIdFromPubKeyHex } from '@drep-dao/cardano';

/** Minimal CIP-30 (+ CIP-95) typings — just what login, DRep apply, and the §15 treasury multisig need. */
export interface Cip30Api {
  getRewardAddresses(): Promise<string[]>; // hex reward addresses
  getUsedAddresses(): Promise<string[]>; // hex payment/base addresses
  getUnusedAddresses?(): Promise<string[]>; // hex payment addresses (fresh wallets)
  getNetworkId(): Promise<number>;
  signData(addressHex: string, payloadHex: string): Promise<{ signature: string; key: string }>;
  /** §15 — partial-sign a tx for the native-script multisig; returns a TransactionWitnessSet hex. */
  signTx(txHex: string, partialSign: boolean): Promise<string>;
  /** CIP-95 — present on Lace/Eternl etc. */
  cip95?: { getPubDRepKey(): Promise<string> };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * §15 — the 28-byte PAYMENT key hash (hex) from a CIP-30 address hex. A Shelley
 * payment address is `[header byte][28-byte payment credential][…]`, so the
 * payment key hash is bytes 1..29 — the credential the wallet signs a spend with
 * (this is what the board registers for the treasury native script).
 */
export function paymentKeyHashFromAddressHex(addressHex: string): string {
  const bytes = hexToBytes(addressHex);
  if (bytes.length < 29) throw new Error('address too short to carry a payment credential');
  let hex = '';
  for (const b of bytes.subarray(1, 29)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** §15 — the board member's treasury PAYMENT key hash, from the connected wallet. */
export async function getPaymentKeyHash(api: Cip30Api): Promise<string> {
  const used = await api.getUsedAddresses();
  const addr = used[0] ?? (api.getUnusedAddresses ? (await api.getUnusedAddresses())[0] : undefined);
  if (!addr) throw new Error('Wallet returned no payment address.');
  return paymentKeyHashFromAddressHex(addr);
}

/** §15 — partial-sign a treasury spend tx; returns the wallet's witness-set hex. Throws if the user cancels. */
export async function signTxWithWallet(api: Cip30Api, txHex: string): Promise<string> {
  return api.signTx(txHex, true);
}

/** Best-effort DRep ID via CIP-95; null if the wallet doesn't support it. */
export async function detectDRepId(api: Cip30Api): Promise<string | null> {
  try {
    const hex = await api.cip95?.getPubDRepKey();
    return hex ? drepIdFromPubKeyHex(hex) : null;
  } catch {
    return null;
  }
}

/** Raw CIP-95 DRep public key hex (for the backend to match board/DRep status). */
export async function getDRepKeyHex(api: Cip30Api): Promise<string | undefined> {
  try {
    return (await api.cip95?.getPubDRepKey()) ?? undefined;
  } catch {
    return undefined;
  }
}

export interface Cip30WalletEntry {
  key: string; // window.cardano key, e.g. "eternl"
  name: string;
  icon: string;
  enable(): Promise<Cip30Api>;
  isEnabled(): Promise<boolean>;
  apiVersion?: string;
}

type CardanoWindow = Window & {
  cardano?: Record<string, Cip30WalletEntry | undefined>;
};

/** Wallet keys exposed by window.cardano that aren't actually CIP-30 wallets. */
const NON_WALLET_KEYS = new Set(['enable', 'isEnabled', 'getApiVersion', 'getName']);

/** Enumerate injected CIP-30 wallets. Browser-only. */
export function listInjectedWallets(): Cip30WalletEntry[] {
  if (typeof window === 'undefined') return [];
  const cardano = (window as CardanoWindow).cardano;
  if (!cardano) return [];
  const out: Cip30WalletEntry[] = [];
  for (const key of Object.keys(cardano)) {
    if (NON_WALLET_KEYS.has(key)) continue;
    const w = cardano[key];
    if (w && typeof w.enable === 'function' && typeof w.name === 'string') {
      out.push({ ...w, key });
    }
  }
  return out;
}

function utf8ToHex(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export interface WalletSignResult {
  stakeAddress: string; // bech32
  signature: string;
  key: string;
}

/**
 * Connect a wallet and sign the given login message with its stake key.
 * Returns the bech32 stake address + CIP-8 data signature for /auth/verify.
 */
export async function connectAndSign(
  entry: Cip30WalletEntry,
  message: string,
): Promise<{ api: Cip30Api; stakeHex: string; stakeAddress: string; sign: () => Promise<WalletSignResult> }> {
  const api = await entry.enable();
  const rewardAddrs = await api.getRewardAddresses();
  const stakeHex = rewardAddrs[0];
  if (!stakeHex) {
    throw new Error('Wallet returned no reward (stake) address. Is a stake key registered?');
  }
  const stakeAddress = stakeAddressFromHex(stakeHex);

  const sign = async (): Promise<WalletSignResult> => {
    const sig = await api.signData(stakeHex, utf8ToHex(message));
    return { stakeAddress, signature: sig.signature, key: sig.key };
  };

  return { api, stakeHex, stakeAddress, sign };
}

/** Sign an arbitrary message with the wallet's stake key (CIP-30 signData) — free, no tx. */
export async function signMessageWithStakeKey(
  api: Cip30Api,
  message: string,
): Promise<{ signature: string; key: string }> {
  const stakeHex = (await api.getRewardAddresses())[0];
  if (!stakeHex) throw new Error('Wallet returned no reward (stake) address.');
  return api.signData(stakeHex, utf8ToHex(message));
}

/** Resolve the bech32 stake address only (used to request the nonce first). */
export async function getStakeAddress(entry: Cip30WalletEntry): Promise<{ api: Cip30Api; stakeHex: string; stakeAddress: string }> {
  const api = await entry.enable();
  const rewardAddrs = await api.getRewardAddresses();
  const stakeHex = rewardAddrs[0];
  if (!stakeHex) throw new Error('Wallet returned no reward (stake) address.');
  return { api, stakeHex, stakeAddress: stakeAddressFromHex(stakeHex) };
}

export { utf8ToHex };
