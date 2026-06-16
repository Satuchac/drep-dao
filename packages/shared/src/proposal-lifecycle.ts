/** Minimal proposal shape the Debate & Vote lifecycle rules read. */
export interface DvProposalLike {
  stage?: string | null;
  status: string;
  roundId?: string | null;
}

/**
 * §7/§8 — whether a proposal belongs in the Debate & Vote panel under the given mode. The D&V panel
 * is about CASTING/CHANGING a ballot, so both To do and Recent require the round to actually be in
 * VOTE (ballots open). During DEBATE the DRep debates/comments but can't vote, so D&V shows nothing
 * there — and a proposal that just passed filtering while its round is still in FILTERING stays in
 * the Filtering panel, never double-listed here.
 *   - pending (To do): in DEBATE_VOTE and its round is in VOTE — votable now (not yet voted, but the
 *                      proposal list can't see per-DRep vote state, so it mirrors Recent).
 *   - recent:          same — votable now; the DRep can still change their vote while VOTE is open.
 *   - history:         FINISHED **and** the proposal actually reached D&V.
 *
 * The history gate: a proposal rejected at the FILTERING stage keeps `stage='FILTERING'` (a D&V-vote
 * rejection clears the stage to null; an approval sets it to FUNDING) — only proposals that truly
 * reached Debate & Vote appear in D&V History.
 *
 * `voteRoundIds` = rounds in VOTE (ballots open); `closedRoundIds` = rounds CLOSED.
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
  // To do AND Recent both require ballots to be OPEN (round in VOTE) — nothing to do/change before.
  return p.stage === 'DEBATE_VOTE' && !!p.roundId && ctx.voteRoundIds.has(p.roundId) && !finished;
}
