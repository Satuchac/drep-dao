'use client';

import { useCallback, useEffect, useState } from 'react';
import { filteringApi, type FilterAssignment } from '@/lib/api';
import { ProposalDetail } from './proposal-detail';

/** §7 — a DRep's filtering review assignments, with a full rationale editor + the proposal. */
export function FilteringPanel() {
  const [assignments, setAssignments] = useState<FilterAssignment[]>([]);
  const load = useCallback(() => {
    filteringApi.myAssignments().then(setAssignments).catch(() => setAssignments([]));
  }, []);
  useEffect(load, [load]);

  if (assignments.length === 0) return null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">Filtering — your assignments ({assignments.length})</h3>
      <p className="text-xs text-neutral-500">1 person = 1 vote · a NO requires a written rationale. Rationale supports Markdown.</p>
      <ul className="mt-3 space-y-3">
        {assignments.map((a) => (
          <FilterAssignmentRow key={a.proposalId} a={a} onVoted={load} />
        ))}
      </ul>
    </section>
  );
}

function FilterAssignmentRow({ a, onVoted }: { a: FilterAssignment; onVoted: () => void }) {
  const [rationale, setRationale] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vote = async (choice: 'YES' | 'NO' | 'ABSTAIN') => {
    setError(null);
    if (choice === 'NO' && !rationale.trim()) {
      setError('A NO vote requires a written rationale.');
      return;
    }
    setBusy(choice);
    try {
      await filteringApi.vote(a.proposalId, choice, rationale.trim() || undefined);
      onVoted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'vote failed');
    } finally {
      setBusy(null);
    }
  };

  if (open) {
    return (
      <li className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
        <ProposalDetail id={a.proposalId} onBack={() => setOpen(false)} />
      </li>
    );
  }

  return (
    <li className="rounded border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{a.title}</span>
        <span className="flex items-center gap-3">
          {a.myVote ? <span className="text-xs text-emerald-600">voted {a.myVote}</span> : null}
          <button onClick={() => setOpen(true)} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">
            View full proposal →
          </button>
        </span>
      </div>
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        rows={6}
        placeholder="Your rationale (Markdown supported; required for a NO vote). Can be as long as you need."
        className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      />
      {error ? <div className="mt-1 text-sm text-red-600">{error}</div> : null}
      <div className="mt-1 flex gap-2">
        {(['YES', 'NO', 'ABSTAIN'] as const).map((c) => (
          <button
            key={c}
            disabled={busy !== null}
            onClick={() => vote(c)}
            className={`rounded border px-3 py-1 text-sm disabled:opacity-50 ${
              c === 'YES'
                ? 'border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950'
                : c === 'NO'
                  ? 'border-red-500 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950'
                  : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
            }`}
          >
            {busy === c ? '…' : c}
          </button>
        ))}
      </div>
    </li>
  );
}
