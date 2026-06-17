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

/**
 * §8.1/§12 — during DEBATE the team may revise milestone CONTENT but not the budget: the number of
 * milestones and each milestone's amount must match the current plan (budget changes go through
 * "Request a budget change"). Returns an error message if the proposed amounts break that rule, or
 * null if only content changed. Amounts are compared in lovelace (exact integers).
 */
export function debateMilestoneEditError(
  proposedAmountsLovelace: bigint[],
  currentAmountsLovelace: bigint[],
): string | null {
  if (proposedAmountsLovelace.length !== currentAmountsLovelace.length) {
    return 'milestones can’t be added or removed during Debate — request a budget change';
  }
  if (proposedAmountsLovelace.some((a, i) => a !== currentAmountsLovelace[i])) {
    return 'milestone budgets are locked during Debate — request a budget change';
  }
  return null;
}
