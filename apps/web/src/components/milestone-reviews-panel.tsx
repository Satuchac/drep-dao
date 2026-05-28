'use client';

import { useCallback, useEffect, useState } from 'react';
import { milestonesApi, type MilestoneAssignmentView } from '@/lib/api';
import { useUrlNav } from '@/lib/use-url-nav';

/**
 * §11.3 — the DRep's milestone-review assignments awaiting a vote. The review itself happens on
 * the proposal's detail page (POA + vote), so each row links there. Self-hides when empty.
 */
export function MilestoneReviewsPanel({ history = false }: { history?: boolean }) {
  const { setParams } = useUrlNav();
  const [items, setItems] = useState<MilestoneAssignmentView[]>([]);
  const load = useCallback(() => {
    milestonesApi.myAssignments(history).then(setItems).catch(() => setItems([]));
  }, [history]);
  useEffect(load, [load]);

  if (items.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">Milestone reviews — {history ? 'all past assignments' : 'your assignments'} ({items.length})</h3>
      <p className="text-xs text-neutral-500">1 person = 1 vote · review the Proof of Achievement on the proposal page. A NO vote requires feedback.</p>
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.milestoneId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <span>
              <span className="font-medium">{m.proposalTitle}</span>
              <span className="ml-2 text-xs text-neutral-500">milestone #{m.milestoneIdx + 1}</span>
              {m.milestoneStatus && history ? <span className="ml-2 text-[11px] text-neutral-500">[{m.milestoneStatus}]</span> : null}
              {m.myVote ? <span className="ml-2 text-xs text-emerald-600">voted {m.myVote}</span> : null}
            </span>
            <button onClick={() => setParams({ proposal: m.proposalId })} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">
              Open to review →
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
