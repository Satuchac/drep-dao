/**
 * §7.4/§16 — the red "progress" chip shown on a REJECTED proposal in the submitter's My-proposals
 * list. A still-revisable rejection's label contains "resubmit" — that's what the My-proposals
 * notification badge counts (`useTodoCounts`) — while a final rejection reads plainly "rejected …".
 *
 * Kept as a pure function (no Prisma) so it can be unit-tested directly.
 *   - stage 'FILTERING'                 → rejected by the filtering jury; revisable while the round
 *                                         is still in FILTERING (otherwise final).
 *   - stage null + fee-review feedback  → rejected at the fee review; revisable while SUBMISSION.
 *   - otherwise (stage null, no fee fb) → rejected in Debate & Vote (final).
 */
export type ProgressChip = { stage: string; label: string; tone: 'red' };

export function rejectedProgress(
  stage: string | null,
  roundStatus: string | null,
  feeReviewFeedback: string | null | undefined,
): ProgressChip {
  if (stage === 'FILTERING') {
    return roundStatus === 'FILTERING'
      ? { stage: 'FILTERING', label: 'rejected at filtering — revise & resubmit', tone: 'red' }
      : { stage: 'FILTERING', label: 'rejected at filtering', tone: 'red' };
  }
  if (stage == null && feeReviewFeedback) {
    return roundStatus === 'SUBMISSION'
      ? { stage: 'FEE', label: 'fee rejected — fix & resubmit', tone: 'red' }
      : { stage: 'FEE', label: 'fee rejected by the board', tone: 'red' };
  }
  return { stage: 'DV', label: 'rejected in Debate & Vote', tone: 'red' };
}
