/**
 * Pure proposal-state classifiers shared by stats/category roll-ups. A REJECTED proposal can be
 * rejected at three different points, all worth telling apart — and two of them share `stage == null`:
 *   - fee/submission stage → never entered the round (fee unpaid / board-rejected): stage null,
 *     result NOT finalized. Counts as "Not accepted".
 *   - Debate & Vote        → lost the ballot: stage null, result finalized.
 *   - filtering            → stage 'FILTERING'.
 */
export function isFeeStageReject(
  status: string,
  stage: string | null,
  resultFinalizedAt: Date | null,
): boolean {
  return status === 'REJECTED' && stage == null && resultFinalizedAt == null;
}
