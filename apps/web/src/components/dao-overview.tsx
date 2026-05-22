'use client';

import { useEffect, useState } from 'react';
import { daoApi, type DaoMember, type DaoExpert } from '@/lib/api';

/** §4 — all DAO members with balanced voting power: log10(stake) × (1 + merit/200). */
export function DaoOverview() {
  const [members, setMembers] = useState<DaoMember[] | null>(null);
  const [experts, setExperts] = useState<DaoExpert[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    daoApi
      .members()
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    daoApi.experts().then(setExperts).catch(() => undefined);
  }, []);

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
                <th className="px-3 py-2">Member</th>
                <th className="px-3 py-2 text-right">Voting power (ADA)</th>
                <th className="px-3 py-2 text-right">Delegators</th>
                <th className="px-3 py-2 text-right">Base (log₁₀)</th>
                <th className="px-3 py-2 text-right">Merit</th>
                <th className="px-3 py-2 text-right">×Mult</th>
                <th className="px-3 py-2 text-right">Adjusted power</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.drepId} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.displayName}</span>
                      {m.isBoard ? (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          BOARD
                        </span>
                      ) : null}
                    </div>
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

      <div className="pt-2">
        <h3 className="text-base font-semibold">Experts</h3>
        <p className="text-sm text-neutral-500">Non-DRep ADA holders approved by the board for milestone review.</p>
        {experts.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">No approved experts yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {experts.map((x) => (
              <li
                key={x.id}
                className="rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
              >
                <span className="font-medium">{x.displayName}</span>
                {x.subcategoryIds.length ? (
                  <span className="ml-2 text-xs text-neutral-500">{x.subcategoryIds.join(', ')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
