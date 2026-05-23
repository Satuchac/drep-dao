import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DRepStatus {
  registered: boolean;
  keyHashHex: string | null; // 28-byte DRep credential, from chain
  amountLovelace: bigint; // on-chain voting power (total delegated stake), 0 if none/unknown
}

/**
 * Read-only on-chain queries via Koios (free, no key). Used to verify that a
 * DRep ID is actually registered on-chain (§22.4) before seating/admitting it.
 */
@Injectable()
export class CardanoQueryService {
  private readonly logger = new Logger(CardanoQueryService.name);
  private readonly base: string;

  constructor(config: ConfigService) {
    const net = config.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    this.base =
      net === 'Mainnet'
        ? 'https://api.koios.rest/api/v1'
        : net === 'Preview'
          ? 'https://preview.koios.rest/api/v1'
          : 'https://preprod.koios.rest/api/v1';
  }

  /** §CIP-119 — on-chain DRep metadata (name + image) per drep id, via Koios. Best-effort. */
  async drepMetadata(drepIds: string[]): Promise<Map<string, { name?: string; image?: string }>> {
    const out = new Map<string, { name?: string; image?: string }>();
    if (drepIds.length === 0) return out;
    try {
      const res = await fetch(`${this.base}/drep_metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _drep_ids: drepIds }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return out;
      const rows = (await res.json()) as { drep_id: string; meta_json: unknown }[];
      for (const r of rows) {
        const body = (r.meta_json as { body?: Record<string, unknown> })?.body;
        if (!body) continue;
        out.set(r.drep_id, { name: cip119Name(body), image: normalizeImageUri(cip119Image(body)) });
      }
    } catch (e) {
      this.logger.warn(`drep_metadata: ${e instanceof Error ? e.message : e}`);
    }
    return out;
  }

  /** Total controlled balance (Lovelace) per payment/base address, via Koios /address_info. */
  async addressBalance(addresses: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>(addresses.map((a) => [a, 0n]));
    if (addresses.length === 0) return out;
    try {
      const res = await fetch(`${this.base}/address_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _addresses: addresses }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return out;
      const rows = (await res.json()) as { address: string; balance: string | null }[];
      for (const r of rows) {
        if (!out.has(r.address)) continue;
        try {
          out.set(r.address, r.balance ? BigInt(r.balance) : 0n);
        } catch {
          /* leave 0 */
        }
      }
    } catch (e) {
      this.logger.warn(`address_info: ${e instanceof Error ? e.message : e}`);
    }
    return out;
  }

  /**
   * Controlled on-chain stake (Lovelace) per stake address, via Koios
   * /account_info `total_balance`. For a self-delegated DRep this equals their
   * voting power, and it's available immediately (no epoch lag). Best-effort:
   * returns 0 for unknown / on any Koios error (used for the dashboard).
   */
  async accountStake(stakeAddresses: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>(stakeAddresses.map((a) => [a, 0n]));
    if (stakeAddresses.length === 0) return out;
    try {
      const res = await fetch(`${this.base}/account_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _stake_addresses: stakeAddresses }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.logger.warn(`Koios /account_info ${res.status}`);
        return out;
      }
      const rows = (await res.json()) as { stake_address: string; total_balance: string | null }[];
      for (const r of rows) {
        if (!out.has(r.stake_address)) continue;
        try {
          out.set(r.stake_address, r.total_balance ? BigInt(r.total_balance) : 0n);
        } catch {
          /* non-numeric — leave 0 */
        }
      }
    } catch (e) {
      this.logger.warn(`Koios account_info unreachable: ${e instanceof Error ? e.message : e}`);
    }
    return out;
  }

  /**
   * §4 — a DRep's on-chain VOTING power (CIP-1694 vote delegation, NOT pool
   * stake): the live sum of the controlled stake of every account that delegated
   * its vote to the DRep, plus the delegator count. Computed live from
   * /drep_delegators + /account_info so it reflects new delegations immediately
   * (drep_info.amount only updates at the epoch boundary). Best-effort → 0.
   */
  async drepVotingPower(
    drepIds: string[],
  ): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number }>> {
    const out = new Map(drepIds.map((id) => [id, { votingPowerLovelace: 0n, delegators: 0 }]));
    if (drepIds.length === 0) return out;

    const addrsByDrep = new Map<string, string[]>();
    const allAddrs = new Set<string>();
    await Promise.all(
      drepIds.map(async (id) => {
        try {
          const res = await fetch(`${this.base}/drep_delegators?_drep_id=${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return;
          const rows = (await res.json()) as { stake_address: string }[];
          const addrs = rows.map((r) => r.stake_address).filter(Boolean);
          addrsByDrep.set(id, addrs);
          addrs.forEach((a) => allAddrs.add(a));
        } catch (e) {
          this.logger.warn(`drep_delegators ${id}: ${e instanceof Error ? e.message : e}`);
        }
      }),
    );

