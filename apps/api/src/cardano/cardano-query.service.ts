import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DRepStatus {
  registered: boolean;
  keyHashHex: string | null; // 28-byte DRep credential, from chain
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

  /** For each bech32 drep id: is it a registered on-chain DRep, and its key hash. */
  async verifyDReps(drepIds: string[]): Promise<Map<string, DRepStatus>> {
    const out = new Map<string, DRepStatus>(
      drepIds.map((id) => [id, { registered: false, keyHashHex: null }]),
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
    }[];
    for (const r of rows) {
      if (out.has(r.drep_id)) {
        // §22.4 — a DRep counts as registered only if it exists on-chain AND is
        // active (not retired, not expired). Koios omits unknown ids entirely.
        const registered = r.drep_status === 'registered' && r.active === true;
        out.set(r.drep_id, { registered, keyHashHex: r.hex });
      }
    }
    return out;
  }
}
