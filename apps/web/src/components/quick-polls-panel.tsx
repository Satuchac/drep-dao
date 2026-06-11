'use client';

import { useCallback, useEffect, useState } from 'react';
import { quickPollApi, type QuickPollView } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const STATUS_CLS: Record<string, string> = {
  PENDING_BOARD: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  ACTIVE: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  RESOLVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
};

/**
 * §9.2 — Quick Poll tie-break panel (per round). Auto-created when equal scores collide at the
 * budget cliff: the board launches with one click; eligible DReps pick which proposal gets the
 * remaining budget. Self-hides when the round has no polls.
 */
export function QuickPollsPanel({ roundId }: { roundId: string }) {
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [polls, setPolls] = useState<QuickPollView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { quickPollApi.forRound(roundId).then(setPolls).catch(() => setPolls([])); }, [roundId]);
  useEffect(() => { load(); }, [load]);

  if (polls.length === 0) return null;

  const launch = async (id: string) => {
    setBusy(id); setErr(null);
    try { await quickPollApi.launch(id); load(); } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); } finally { setBusy(null); }
  };
  const vote = async (id: string, choice: string) => {
    setBusy(id); setErr(null);
    try { await quickPollApi.vote(id, choice); load(); } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); } finally { setBusy(null); }
  };

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">Quick polls — tie-break ({polls.length})</h3>
      <p className="text-xs text-neutral-500">
        §9.2 — proposals with equal scores at the budget cliff. The winner takes the remaining
        category budget; 48 h window, 51% participation (extended up to 3× when too low).
      </p>
      {err ? <div className="text-xs text-red-600">{err}</div> : null}
      {polls.map((p) => (
        <div key={p.id} className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{p.categoryName ?? 'category'} · tie of {p.candidates.length}</span>
            <span className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[p.status]}`}>{p.status}</span>
              {p.status === 'ACTIVE' && p.endsAt ? <span className="text-xs text-neutral-500">ends {new Date(p.endsAt).toLocaleString()}{p.extensions > 0 ? ` · extended ${p.extensions}×` : ''}</span> : null}
              {p.status === 'PENDING_BOARD' && isBoard ? (
                <button onClick={() => void launch(p.id)} disabled={busy === p.id} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busy === p.id ? '…' : 'Launch poll'}
                </button>
              ) : null}
            </span>
          </div>
          <div className="mt-1 text-xs text-neutral-500">{p.votedCount}/{p.eligibleCount} voted</div>
          <ul className="mt-2 space-y-1">
            {p.candidates.map((c) => (
              <li key={c.id} className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs ${p.winnerId === c.id ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30' : 'border-neutral-200 dark:border-neutral-800'}`}>
                <span>
                  <span className="font-medium">{c.publicId ? `${c.publicId} · ` : ''}{c.title}</span>
                  <span className="ml-2 text-neutral-500">{c.requestedAmountAda.toLocaleString()} ₳</span>
                  {p.winnerId === c.id ? <span className="ml-2 text-emerald-600">✓ winner</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-neutral-500" title="Voting power for this candidate">{c.power.toFixed(2)}</span>
                  {p.status === 'ACTIVE' && p.iAmEligible ? (
                    <button onClick={() => void vote(p.id, c.id)} disabled={busy === p.id} className={`rounded border px-2 py-0.5 ${p.myChoice === c.id ? 'border-emerald-500 bg-emerald-100 text-emerald-700 dark:bg-emerald-950' : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700'}`}>
                      {p.myChoice === c.id ? '✓ my vote' : 'Vote'}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
