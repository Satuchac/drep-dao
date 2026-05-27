'use client';

import { useEffect, useState } from 'react';
import { boardApi, boardExpertsApi, boardFeeApi, boardPaymentsApi, removalApi, treasuryApi } from '@/lib/api';

/**
 * §15.3 — notifications in the login rectangle. A red circle with the total number of board
 * to-dos awaiting this member across BOTH the Actions tab (treasury/fees/payments) and the
 * Applications tab (DRep + Expert applications + removals). Clicking lands on whichever tab has
 * work — Actions first, otherwise Applications. Self-hides when there is nothing to do.
 */
export function NotificationBadge({ onNavigate }: { onNavigate: (tab: 'sign' | 'apps') => void }) {
  const [counts, setCounts] = useState({ actions: 0, applications: 0 });

  useEffect(() => {
    let alive = true;
    const poll = () =>
      Promise.allSettled([
        treasuryApi.boardActions(),
        boardFeeApi.pending(),
        boardPaymentsApi.pending(),
        boardApi.listApplications(),
        boardExpertsApi.applications(),
        removalApi.list(),
      ])
        .then(([a, f, p, dapps, eapps, rem]) => {
          if (!alive) return;
          const actions =
            (a.status === 'fulfilled' ? a.value.count : 0) +
            (f.status === 'fulfilled' ? f.value.length : 0) +
            (p.status === 'fulfilled' ? p.value.length : 0);
          const applications =
            (dapps.status === 'fulfilled' ? dapps.value.filter((x) => !x.myVote).length : 0) +
            (eapps.status === 'fulfilled' ? eapps.value.length : 0) +
            (rem.status === 'fulfilled' ? rem.value.filter((x) => !x.myVote).length : 0);
          setCounts({ actions, applications });
        })
        .catch(() => alive && setCounts({ actions: 0, applications: 0 }));
    poll();
    const id = setInterval(poll, 30_000); // light polling; board to-dos are rare
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const total = counts.actions + counts.applications;
  if (total <= 0) return null;

  // Land on the tab that actually has work: Actions first, otherwise Applications.
  const target = counts.actions > 0 ? 'sign' : 'apps';
  const label = counts.actions > 0 ? 'Actions' : 'Applications';

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
