'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardApi, type PendingApplication } from '@/lib/api';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 font-medium text-neutral-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-300">{children}</dd>
    </div>
  );
}

const optins = (a: PendingApplication) =>
  [
    a.kycOptin ? 'KYC' : null,
    a.callsOptin ? 'Calls' : null,
    a.admissionCallOptin ? 'Admission call' : null,
  ].filter(Boolean) as string[];

export function BoardReviewPanel() {
  const [apps, setApps] = useState<PendingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    boardApi
      .listApplications()
      .then((list) => {
        setApps(list);
        // Prefill each rationale box with this board member's saved rationale.
        setRationale(Object.fromEntries(list.map((a) => [a.drepId, a.myVote?.feedback ?? ''])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const vote = async (drepId: string, choice: 'YES' | 'NO') => {
    setError(null);
    const feedback = (rationale[drepId] ?? '').trim();
    if (!feedback) {
      setError('A written rationale is required for every vote (YES or NO).');
      return;
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
          {apps.map((a) => {
            const noRationale = !(rationale[a.drepId] ?? '').trim();
            const contact = a.contact ?? {};
            return (
              <li key={a.drepId} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.displayName ?? '(no name)'}</span>
                  {a.myVote ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        a.myVote.choice === 'YES'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                      }`}
                    >
                      YOU VOTED {a.myVote.choice}
                    </span>
                  ) : null}
                </div>
                <dl className="mt-1 space-y-1 text-xs">
                  <Row label="DRep ID">
                    <span className="break-all font-mono text-neutral-500">{a.drepIdOnchain}</span>
                  </Row>
                  {a.bio ? <Row label="Motivation">{a.bio}</Row> : null}
                  {a.subcategoryIds.length ? (
                    <Row label="Categories">
                      <span className="flex flex-wrap gap-1">
                        {a.subcategoryIds.map((s) => (
                          <span key={s} className="rounded bg-neutral-200 px-1.5 py-0.5 dark:bg-neutral-800">
                            {s}
                          </span>
                        ))}
                      </span>
                    </Row>
                  ) : null}
                  {contact.email || contact.telegram ? (
                    <Row label="Contact">
                      {[contact.email, contact.telegram].filter(Boolean).join(' · ')}
                    </Row>
                  ) : null}
                  <Row label="Opt-ins">{optins(a).length ? optins(a).join(', ') : 'none'}</Row>
                  <Row label="Board votes">
                    {a.yes}/{a.threshold} YES{a.no ? ` · ${a.no} NO` : ''}
                  </Row>
                </dl>
                <textarea
                  value={rationale[a.drepId] ?? ''}
                  onChange={(e) => setRationale((r) => ({ ...r, [a.drepId]: e.target.value }))}
                  placeholder="Rationale (required for YES and NO) — visible to the applicant"
                  rows={2}
                  className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                />
                <div className="mt-2 flex items-center gap-3">
                  <button
                    disabled={busy === a.drepId || noRationale}
                    onClick={() => vote(a.drepId, 'YES')}
                    className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
                  >
                    {a.myVote?.choice === 'YES' ? 'Update YES' : 'Approve (YES)'}
                  </button>
                  <button
                    disabled={busy === a.drepId || noRationale}
                    onClick={() => vote(a.drepId, 'NO')}
                    className="rounded border border-red-400 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
                  >
                    {a.myVote?.choice === 'NO' ? 'Update NO' : 'Reject (NO)'}
                  </button>
                  {noRationale ? <span className="text-xs text-neutral-400">enter a rationale to vote</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
