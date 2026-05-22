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
