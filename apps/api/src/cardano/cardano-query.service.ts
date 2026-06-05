import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drepKeyHashFromId } from '@drep-dao/cardano';

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
  // Short-TTL in-memory cache for the per-DRep voting-power lookups. Without it
  // every page view of the overview re-hits Koios for N DReps + their delegators
  // and hammers the free-tier rate limit (we saw 429s after a heavy test run).
  // Single process, so a plain Map is enough; lost on restart by design.
  private readonly vpCache = new Map<string, { value: { votingPowerLovelace: bigint; delegators: number }; expiresAt: number }>();
  private readonly VP_TTL_MS = 10 * 60 * 1000;
  // Same idea for the on-chain DRep registration check, which runs on EVERY login.
  // A 60s TTL keeps role recognition fresh while collapsing repeated logins of the
  // same DRep into one Koios call (the test suite alone logs in ~10 personas many
  // times — without this it trips the public-tier 429 limit).
  private readonly drepStatusCache = new Map<string, { value: DRepStatus; expiresAt: number }>();
  private readonly DREP_STATUS_TTL_MS = 60 * 1000;

  // Optional direct db-sync source. When DBSYNC_URL is set, the on-chain reads
  // hit our own cardano-db-sync Postgres instead of the public Koios tier — no
  // rate limit, same data. Lazily pooled; falls back to Koios when unset.
  private readonly dbsyncUrl: string | undefined;
  private dbsyncPool: Pool | null = null;

  constructor(config: ConfigService) {
    const net = config.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    this.base =
      net === 'Mainnet'
        ? 'https://api.koios.rest/api/v1'
        : net === 'Preview'
          ? 'https://preview.koios.rest/api/v1'
          : 'https://preprod.koios.rest/api/v1';
    this.dbsyncUrl = config.get<string>('DBSYNC_URL') || undefined;
  }

  private dbsync(): Pool | null {
    if (!this.dbsyncUrl) return null;
    if (!this.dbsyncPool) {
      this.dbsyncPool = new Pool({ connectionString: this.dbsyncUrl, max: 4, statement_timeout: 15000 });
      this.logger.log('on-chain reads via cardano-db-sync (DBSYNC_URL set)');
    }
    return this.dbsyncPool;
  }

  /** §22.4 — DRep registration + active + voting power straight from db-sync,
   *  matched by key hash (db-sync's drep_hash.view is CIP-105, our ids are
   *  CIP-129, so we convert id → key hash). Mirrors Koios /drep_info semantics:
   *  registered = has a live registration cert AND not expired (active_until ≥ tip epoch). */
  private async verifyDRepsViaDbSync(pool: Pool, drepIds: string[]): Promise<Map<string, DRepStatus>> {
    const out = new Map<string, DRepStatus>(
      drepIds.map((id) => [id, { registered: false, keyHashHex: null, amountLovelace: 0n }]),
    );
    const khToId = new Map<string, string>();
    for (const id of drepIds) {
      try { khToId.set(drepKeyHashFromId(id).toLowerCase(), id); } catch { /* malformed id → stays not-registered */ }
    }
    const khs = [...khToId.keys()];
    if (khs.length === 0) return out;
    const { rows } = await pool.query<{ kh: string; registered: boolean; amount: string | null; active_until: string | null; cur: string | null }>(
      `SELECT encode(dh.raw,'hex') AS kh,
              (reg.deposit IS NOT NULL) AS registered,
              COALESCE(dd.amount,0)::text AS amount,
              dd.active_until::text AS active_until,
              (SELECT max(epoch_no) FROM block) AS cur
         FROM drep_hash dh
         LEFT JOIN LATERAL (SELECT deposit FROM drep_registration r
                            WHERE r.drep_hash_id = dh.id ORDER BY r.tx_id DESC, r.cert_index DESC LIMIT 1) reg ON true
         LEFT JOIN LATERAL (SELECT amount, active_until FROM drep_distr d
                            WHERE d.hash_id = dh.id ORDER BY d.epoch_no DESC LIMIT 1) dd ON true
        WHERE encode(dh.raw,'hex') = ANY($1::text[])`,
      [khs],
    );
    for (const r of rows) {
      const id = khToId.get(r.kh.toLowerCase());
      if (!id) continue;
      const active = r.active_until != null && r.cur != null && Number(r.active_until) >= Number(r.cur);
      out.set(id, { registered: !!r.registered && active, keyHashHex: r.kh, amountLovelace: BigInt(r.amount ?? '0') });
    }
    return out;
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

  /**
   * Like addressBalance, but returns NULL when the on-chain lookup actually
   * fails (Koios down / timeout / non-OK) instead of a 0-filled map — so callers
   * can distinguish "Koios unavailable" from "genuinely 0". Used before the
   * platform auto-prepares a hot-wallet top-up, so a transient Koios failure
   * isn't read as "empty wallet" and trigger a spurious top-up.
   */
  async addressBalanceStrict(addresses: string[]): Promise<Map<string, bigint> | null> {
    if (addresses.length === 0) return new Map();
    try {
      const res = await fetch(`${this.base}/address_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _addresses: addresses }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as { address: string; balance: string | null }[];
      const out = new Map<string, bigint>(addresses.map((a) => [a, 0n]));
      for (const r of rows) {
        if (!out.has(r.address)) continue;
        try { out.set(r.address, r.balance ? BigInt(r.balance) : 0n); } catch { /* leave 0 */ }
      }
      return out;
    } catch {
      return null;
    }
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
   * §16 — verify on-chain that `txHash` paid at least `minLovelace` to `toAddress`
   * (the submission-fee address). Sums the tx's outputs to that address via Koios
   * /tx_info. Best-effort: `found=false` if the tx isn't on-chain yet / Koios errors.
   */
  async verifyPayment(
    txHash: string,
    toAddress: string,
    minLovelace: bigint,
  ): Promise<{ found: boolean; paid: boolean; paidLovelace: bigint; koiosAvailable: boolean }> {
    const unavail = { found: false, paid: false, paidLovelace: 0n, koiosAvailable: false };
    const miss = { found: false, paid: false, paidLovelace: 0n, koiosAvailable: true };
    if (!txHash || !toAddress) return miss;
    try {
      const res = await fetch(`${this.base}/tx_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _tx_hashes: [txHash] }),
        signal: AbortSignal.timeout(15000),
      });
      // 429 / 5xx / timeout = we can't tell what's on-chain right now.
      if (!res.ok) return unavail;
      const rows = (await res.json()) as { outputs?: { payment_addr?: { bech32?: string }; value?: string }[] }[];
      const tx = rows[0];
      // Empty rows array = Koios responded fine but the tx really doesn't exist (not unavailable).
      if (!tx) return miss;
      let paid = 0n;
      for (const o of tx.outputs ?? []) {
        if (o.payment_addr?.bech32 === toAddress) {
          try { paid += BigInt(o.value ?? '0'); } catch { /* ignore */ }
        }
      }
      return { found: true, paid: paid >= minLovelace, paidLovelace: paid, koiosAvailable: true };
    } catch (e) {
      this.logger.warn(`tx_info verify: ${e instanceof Error ? e.message : e}`);
      return unavail;
    }
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
    const out = new Map<string, { votingPowerLovelace: bigint; delegators: number }>();
    if (drepIds.length === 0) return out;

    // Serve from cache where we can; only hit Koios for entries that are stale.
    const now = Date.now();
    const miss: string[] = [];
    for (const id of drepIds) {
      const c = this.vpCache.get(id);
      if (c && c.expiresAt > now) out.set(id, c.value);
      else miss.push(id);
    }
    if (miss.length === 0) return out;

    const addrsByDrep = new Map<string, string[]>();
    const allAddrs = new Set<string>();
    let anyKoiosFailure = false;
    await Promise.all(
      miss.map(async (id) => {
        try {
          const res = await fetch(`${this.base}/drep_delegators?_drep_id=${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) { anyKoiosFailure = true; return; }
          const rows = (await res.json()) as { stake_address: string }[];
          const addrs = rows.map((r) => r.stake_address).filter(Boolean);
          addrsByDrep.set(id, addrs);
          addrs.forEach((a) => allAddrs.add(a));
        } catch (e) {
          anyKoiosFailure = true;
          this.logger.warn(`drep_delegators ${id}: ${e instanceof Error ? e.message : e}`);
        }
      }),
    );

    const stake = await this.accountStake([...allAddrs]);
    for (const id of miss) {
      const addrs = addrsByDrep.get(id) ?? [];
      let sum = 0n;
      for (const a of addrs) sum += stake.get(a) ?? 0n;
      const value = { votingPowerLovelace: sum, delegators: addrs.length };
      out.set(id, value);
      // Cache only fully-successful lookups for this DRep — a Koios failure
      // should not bake "0" into the cache and shadow real data when the rate
      // limit recovers.
      if (!anyKoiosFailure || addrsByDrep.has(id)) {
        this.vpCache.set(id, { value, expiresAt: now + this.VP_TTL_MS });
      }
    }
    return out;
  }

  /**
   * §14.1 entry gate (power/delegators): for a DRep, the OWN voting power (stake
   * self-delegated from `ownStakeAddress`) and how many delegators each delegated at
   * least `minDelegatorStakeLovelace`. Best-effort → available=false on any Koios error.
   */
  async drepEntryMetrics(
    drepId: string,
    ownStakeAddress: string,
    minDelegatorStakeLovelace: bigint,
  ): Promise<{ available: boolean; ownVotingPowerLovelace: bigint; delegators: number; qualifyingDelegators: number }> {
    const miss = { available: false, ownVotingPowerLovelace: 0n, delegators: 0, qualifyingDelegators: 0 };
    try {
      const res = await fetch(`${this.base}/drep_delegators?_drep_id=${encodeURIComponent(drepId)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return miss;
      const rows = (await res.json()) as { stake_address: string }[];
      const addrs = rows.map((r) => r.stake_address).filter(Boolean);
      const stake = await this.accountStake(addrs);
      let ownVotingPowerLovelace = 0n;
      let qualifyingDelegators = 0;
      for (const a of addrs) {
        const s = stake.get(a) ?? 0n;
        if (a === ownStakeAddress) ownVotingPowerLovelace = s;
        if (s >= minDelegatorStakeLovelace) qualifyingDelegators++;
      }
      return { available: true, ownVotingPowerLovelace, delegators: addrs.length, qualifyingDelegators };
    } catch (e) {
      this.logger.warn(`drepEntryMetrics ${drepId}: ${e instanceof Error ? e.message : e}`);
      return miss;
    }
  }

  /**
   * §4/§14.1 — batch version for the member overview: per DRep, the total voting power,
   * delegator count, OWN power (self-delegated from `ownStakeAddress`), and how many
   * delegators each delegated ≥ `minDelegatorStakeLovelace`. One /drep_delegators per
   * DRep + a single batched /account_info (same cost as drepVotingPower).
   */
  async drepEntryMetricsBatch(
    entries: { drepId: string; ownStakeAddress?: string }[],
    minDelegatorStakeLovelace: bigint,
  ): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number; ownVotingPowerLovelace: bigint; qualifyingDelegators: number }>> {
    const out = new Map(
      entries.map((e) => [e.drepId, { votingPowerLovelace: 0n, delegators: 0, ownVotingPowerLovelace: 0n, qualifyingDelegators: 0 }]),
    );
    if (entries.length === 0) return out;

    const addrsByDrep = new Map<string, string[]>();
    const allAddrs = new Set<string>();
    await Promise.all(
      entries.map(async (e) => {
        try {
          const res = await fetch(`${this.base}/drep_delegators?_drep_id=${encodeURIComponent(e.drepId)}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return;
          const rows = (await res.json()) as { stake_address: string }[];
          const addrs = rows.map((r) => r.stake_address).filter(Boolean);
          addrsByDrep.set(e.drepId, addrs);
          addrs.forEach((a) => allAddrs.add(a));
        } catch (err) {
          this.logger.warn(`drep_delegators ${e.drepId}: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
    const stake = await this.accountStake([...allAddrs]);
    for (const e of entries) {
      const addrs = addrsByDrep.get(e.drepId) ?? [];
      let total = 0n;
      let own = 0n;
      let qualifying = 0;
      for (const a of addrs) {
        const s = stake.get(a) ?? 0n;
        total += s;
        if (e.ownStakeAddress && a === e.ownStakeAddress) own = s;
        if (s >= minDelegatorStakeLovelace) qualifying++;
      }
      out.set(e.drepId, { votingPowerLovelace: total, delegators: addrs.length, ownVotingPowerLovelace: own, qualifyingDelegators: qualifying });
    }
    return out;
  }

  /**
   * §14.1 entry gate (activity) — batch for the member overview: fetch the recent
   * governance-action window ONCE, then per DRep count how many of those it voted on.
   * Best-effort → a DRep's `available=false` on Koios error (treated as not-met).
   */
  async drepActivityMetricsBatch(
    drepIds: string[],
    windowSize: number,
    onlyWithRationale: boolean,
  ): Promise<Map<string, { available: boolean; votesInWindow: number; windowConsidered: number }>> {
    const out = new Map(drepIds.map((id) => [id, { available: false, votesInWindow: 0, windowConsidered: 0 }]));
    if (drepIds.length === 0) return out;
    let windowIds: Set<string>;
    try {
      const propRes = await fetch(`${this.base}/proposal_list`, { signal: AbortSignal.timeout(15000) });
      if (!propRes.ok) return out;
      const props = ((await propRes.json()) as { proposal_id?: string; block_time?: number }[])
        .filter((p) => p.proposal_id)
        .sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0))
        .slice(0, Math.max(1, windowSize));
      windowIds = new Set(props.map((p) => p.proposal_id!));
    } catch (e) {
      this.logger.warn(`proposal_list: ${e instanceof Error ? e.message : e}`);
      return out;
    }
    await Promise.all(
      drepIds.map(async (id) => {
        try {
          const r = await fetch(`${this.base}/drep_votes?_drep_id=${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!r.ok) return; // leave available=false
          const votes = (await r.json()) as { proposal_id?: string; meta_url?: string | null }[];
          let count = 0;
          for (const v of votes) {
            if (!v.proposal_id || !windowIds.has(v.proposal_id)) continue;
            if (onlyWithRationale && !v.meta_url) continue;
            count++;
          }
          out.set(id, { available: true, votesInWindow: count, windowConsidered: windowIds.size });
        } catch (e) {
          this.logger.warn(`drep_votes ${id}: ${e instanceof Error ? e.message : e}`);
        }
      }),
    );
    return out;
  }

  /**
   * §14.1 entry gate (activity): of the most recent `windowSize` governance actions,
   * how many the DRep voted on (optionally only votes carrying an on-chain rationale).
   * Best-effort → available=false on any Koios error.
   */
  async drepActivityMetrics(
    drepId: string,
    windowSize: number,
    onlyWithRationale: boolean,
  ): Promise<{ available: boolean; votesInWindow: number; windowConsidered: number }> {
    const miss = { available: false, votesInWindow: 0, windowConsidered: 0 };
    try {
      const propRes = await fetch(`${this.base}/proposal_list`, { signal: AbortSignal.timeout(15000) });
      if (!propRes.ok) return miss;
      const props = ((await propRes.json()) as { proposal_id?: string; block_time?: number }[])
        .filter((p) => p.proposal_id)
        .sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0))
        .slice(0, Math.max(1, windowSize));
      const windowIds = new Set(props.map((p) => p.proposal_id));

      const voteRes = await fetch(`${this.base}/drep_votes?_drep_id=${encodeURIComponent(drepId)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!voteRes.ok) return miss;
      const votes = (await voteRes.json()) as { proposal_id?: string; meta_url?: string | null }[];
      let votesInWindow = 0;
      for (const v of votes) {
        if (!v.proposal_id || !windowIds.has(v.proposal_id)) continue;
        if (onlyWithRationale && !v.meta_url) continue;
        votesInWindow++;
      }
      return { available: true, votesInWindow, windowConsidered: windowIds.size };
    } catch (e) {
      this.logger.warn(`drepActivityMetrics ${drepId}: ${e instanceof Error ? e.message : e}`);
      return miss;
    }
  }

  /** For each bech32 drep id: is it a registered on-chain DRep, and its key hash. */
  async verifyDReps(drepIds: string[]): Promise<Map<string, DRepStatus>> {
    const out = new Map<string, DRepStatus>(
      drepIds.map((id) => [id, { registered: false, keyHashHex: null, amountLovelace: 0n }]),
    );
    if (drepIds.length === 0) return out;

    // Serve fresh cache hits; only query Koios for the misses.
    const now = Date.now();
    const misses: string[] = [];
    for (const id of drepIds) {
      const c = this.drepStatusCache.get(id);
      if (c && c.expiresAt > now) out.set(id, c.value);
      else misses.push(id);
    }
    if (misses.length === 0) return out;

    // Prefer our own db-sync when configured — same data, no rate limit.
    const pool = this.dbsync();
    if (pool) {
      try {
        const fromDb = await this.verifyDRepsViaDbSync(pool, misses);
        for (const id of misses) {
          const v = fromDb.get(id)!;
          out.set(id, v);
          this.drepStatusCache.set(id, { value: v, expiresAt: now + this.DREP_STATUS_TTL_MS });
        }
        return out;
      } catch (e) {
        this.logger.warn(`db-sync drep query failed, falling back to Koios: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Koios on the public tier has intermittent "fetch failed" / 5xx blips. This
    // check runs on every login, so retry a few times with backoff before giving
    // up — a transient blip should never deny a board member their role.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`${this.base}/drep_info`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _drep_ids: misses }),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) { res = r; break; }
        this.logger.warn(`Koios /drep_info ${r.status} (attempt ${attempt + 1}/3)`);
      } catch (e) {
        this.logger.warn(`Koios unreachable (attempt ${attempt + 1}/3): ${e instanceof Error ? e.message : e}`);
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    if (!res) {
      // exhausted retries — surface as a clean 503, never an unhandled 500.
      throw new ServiceUnavailableException('on-chain lookup failed (Koios unreachable) — please try again');
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
    // Cache every miss we just resolved — including ids Koios omitted (left at the
    // not-registered default) so we don't re-query unknown DReps each login.
    for (const id of misses) {
      this.drepStatusCache.set(id, { value: out.get(id)!, expiresAt: now + this.DREP_STATUS_TTL_MS });
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
