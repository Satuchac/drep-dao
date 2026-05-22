'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardExpertsApi, type ExpertRow } from '@/lib/api';

/** Board-only: approve Experts (non-DRep ADA holders) for milestone review (§2). */
export function ExpertsPanel() {
  const [experts, setExperts] = useState<ExpertRow[]>([]);
  const [stake, setStake] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    boardExpertsApi.list().then(setExperts).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await boardExpertsApi.approve(stake.trim(), name.trim() || undefined);
      setStake('');
      setName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'approve failed');
    } finally {
      setBusy(false);
    }
  };

  const field =
    'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">Experts ({experts.length})</h3>
      <p className="text-xs text-neutral-500">Non-DRep ADA holders approved for milestone review.</p>
      <form onSubmit={approve} className="mt-2 flex flex-wrap gap-2">
        <input className={`${field} flex-1`} placeholder="stake_test1… (ADA holder)" value={stake} onChange={(e) => setStake(e.target.value)} required />
        <input className={field} placeholder="name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={busy || !stake.trim()} className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Approving…' : 'Approve expert'}
        </button>
      </form>
      {error ? <div className="mt-1 text-sm text-red-600">{error}</div> : null}
      {experts.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm">
          {experts.map((x) => (
            <li key={x.id} className="flex justify-between rounded border border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
              <span>{x.displayName} <span className="font-mono text-xs text-neutral-500">{x.stakeAddress.slice(0, 18)}…</span></span>
              <span className={x.approvedByBoard ? 'text-emerald-600' : 'text-neutral-500'}>{x.approvedByBoard ? 'approved' : 'pending'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
