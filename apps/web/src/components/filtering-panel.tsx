'use client';

import { useCallback, useEffect, useState } from 'react';
import { filteringApi, type FilterAssignment } from '@/lib/api';

export function FilteringPanel() {
  const [assignments, setAssignments] = useState<FilterAssignment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    filteringApi.myAssignments().then(setAssignments).catch(() => setAssignments([]));
  }, []);
  useEffect(load, [load]);

  const vote = async (proposalId: string, choice: 'YES' | 'NO' | 'ABSTAIN') => {
    setError(null);
    let rationale: string | undefined;
    if (choice === 'NO') {
      rationale = window.prompt('Rationale (required for NO):') ?? undefined;
      if (!rationale?.trim()) return;
    }
    setBusy(proposalId);
    try {
      await filteringApi.vote(proposalId, choice, rationale);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'vote failed');
    } finally {
      setBusy(null);
    }
  };

  if (assignments.length === 0) return null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">Filtering — your assignments ({assignments.length})</h3>
      <p className="text-xs text-neutral-500">1 person = 1 vote · a NO requires rationale.</p>
      {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      <ul className="mt-2 space-y-2 text-sm">
        {assignments.map((a) => (
          <li key={a.proposalId} className="rounded border border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="font-medium">{a.title}</span>
              {a.myVote ? <span className="text-xs text-emerald-600">voted {a.myVote}</span> : null}
            </div>
            <div className="mt-1 flex gap-2">
              {(['YES', 'NO', 'ABSTAIN'] as const).map((c) => (
                <button
                  key={c}
                  disabled={busy === a.proposalId}
                  onClick={() => vote(a.proposalId, c)}
                  className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {c}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
