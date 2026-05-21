'use client';

import { stakeAddressFromHex } from '@drep-dao/cardano';

/** Minimal CIP-30 typings — just what wallet login needs. */
export interface Cip30Api {
  getRewardAddresses(): Promise<string[]>; // hex reward addresses
  getNetworkId(): Promise<number>;
  signData(addressHex: string, payloadHex: string): Promise<{ signature: string; key: string }>;
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

/** Resolve the bech32 stake address only (used to request the nonce first). */
export async function getStakeAddress(entry: Cip30WalletEntry): Promise<{ api: Cip30Api; stakeHex: string; stakeAddress: string }> {
  const api = await entry.enable();
  const rewardAddrs = await api.getRewardAddresses();
  const stakeHex = rewardAddrs[0];
  if (!stakeHex) throw new Error('Wallet returned no reward (stake) address.');
  return { api, stakeHex, stakeAddress: stakeAddressFromHex(stakeHex) };
}

export { utf8ToHex };
