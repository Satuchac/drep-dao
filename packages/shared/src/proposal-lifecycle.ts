/** Minimal proposal shape the Debate & Vote lifecycle rules read. */
export interface DvProposalLike {
  stage?: string | null;
  status: string;
  roundId?: string | null;
}

/**
 * §7/§8 — whether a proposal belongs in the Debate & Vote panel under the given mode. Gated on the
 * round's PHASE so a proposal appears in exactly one panel's Recent (and active items never sit in
 * History):
 *   - pending (To do): in DEBATE_VOTE and its round is in VOTE — votable now.
 *   - recent:          in DEBATE_VOTE and its round is in the debate/vote PHASE (DEBATE or VOTE) —
 *                      incl. "voting not open yet" during DEBATE.
 *   - history:         FINISHED **and** the proposal actually reached D&V.
 *
 * Why the phase gate on Recent: a proposal passes filtering (→ `stage='DEBATE_VOTE'`) the moment it
 * gets enough YES, which can happen while its round is STILL in the FILTERING phase. During that
 * window the reviewer's filtering vote is still changeable, so the proposal belongs to the Filtering
 * panel — NOT D&V. It only enters D&V once the round itself advances to DEBATE/VOTE. Without this
 * gate the proposal shows in both panels' Recent at once.
 *
 * The history gate matters too: a proposal rejected at the FILTERING stage keeps `stage='FILTERING'`
 * (a D&V-vote rejection clears the stage to null; an approval sets it to FUNDING) — only proposals
 * that truly reached Debate & Vote appear in D&V History.
 *
 * `voteRoundIds` = rounds in VOTE; `dvPhaseRoundIds` = rounds in DEBATE or VOTE; `closedRoundIds`
 * = rounds CLOSED.
 */
export function matchesDvMode(
  p: DvProposalLike,
  mode: 'pending' | 'recent' | 'history',
  ctx: { voteRoundIds: Set<string>; dvPhaseRoundIds: Set<string>; closedRoundIds: Set<string> },
): boolean {
  const terminal = ['APPROVED', 'REJECTED', 'COMPLETE', 'FAILED'].includes(p.status);
  const finished = terminal || (!!p.roundId && ctx.closedRoundIds.has(p.roundId));
  const reachedDV =
    p.stage === 'DEBATE_VOTE' || p.stage === 'FUNDING' || (terminal && p.stage !== 'FILTERING');
  if (mode === 'history') return finished && reachedDV;
  if (mode === 'recent') return p.stage === 'DEBATE_VOTE' && !!p.roundId && ctx.dvPhaseRoundIds.has(p.roundId) && !finished;
  return p.stage === 'DEBATE_VOTE' && !!p.roundId && ctx.voteRoundIds.has(p.roundId) && !finished;
}
