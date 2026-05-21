'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardApi, type PendingApplication } from '@/lib/api';

export function BoardReviewPanel() {
  const [apps, setApps] = useState<PendingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    boardApi
      .listApplications()
      .then(setApps)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const vote = async (drepId: string, choice: 'YES' | 'NO') => {
    setError(null);
    let feedback: string | undefined;
    if (choice === 'NO') {
      feedback = window.prompt('Feedback (required for a NO vote):') ?? undefined;
      if (!feedback?.trim()) return;
    }
    setBusy(drepId);
    try {
      await boardApi.vote(drepId, { choice, feedback });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vote failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">
        Board — DRep applications{' '}
        <span className="text-sm font-normal text-neutral-500">({apps.length} pending)</span>
      </h3>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : apps.length === 0 ? (
        <p className="text-sm text-neutral-500">No pending applications.</p>
      ) : (
        <ul className="space-y-3">
          {apps.map((a) => (
            <li
              key={a.drepId}
              className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800"
            >
              <div className="font-medium">{a.displayName ?? '(no name)'}</div>
              <div className="font-mono text-xs text-neutral-500 break-all">{a.drepIdOnchain}</div>
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
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-neutral-500">
                  {a.yes}/{a.threshold} YES{a.no ? ` · ${a.no} NO` : ''}
                </span>
                <button
                  disabled={busy === a.drepId}
                  onClick={() => vote(a.drepId, 'YES')}
                  className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
                >
                  Approve
                </button>
                <button
                  disabled={busy === a.drepId}
                  onClick={() => vote(a.drepId, 'NO')}
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
