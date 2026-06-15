'use client';

import { useEffect, useState } from 'react';
import {
  boardApi, boardExpertsApi, boardFeeApi, boardPaymentsApi, boardPledgeApi, boardProposalsApi,
  boardRevenueApi, boardRoundsApi, boardSubmittersApi, expertApi, filteringApi, internalProposalsApi,
  messagesApi, milestonesApi, proposalsApi, quickPollApi, removalApi, rewardAddressApi, treasuryApi,
  type BoardAction,
} from './api';

/**
 * §20 — the SINGLE source of truth for "items awaiting this member", split by My-area tab.
 * Every to-do surface reads from here so the counts can't diverge: the in-area tab badges,
 * the My-area left-nav badge, and the login-box notification badge. Polls every 30 s.
 *
 * Buckets map 1:1 to the My-area tabs:
 *  - actions    → Actions tab (reward payouts to sign, fee/pledge/revenue confirmations,
 *                 stop-funding votes, reviewer-jury assignments, submitter replies)
 *  - treasury   → Treasury tab (non-reward multisig actions awaiting THIS member)
 *  - applications→ Applications tab (DRep/Expert/Submitter applications + removals not yet voted)
 *  - rounds     → Round control (stages overdue to launch)
 *  - voting     → Voting & reviews (filtering / D&V / milestone tasks + quick-poll tie-breaks)
 *  - internal   → Internal proposals awaiting this DRep's vote
 *  - mine       → My proposals (a REJECTED milestone needing a fresh POA)
 *  - messages   → Messages (board spoke last on an OPEN thread → submitter must respond)
 *  - profile    → Profile (reward-payment address not set yet, for reward earners)
 */
export interface TodoCounts {
  treasury: number;
  actions: number;
  applications: number;
  voting: number;
  internal: number;
  mine: number;
  profile: number;
  messages: number;
  messagesTotal: number;
  rounds: number;
}

export const EMPTY_TODO_COUNTS: TodoCounts = {
  treasury: 0, actions: 0, applications: 0, voting: 0, internal: 0,
  mine: 0, profile: 0, messages: 0, messagesTotal: 0, rounds: 0,
};

/** Total to-dos awaiting the member across every tab — used for the left-nav + login-box badges. */
export function todoTotal(c: TodoCounts): number {
  return c.treasury + c.actions + c.applications + c.voting + c.internal + c.mine + c.profile + c.messages + c.rounds;
}

