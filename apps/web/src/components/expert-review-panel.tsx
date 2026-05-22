'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardExpertsApi, type ExpertApplication } from '@/lib/api';

/** Board-only: review pending Expert applications (§2 — approved by the board). */
export function ExpertReviewPanel() {
  const [apps, setApps] = useState<ExpertApplication[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    boardExpertsApi.applications().then(setApps).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(id);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">
        Board — Expert applications{' '}
        <span className="text-sm font-normal text-neutral-500">({apps.length} pending)</span>
      </h3>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {apps.length === 0 ? (
        <p className="text-sm text-neutral-500">No pending expert applications.</p>
      ) : (
        <ul className="space-y-3">
          {apps.map((a) => (
            <li key={a.id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <div className="font-medium">{a.displayName}</div>
              <div className="font-mono text-xs text-neutral-500 break-all">{a.stakeAddress}</div>
              {a.bio ? <p className="mt-1 text-neutral-600 dark:text-neutral-400">{a.bio}</p> : null}
              {a.subcategoryIds.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {a.subcategoryIds.map((s) => (
                    <span key={s} className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex gap-3">
                <button
                  disabled={busy === a.id}
                  onClick={() => act(a.id, () => boardExpertsApi.approve(a.id))}
                  className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
                >
                  Approve
                </button>
                <button
                  disabled={busy === a.id}
                  onClick={() => act(a.id, () => boardExpertsApi.reject(a.id))}
                  className="rounded border border-red-400 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
