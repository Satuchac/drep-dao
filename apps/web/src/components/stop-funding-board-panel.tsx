'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardMilestoneApi, milestonesApi, type ActiveStopFunding } from '@/lib/api';
import { useUrlNav } from '@/lib/use-url-nav';
import { fmtDateTime, StatusBadge, PROPOSAL_STATUS_CLS } from './round-ui';

/**
 * §11 — board-wide "Stop-funding votes" panel for the Actions tab. Lists every ACTIVE
 * stop-funding so a board member can vote 1p1v without browsing each proposal. Inline
 * YES/NO vote (NO requires rationale); 3 YES → project FAILED + on-chain anchor.
 * Self-hides when there's nothing pending. Linking → the proposal detail still works.
 */
export function StopFundingBoardPanel() {
  const { setParams } = useUrlNav();
  const [items, setItems] = useState<ActiveStopFunding[]>([]);
  const load = useCallback(() => {
    boardMilestoneApi.activeStopFundings().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  if (items.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-red-200 bg-red-50/40 p-4 dark:border-red-900 dark:bg-red-950/30">
      <div>
        <h3 className="text-base font-semibold text-red-800 dark:text-red-200">⛔ Stop-funding votes ({items.length})</h3>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          1 board member · 1 vote — 3 YES terminates the project (FAILED, on-chain anchor). NO requires rationale.
        </p>
      </div>
      <ul className="space-y-2">
        {items.map((s) => (
          <StopRow key={s.id} s={s} onChange={load} onOpen={() => setParams({ proposal: s.proposalId })} />
        ))}
      </ul>
    </section>
  );
}

function StopRow({ s, onChange, onOpen }: { s: ActiveStopFunding; onChange: () => void; onOpen: () => void }) {
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vote = async (choice: 'YES' | 'NO') => {
    setBusy(true); setError(null);
    try { await milestonesApi.voteStop(s.id, choice, rationale || undefined); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };
  return (
    <li className="rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <button onClick={onOpen} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            {s.proposalTitle}
          </button>
          {s.proposalPublicId ? <span className="ml-1 text-xs text-neutral-500">[{s.proposalPublicId}]</span> : null}
          {s.roundLabel ? <span className="ml-2 text-xs text-neutral-500">· {s.roundLabel}</span> : null}
        </span>
        <span className="flex items-center gap-2 text-xs text-neutral-500">
          {s.myChoice ? <StatusBadge status={`you voted ${s.myChoice}`} cls={PROPOSAL_STATUS_CLS} /> : null}
          <span className="tabular-nums">{s.yes} YES / {s.no} NO (need {s.threshold})</span>
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        Proposed by <span className="font-medium">{s.proposerName ?? s.proposerDrep ?? 'unknown'}</span> ({s.proposerRole === 'BOARD' ? 'board' : 'reviewer'}) · {fmtDateTime(s.createdAt)}
      </div>
      <div className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 p-1.5 text-xs text-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-300">
        <strong>Reason:</strong> {s.reason}
      </div>
      <div className="mt-2 space-y-1">
        <input
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="rationale (required for NO)"
          className="w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => vote('YES')} className="rounded border border-red-500 px-2 py-0.5 text-xs text-red-700 disabled:opacity-40 dark:text-red-300">
            YES — stop funding
          </button>
          <button disabled={busy} onClick={() => vote('NO')} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
            NO — continue
          </button>
        </div>
        {error ? <div className="text-xs text-red-600">{error}</div> : null}
      </div>
    </li>
  );
}
