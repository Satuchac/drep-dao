'use client';

import { useEffect, useState } from 'react';
import { boardApi, boardExpertsApi, boardFeeApi, boardPaymentsApi, filteringApi, internalProposalsApi, removalApi, treasuryApi } from '@/lib/api';

/**
 * §15.3 — notifications in the login rectangle. A red circle with the total number of to-dos
 * awaiting this member across the Actions tab (board treasury/fees/payments), the Applications
 * tab (board DRep/Expert applications + removals), the Voting & reviews tab (filtering / D&V /
 * milestone), and the §10 Internal proposals tab. Clicking lands on whichever tab has work —
 * Actions, then Applications, then Voting & reviews, then Internal proposals. Self-hides when
 * there is nothing to do.
 */
export function NotificationBadge({ isBoard, onNavigate }: { isBoard: boolean; onNavigate: (tab: 'sign' | 'apps' | 'voting' | 'internal') => void }) {
  const [counts, setCounts] = useState({ actions: 0, applications: 0, voting: 0, internal: 0 });

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const next = { actions: 0, applications: 0, voting: 0, internal: 0 };
      if (isBoard) {
        const [a, f, p, dapps, eapps, rem] = await Promise.allSettled([
          treasuryApi.boardActions(),
          boardFeeApi.pending(),
          boardPaymentsApi.pending(),
          boardApi.listApplications(),
          boardExpertsApi.applications(),
          removalApi.list(),
        ]);
        next.actions =
          (a.status === 'fulfilled' ? a.value.count : 0) +
          (f.status === 'fulfilled' ? f.value.length : 0) +
          (p.status === 'fulfilled' ? p.value.length : 0);
        next.applications =
          (dapps.status === 'fulfilled' ? dapps.value.filter((x) => !x.myVote).length : 0) +
          (eapps.status === 'fulfilled' ? eapps.value.length : 0) +
          (rem.status === 'fulfilled' ? rem.value.filter((x) => !x.myVote).length : 0);
      }
      try { next.voting = (await filteringApi.votingTasks()).total; } catch { /* leave 0 */ }
      try { next.internal = (await internalProposalsApi.pendingCount()).count; } catch { /* 0 */ }
      if (alive) setCounts(next);
    };
    poll();
    const id = setInterval(poll, 30_000); // light polling; to-dos are rare
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [isBoard]);

  const total = counts.actions + counts.applications + counts.voting + counts.internal;
  if (total <= 0) return null;

  // Land on the tab that actually has work: Actions, then Applications, then Voting & reviews,
  // then Internal proposals.
  const target = counts.actions > 0
    ? 'sign'
    : counts.applications > 0
      ? 'apps'
      : counts.voting > 0
        ? 'voting'
        : 'internal';
  const label = counts.actions > 0
    ? 'Actions'
    : counts.applications > 0
      ? 'Applications'
      : counts.voting > 0
        ? 'Voting & reviews'
        : 'Internal proposals';

  return (
    <button
      onClick={() => onNavigate(target)}
      title={`${total} item${total === 1 ? '' : 's'} to process — go to ${label}`}
      className="relative flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <span aria-hidden>🔔</span>
      <span>{label}</span>
      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white tabular-nums">
        {total}
      </span>
    </button>
  );
}
