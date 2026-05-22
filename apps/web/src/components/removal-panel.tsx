'use client';

import { useCallback, useEffect, useState } from 'react';
import { removalApi, type ActiveRemoval, type RemovableMember } from '@/lib/api';

/** Board-only (§14.4): propose removing a DAO member + vote 3-of-5 to remove. */
export function RemovalPanel() {
  const [removals, setRemovals] = useState<ActiveRemoval[]>([]);
  const [members, setMembers] = useState<RemovableMember[]>([]);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    removalApi.list().then((list) => {
      setRemovals(list);
      setRationale(Object.fromEntries(list.map((r) => [r.id, ''])));
    }).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
    removalApi.removableMembers().then(setMembers).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const propose = async () => {
    if (!target) return;
    setError(null);
    setBusy('propose');
    try {
      await removalApi.propose(target, reason.trim() || undefined);
      setTarget('');
      setReason('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  const vote = async (id: string, choice: 'YES' | 'NO') => {
    const r = (rationale[id] ?? '').trim();
    if (!r) {
      setError('A rationale is required to vote.');
      return;
    }
    setError(null);
    setBusy(id);
    try {
      await removalApi.vote(id, choice, r);
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
        Board — remove a DAO member{' '}
        <span className="text-sm font-normal text-neutral-500">({removals.length} pending)</span>
      </h3>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      {/* Propose */}
      <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800 sm:flex-row">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 sm:w-48"
        >
          <option value="">Select a member…</option>
          {members.map((m) => (
            <option key={m.drepId} value={m.drepId}>
              {m.displayName}
            </option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          onClick={propose}
          disabled={busy === 'propose' || !target}
          className="rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
        >
          Propose removal
        </button>
      </div>

      {removals.length === 0 ? (
        <p className="text-sm text-neutral-500">No pending removals.</p>
      ) : (
        <ul className="space-y-3">
          {removals.map((r) => {
            const noRat = !(rationale[r.id] ?? '').trim();
            return (
              <li key={r.id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div className="font-medium">
                  Remove {r.targetName}{' '}
                  {r.myVote ? (
                    <span className="ml-1 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-neutral-800">
                      YOU VOTED {r.myVote}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-neutral-500">
                  proposed by {r.proposedByName}
                  {r.reason ? ` — ${r.reason}` : ''}
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {r.yes}/{r.threshold} YES (remove){r.no ? ` · ${r.no} NO` : ''}
                </div>
                {r.votes.length ? (
                  <ul className="mt-1 space-y-0.5 text-xs text-neutral-500">
                    {r.votes.map((v, i) => (
                      <li key={i}>
                        <span className={v.choice === 'YES' ? 'text-red-600' : 'text-emerald-600'}>{v.choice}</span> ·{' '}
                        {v.voterName}
                        {v.rationale ? <span className="text-neutral-400"> — {v.rationale}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <textarea
                  value={rationale[r.id] ?? ''}
                  onChange={(e) => setRationale((s) => ({ ...s, [r.id]: e.target.value }))}
                  placeholder="Rationale (required) — visible to the member"
                  rows={2}
                  className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                />
                <div className="mt-2 flex items-center gap-3">
                  <button
                    disabled={busy === r.id || noRat}
                    onClick={() => vote(r.id, 'YES')}
                    className="rounded border border-red-400 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
                  >
                    {r.myVote === 'YES' ? 'Update: Remove' : 'Vote to remove (YES)'}
                  </button>
                  <button
                    disabled={busy === r.id || noRat}
                    onClick={() => vote(r.id, 'NO')}
                    className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
                  >
                    {r.myVote === 'NO' ? 'Update: Keep' : 'Vote to keep (NO)'}
                  </button>
                  {noRat ? <span className="text-xs text-neutral-400">enter a rationale to vote</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
