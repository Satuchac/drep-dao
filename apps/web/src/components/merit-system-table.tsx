'use client';

import { MERIT_DELTAS, type MeritReason } from '@drep-dao/shared';

/**
 * §13 — human-readable explanation of the merit-based system, shown at the
 * bottom of the DAO members overview. Point values come straight from the
 * shared MERIT_DELTAS table (the same one the backend awards from), so this
 * table can never drift from what the platform actually does.
 */
const ROWS: { reason: MeritReason; who: 'DAO member' | 'Board member'; what: string }[] = [
  // ── gains: every DAO member ──
  { reason: 'FILTER_COMPLETE', who: 'DAO member', what: 'Completed an assigned filtering review' },
  { reason: 'DV_VOTE', who: 'DAO member', what: 'Voted in Debate & Vote on a funding proposal' },
  { reason: 'DV_VOTE_INTERNAL', who: 'DAO member', what: 'Voted on an internal proposal' },
  { reason: 'QUICK_POLL_VOTE', who: 'DAO member', what: 'Voted in a quick poll' },
  { reason: 'MILESTONE_CHECK', who: 'DAO member', what: 'Completed an assigned milestone review' },
  { reason: 'INTERNAL_SUBMIT', who: 'DAO member', what: 'Submitted an internal proposal' },
  // ── gains: board members ──
  { reason: 'APPLICATION_REVIEW', who: 'Board member', what: 'Decided (approved/rejected) a submitter application' },
  { reason: 'MULTISIG_KEY_PROVIDED', who: 'Board member', what: 'Provided their treasury multisig signing key' },
  { reason: 'MULTISIG_READY', who: 'Board member', what: 'Treasury multisig assembled (each contributing member)' },
  { reason: 'TX_INITIATED', who: 'Board member', what: 'Initiated a treasury action (e.g. hot-wallet top-up) that reached the network' },
  { reason: 'TX_SIGNED', who: 'Board member', what: 'Signed a multisig transaction that reached the network' },
  { reason: 'BOARD_PAYOUT_SIGNED', who: 'Board member', what: 'Signed a milestone payout that was paid on time' },
  { reason: 'BOARD_ROUND_CONFIGURE', who: 'Board member', what: 'Configured a funding round (whole board)' },
  { reason: 'BOARD_ROUND_START', who: 'Board member', what: 'Started a funding round on schedule (whole board)' },
  { reason: 'BOARD_ROUND_END', who: 'Board member', what: 'Closed a funding round (whole board)' },
  { reason: 'BOARD_REWARD_DISTRIBUTE', who: 'Board member', what: 'Distributed round rewards (whole board)' },
  { reason: 'BOARD_LEDGER_MONTHLY', who: 'Board member', what: 'Monthly treasury ledger published (whole board)' },
  // ── deductions ──
  { reason: 'MISSED_FILTER', who: 'DAO member', what: 'Missed an assigned filtering review deadline' },
  { reason: 'MISSED_DV', who: 'DAO member', what: 'Missed a Debate & Vote window' },
  { reason: 'MISSED_QUICK_POLL', who: 'DAO member', what: 'Missed a quick poll' },
  { reason: 'MISSED_MILESTONE', who: 'DAO member', what: 'Missed an assigned milestone review deadline' },
  { reason: 'BOARD_REWARD_LATE', who: 'Board member', what: 'Reward distribution past the deadline (whole board)' },
  { reason: 'BOARD_PAYOUT_LATE', who: 'Board member', what: 'Milestone payout missed the deadline (whole board)' },
];

const fmt = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;

export function MeritSystemTable() {
  return (
    <section className="mt-6 space-y-2">
      <div>
        <h3 className="text-base font-semibold">How merit points work</h3>
        <p className="text-xs text-neutral-500">
          Every DAO member earns (or loses) merit points for the operations below. Merit raises a member&apos;s
          adjusted voting power (capped by the MERIT_POINT_MAX platform parameter); misses are deducted by the
          daily sweep unless an avoid period covers them. Rows marked &quot;whole board&quot; apply to every active
          board seat collectively.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2">Operation</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2 text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const delta = MERIT_DELTAS[r.reason];
              return (
                <tr key={r.reason} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-1.5">{r.what}</td>
                  <td className="px-3 py-1.5">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      r.who === 'Board member'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                    }`}>
                      {r.who}
                    </span>
                  </td>
                  <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmt(delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
