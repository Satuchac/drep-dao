'use client';

import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import { daoApi, type DaoMember, type DaoExpert } from '@/lib/api';

const SUBCAT_LABEL: Record<string, string> = Object.fromEntries(DEFAULT_SUBCATEGORIES.map((s) => [s.id, s.label]));

// Sortable columns of the member table; `num` distinguishes numeric vs text/date sort.
type SortKey = 'displayName' | 'since' | 'votingPowerAda' | 'delegators' | 'basePower' | 'merit' | 'meritMultiplier' | 'adjustedPower';
const COLUMNS: { key: SortKey; label: string; right?: boolean; num?: boolean }[] = [
  { key: 'displayName', label: 'Member' },
  { key: 'since', label: 'Member since' },
  { key: 'votingPowerAda', label: 'Voting power (ADA)', right: true, num: true },
  { key: 'delegators', label: 'Delegators', right: true, num: true },
  { key: 'basePower', label: 'Base (log₁₀)', right: true, num: true },
  { key: 'merit', label: 'Merit', right: true, num: true },
  { key: 'meritMultiplier', label: '×Mult', right: true, num: true },
  { key: 'adjustedPower', label: 'Adjusted power', right: true, num: true },
];

/** On-chain DRep image (CIP-119) if present, else a generic initials avatar. */
function Avatar({ name, image }: { name: string; image: string | null }) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt={name} className="h-7 w-7 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
      {initial}
    </span>
  );
}

/** §4 — all DAO members with balanced voting power: log10(stake) × (1 + merit/200). */
export function DaoOverview() {
  const [members, setMembers] = useState<DaoMember[] | null>(null);
  const [experts, setExperts] = useState<DaoExpert[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Default: highest adjusted power first (matches the prior server order).
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'adjustedPower', dir: 'desc' });

  useEffect(() => {
    daoApi
      .members()
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    daoApi.experts().then(setExperts).catch(() => undefined);
  }, []);

  const sorted = useMemo(() => {
    if (!members) return members;
    const arr = [...members];
    const { key, dir } = sort;
    const f = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (key === 'displayName') return f * (a.displayName ?? '').localeCompare(b.displayName ?? '');
      if (key === 'since') return f * ((a.since ? new Date(a.since).getTime() : 0) - (b.since ? new Date(b.since).getTime() : 0));
      return f * ((a[key] as number) - (b[key] as number));
    });
    return arr;
  }, [members, sort]);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'displayName' || key === 'since' ? 'asc' : 'desc' }));

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">DAO Member overview</h2>
        <p className="text-sm text-neutral-500">
          Adjusted power (§4) = log₁₀(on-chain DRep voting power in ADA) × (1 + merit/200). Voting power is
          ADA delegated to the DRep (CIP-1694 vote delegation — not stake-pool delegation).
        </p>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {!members ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-neutral-500">No DAO members yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={`px-3 py-2 ${c.right ? 'text-right' : ''}`}>
                    <button
                      onClick={() => onSort(c.key)}
                      className={`inline-flex items-center gap-1 uppercase hover:text-neutral-800 dark:hover:text-neutral-200 ${c.right ? 'flex-row-reverse' : ''}`}
                      title="Sort"
                    >
                      {c.label}
                      <span className="text-[10px]">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(sorted ?? []).map((m) => (
                <tr key={m.drepId} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={m.displayName} image={m.image} />
                      <span className="font-medium">{m.displayName}</span>
                      {m.isBoard ? (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          BOARD
                        </span>
                      ) : null}
                      {/* §14.1 — fell below the entry power/delegator minimum, but stays a full voting member. */}
                      {!m.meetsEntryRequirements ? (
                        <span
                          className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          title="Below a configured entry requirement (voting power / qualifying delegators, and/or voting activity). Still a full voting member — this is informational only."
                        >
                          ⚠ below minimum
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                    {m.since ? (
                      <span title={m.isBoard ? 'Installed on the board' : 'Approved by the board'}>
                        {new Date(m.since).toLocaleDateString()}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.votingPowerAda.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.delegators}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.basePower.toFixed(2)}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      m.merit > 0 ? 'text-emerald-600' : m.merit < 0 ? 'text-red-600' : ''
                    }`}
                  >
                    {m.merit > 0 ? '+' : ''}
                    {m.merit}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.meritMultiplier.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{m.adjustedPower.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {members && members.some((m) => m.delegators === 0) ? (
        <p className="text-xs text-neutral-400">
          0 voting power / 0 delegators means no account has delegated its vote to that DRep yet (CIP-1694
          vote delegation, separate from stake-pool delegation).
        </p>
      ) : null}
      {members && members.some((m) => !m.meetsEntryRequirements) ? (
        <p className="text-xs text-amber-600">
          <strong>⚠ below minimum</strong> — this member no longer meets a configured entry requirement (voting
          power / qualifying delegators, and/or recent voting activity). They remain a full voting member; the flag
          is informational. Board members are checked for activity but exempt from the voting-power minimum.
        </p>
      ) : null}

      <div className="pt-2">
        <h3 className="text-base font-semibold">Experts</h3>
        <p className="text-sm text-neutral-500">Non-DRep ADA holders approved by the board for milestone review.</p>
        {experts.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">No approved experts yet.</p>
        ) : (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {experts.map((x) => (
              <li
                key={x.id}
                className="rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/20"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{x.displayName}</span>
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">Expert</span>
                </div>
                {x.bio ? <div className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">{x.bio}</div> : null}
                {x.subcategoryIds.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {x.subcategoryIds.map((id) => (
                      <span key={id} className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                        {SUBCAT_LABEL[id] ?? id}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-0.5 text-xs text-neutral-400">no expertise areas listed</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
