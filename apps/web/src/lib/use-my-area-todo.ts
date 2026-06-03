'use client';

import { useEffect, useState } from 'react';
import { boardApi, boardExpertsApi, boardFeeApi, boardPaymentsApi, boardPledgeApi, filteringApi, internalProposalsApi, milestonesApi, proposalsApi, removalApi, rewardAddressApi, treasuryApi } from './api';

/**
 * §20 — total to-do count for the My-area left-nav badge. Sums the same
 * sources the in-area horizontal tabs use (Treasury, Actions, Applications,
 * Voting & reviews, Internal proposals, My proposals) so the left nav
 * mirrors what's inside. Polls every 30 s — light enough that we don't
 * have to coordinate with the in-area version (small duplication, no
 * shared state, no re-render cliffs).
 */
export function useMyAreaTodoCount(isBoard: boolean, canVote: boolean): number {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    // Skip polling entirely for logged-out / role-less viewers — every
    // endpoint would 401 and contribute 0 anyway.
    if (!isBoard && !canVote) { setTotal(0); return; }
    let alive = true;
    const poll = async () => {
      let n = 0;
      if (isBoard) {
        const [a, f, p, dapps, eapps, rem, stop, pl] = await Promise.allSettled([
          treasuryApi.boardActions(),
          boardFeeApi.pending(),
          boardPaymentsApi.pending(),
          boardApi.listApplications(),
          boardExpertsApi.applications(),
          removalApi.list(),
          milestonesApi.pendingStopFunding(),
          boardPledgeApi.pending(),
        ]);
        n += (a.status === 'fulfilled' ? a.value.count : 0);            // Treasury (multisig sign)
        n += (f.status === 'fulfilled' ? f.value.length : 0);            // Actions: fees
        n += (p.status === 'fulfilled' ? p.value.length : 0);            // Actions: payments
        n += (stop.status === 'fulfilled' ? stop.value.count : 0);       // Actions: stop-funding
        n += (pl.status === 'fulfilled' ? pl.value.length : 0);          // Actions: pledges
        n += (dapps.status === 'fulfilled' ? dapps.value.filter((x) => !x.myVote).length : 0); // Applications
        n += (eapps.status === 'fulfilled' ? eapps.value.length : 0);
        n += (rem.status === 'fulfilled' ? rem.value.filter((x) => !x.myVote).length : 0);
      }
      if (canVote) {
        try { n += (await filteringApi.votingTasks()).total; } catch { /* leave */ }
        try { n += (await internalProposalsApi.pendingCount()).count; } catch { /* */ }
      }
      try {
        const mine = await proposalsApi.mine();
        n += mine.filter((p) => p.progress?.tone === 'red' && p.progress.label.includes('POA rejected')).length;
      } catch { /* */ }
      try {
        const r = await rewardAddressApi.get();
        if (!r.rewardPaymentAddress) n += 1;
      } catch { /* */ }
      if (alive) setTotal(n);
    };
    poll();
    const id = window.setInterval(poll, 30_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [isBoard, canVote]);
  return total;
}