export function useTodoCounts(isBoard: boolean, canVote: boolean, enabled = true): TodoCounts {
  const [counts, setCounts] = useState<TodoCounts>(EMPTY_TODO_COUNTS);
  useEffect(() => {
    // Logged-out / role-less viewers have nothing to do and every call would 401.
    if (!enabled) { setCounts(EMPTY_TODO_COUNTS); return; }
    let alive = true;
    const poll = async () => {
      const next: TodoCounts = { ...EMPTY_TODO_COUNTS };
      // §3.5 — submitter's board messages: total (drives the Messages tab) + unread (board spoke
      // last on an OPEN thread → the submitter still has to respond). Runs for everyone.
      try {
        const mineMsgs = await messagesApi.mine();
        next.messagesTotal = mineMsgs.length;
        next.messages = mineMsgs.filter((t) => t.status === 'OPEN' && t.lastFromBoard).length;
      } catch { /* leave at 0 */ }
      if (isBoard) {
        const [a, f, p, dapps, eapps, rem, stop, pl, rev, msg, rvw, subs] = await Promise.allSettled([
          treasuryApi.boardActions(),
          boardFeeApi.pending(),
          boardPaymentsApi.pending(),
          boardApi.listApplications(),
          boardExpertsApi.applications(),
          removalApi.list(),
          milestonesApi.pendingStopFunding(), // §11 — stop-funding awaiting THIS board member's 1p1v vote
          boardPledgeApi.pending(), // §3 — pledge payments to confirm
          boardRevenueApi.pending(), // §3.4 — revenue-sharing to verify (gates milestone POAs)
          messagesApi.boardPending(), // §3.5 — submitter replies awaiting the board
          boardProposalsApi.pendingReviewerAssignment(), // §11 — proposals needing a review jury
          boardSubmittersApi.applications(), // §2.1 — submitter applications to review
        ]);
        const acts = a.status === 'fulfilled' ? a.value.actions : [];
        // Only badge an action the current board member still has to act on — once they've
        // authorized (phase 1) or signed (phase 2), it's waiting on others, not their to-do.
        const needsMe = (x: BoardAction) => (x.phase === 'AUTHORIZE' ? !x.mineCommitted : !x.mineApproved);
        next.treasury = acts.filter((x) => x.kind !== 'REWARD_PAYOUT' && needsMe(x)).length;
        next.actions =
          acts.filter((x) => x.kind === 'REWARD_PAYOUT' && needsMe(x)).length +
          (f.status === 'fulfilled' ? f.value.length : 0) +
          (p.status === 'fulfilled' ? p.value.length : 0) +
          (stop.status === 'fulfilled' ? stop.value.count : 0) +
          (pl.status === 'fulfilled' ? pl.value.length : 0) +
          (rev.status === 'fulfilled' ? rev.value.length : 0) +
          (msg.status === 'fulfilled' ? msg.value.length : 0) +
          (rvw.status === 'fulfilled' ? rvw.value.length : 0);
        next.applications =
          (dapps.status === 'fulfilled' ? dapps.value.filter((x) => !x.myVote).length : 0) +
          (eapps.status === 'fulfilled' ? eapps.value.length : 0) +
          (rem.status === 'fulfilled' ? rem.value.filter((x) => !x.myVote).length : 0) +
          (subs.status === 'fulfilled' ? subs.value.length : 0);
        // §6/§8 — rounds whose next stage is overdue to start (board must launch it).
        try { next.rounds = (await boardRoundsApi.overdueStages()).count; } catch { /* leave 0 */ }
      }
      if (canVote) {
        try { next.voting = (await filteringApi.votingTasks()).total; } catch { /* leave 0 */ }
        // §9.2 — quick polls awaiting this DRep's tie-break vote.
        try { next.voting += (await quickPollApi.myPending()).count; } catch { /* leave 0 */ }
        try { next.internal = (await internalProposalsApi.pendingCount()).count; } catch { /* 0 */ }
      }
      // §15.4 — reward earners (DReps/board/DAO members + approved experts) need a reward payment
      // address; nag on the Profile tab until one is set. We resolve "approved expert" here so every
      // to-do surface agrees (the left-nav + login box don't otherwise know the expert status).
      let isApprovedExpert = false;
      if (!canVote) {
        try { isApprovedExpert = !!(await expertApi.mine())?.approvedByBoard; } catch { /* 0 */ }
      }
      if (canVote || isApprovedExpert) {
        try { const r = await rewardAddressApi.get(); if (!r.rewardPaymentAddress) next.profile += 1; } catch { /* 0 */ }
      }
      // §11.2 — submitter's "my proposals" to-dos: any proposal on a REJECTED milestone needing a
      // fresh POA. The backend tags those rows red with a "POA rejected" label, so we just count them.
      try {
        const mine = await proposalsApi.mine();
        next.mine = mine.filter((p) => p.progress?.tone === 'red' && p.progress.label.includes('POA rejected')).length;
      } catch { /* 0 */ }
      if (alive) setCounts(next);
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [isBoard, canVote, enabled]);
  return counts;
}

/** The My-area tab a to-do badge should jump to: the first tab (in priority order) with work. */
export function firstTodoTab(c: TodoCounts): { tab: string; label: string } | null {
  const order: { key: keyof TodoCounts; tab: string; label: string }[] = [
    { key: 'actions', tab: 'sign', label: 'Actions' },
    { key: 'treasury', tab: 'treasury', label: 'Treasury' },
    { key: 'applications', tab: 'apps', label: 'Applications' },
    { key: 'rounds', tab: 'rounds', label: 'Round control' },
    { key: 'voting', tab: 'voting', label: 'Voting & reviews' },
    { key: 'internal', tab: 'internal', label: 'Internal proposals' },
    { key: 'messages', tab: 'messages', label: 'Messages' },
    { key: 'mine', tab: 'proposals', label: 'My proposals' },
    { key: 'profile', tab: 'profile', label: 'Profile' },
  ];
  for (const o of order) if (c[o.key] > 0) return { tab: o.tab, label: o.label };
  return null;
}
