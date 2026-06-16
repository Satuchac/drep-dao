/** Minimal proposal shape the Debate & Vote lifecycle rules read. */
export interface DvProposalLike {
  stage?: string | null;
  status: string;
  roundId?: string | null;
}

/**
 * §7/§8 — whether a proposal belongs in the Debate & Vote panel under the given mode. Round-based,
 * so active items never sit in History:
 *   - pending (To do): in DEBATE_VOTE and its round is in VOTE — votable now.
 *   - recent:          in DEBATE_VOTE in any non-finished round (incl. "waiting for VOTE").
 *   - history:         FINISHED **and** the proposal actually reached D&V.
 *
 * The history gate matters: a proposal rejected at the FILTERING stage keeps `stage === 'FILTERING'`
 * (a D&V-vote rejection clears the stage to null; an approval sets it to FUNDING). Such a proposal
 * is still changeable in the Filtering panel while its round is in filtering, so it must NOT appear
 * in D&V History — only proposals that truly reached Debate & Vote do.
 *
 * `voteRoundIds` / `closedRoundIds` are the ids of rounds currently in VOTE and CLOSED.
 */
export function matchesDvMode(
  p: DvProposalLike,
  mode: 'pending' | 'recent' | 'history',
  ctx: { voteRoundIds: Set<string>; closedRoundIds: Set<string> },
): boolean {
  const terminal = ['APPROVED', 'REJECTED', 'COMPLETE', 'FAILED'].includes(p.status);
  const finished = terminal || (!!p.roundId && ctx.closedRoundIds.has(p.roundId));
  const reachedDV =
    p.stage === 'DEBATE_VOTE' || p.stage === 'FUNDING' || (terminal && p.stage !== 'FILTERING');
  if (mode === 'history') return finished && reachedDV;
  if (mode === 'recent') return p.stage === 'DEBATE_VOTE' && !finished;
  return p.stage === 'DEBATE_VOTE' && !!p.roundId && ctx.voteRoundIds.has(p.roundId) && !finished;
}
