'use client';

import { useEffect, useState } from 'react';
import { daoApi, type DaoMember } from '@/lib/api';

/** §4 — all DAO members with balanced voting power: log10(stake) × (1 + merit/200). */
export function DaoOverview() {
  const [members, setMembers] = useState<DaoMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    daoApi
      .members()
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">DAO Member overview</h2>
        <p className="text-sm text-neutral-500">
          Voting power (§4) = log₁₀(on-chain stake in ADA) × (1 + merit/200).
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
                <th className="px-3 py-2 text-right">Stake (ADA)</th>
                <th className="px-3 py-2 text-right">Base (log₁₀)</th>
                <th className="px-3 py-2 text-right">Merit</th>
                <th className="px-3 py-2 text-right">×Mult</th>
                <th className="px-3 py-2 text-right">Voting power</th>
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
                    <div className="break-all font-mono text-[11px] text-neutral-400">{m.drepId}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.stakeAda.toLocaleString()}</td>
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
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{m.votingPower.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {members && members.some((m) => m.stakeAda === 0) ? (
        <p className="text-xs text-neutral-400">
          A 0 ADA stake (hence 0 base power) means no live on-chain delegation to that DRep yet — Koios
          voting power updates at epoch boundaries.
        </p>
      ) : null}
    </div>
  );
}