    const stake = await this.accountStake([...allAddrs]);
    for (const id of drepIds) {
      const addrs = addrsByDrep.get(id) ?? [];
      let sum = 0n;
      for (const a of addrs) sum += stake.get(a) ?? 0n;
      out.set(id, { votingPowerLovelace: sum, delegators: addrs.length });
    }
    return out;
  }

  /** For each bech32 drep id: is it a registered on-chain DRep, and its key hash. */
  async verifyDReps(drepIds: string[]): Promise<Map<string, DRepStatus>> {
    const out = new Map<string, DRepStatus>(
      drepIds.map((id) => [id, { registered: false, keyHashHex: null, amountLovelace: 0n }]),
    );
    if (drepIds.length === 0) return out;

    let res: Response;
    try {
      res = await fetch(`${this.base}/drep_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _drep_ids: drepIds }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      // network error / timeout — surface as a clean 503, never an unhandled 500.
      this.logger.warn(`Koios unreachable: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException('on-chain lookup failed (Koios unreachable) — please try again');
    }
    if (!res.ok) {
      // e.g. Koios 500 on a malformed bech32 id. Callers validate id structure
      // first, so this is a transient/provider issue → 503, not a 500.
      this.logger.warn(`Koios /drep_info ${res.status}: ${await res.text().catch(() => '')}`);
      throw new ServiceUnavailableException(`on-chain lookup failed (Koios ${res.status}) — please try again`);
    }
    const rows = (await res.json()) as {
      drep_id: string;
      hex: string | null;
      drep_status: string | null;
      active: boolean | null;
      amount: string | null;
    }[];
    for (const r of rows) {
      if (out.has(r.drep_id)) {
        // §22.4 — a DRep counts as registered only if it exists on-chain AND is
        // active (not retired, not expired). Koios omits unknown ids entirely.
        const registered = r.drep_status === 'registered' && r.active === true;
        let amountLovelace = 0n;
        try {
          amountLovelace = r.amount ? BigInt(r.amount) : 0n;
        } catch {
          /* non-numeric — leave 0 */
        }
        out.set(r.drep_id, { registered, keyHashHex: r.hex, amountLovelace });
      }
    }
    return out;
  }
}

/** CIP-119 fields can be a plain string or a `{ "@value": ... }` object. */
function cip119Str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { '@value'?: unknown })['@value'] === 'string') {
    return (v as { '@value': string })['@value'];
  }
  return undefined;
}
function cip119Name(body: Record<string, unknown>): string | undefined {
  return cip119Str(body.givenName) ?? cip119Str(body.name);
}
function cip119Image(body: Record<string, unknown>): string | undefined {
  const img = body.image;
  if (typeof img === 'string') return img;
  if (img && typeof img === 'object') return cip119Str((img as { contentUrl?: unknown }).contentUrl);
  return undefined;
}
/** Only allow http(s)/ipfs images; map ipfs:// to a public gateway. */
function normalizeImageUri(uri?: string): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice('ipfs://'.length)}`;
  if (uri.startsWith('https://') || uri.startsWith('http://')) return uri;
  return undefined;
}
