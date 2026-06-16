import { describe, it, expect } from 'vitest';
import { matchesDvMode } from './proposal-lifecycle';

describe('matchesDvMode (§7/§8 — Debate & Vote To do / Recent / History)', () => {
  const ctx = { voteRoundIds: new Set(['rVote']), closedRoundIds: new Set(['rClosed']) };

  it('To do = in DEBATE_VOTE and the round is in VOTE (votable now)', () => {
    const votable = { stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rVote' };
    expect(matchesDvMode(votable, 'pending', ctx)).toBe(true);
    expect(matchesDvMode(votable, 'recent', ctx)).toBe(true); // also shows in Recent

    const waiting = { stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rDebate' };
    expect(matchesDvMode(waiting, 'pending', ctx)).toBe(false); // voting not open yet
    expect(matchesDvMode(waiting, 'recent', ctx)).toBe(true);   // ...but it is "Recent"
  });

  it('Recent = active DEBATE_VOTE proposals (incl. waiting-for-VOTE), never finished ones', () => {
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rDebate' }, 'recent', ctx)).toBe(true);
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'REJECTED', roundId: 'rVote' }, 'recent', ctx)).toBe(false);
  });

  it('BUG FIX: a proposal rejected at the FILTERING stage never appears in D&V History', () => {
    // Filtering rejection → status REJECTED, stage 'FILTERING'. The DRep can still change their
    // filtering vote, so this belongs to the Filtering panel, not D&V — in NO D&V mode.
    const filteringRejected = { stage: 'FILTERING', status: 'REJECTED', roundId: 'rFilter' };
    expect(matchesDvMode(filteringRejected, 'history', ctx)).toBe(false);
    expect(matchesDvMode(filteringRejected, 'recent', ctx)).toBe(false);
    expect(matchesDvMode(filteringRejected, 'pending', ctx)).toBe(false);
  });

  it('History = finished proposals that actually reached D&V', () => {
    // Rejected in the vote stage → stage cleared to null.
    expect(matchesDvMode({ stage: null, status: 'REJECTED', roundId: 'rVote' }, 'history', ctx)).toBe(true);
    // Approved → moved to FUNDING.
    expect(matchesDvMode({ stage: 'FUNDING', status: 'APPROVED', roundId: 'rVote' }, 'history', ctx)).toBe(true);
    // Completed / failed projects.
    expect(matchesDvMode({ stage: 'FUNDING', status: 'COMPLETE', roundId: 'rVote' }, 'history', ctx)).toBe(true);
    // A DEBATE_VOTE proposal whose round CLOSED is finished too.
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rClosed' }, 'history', ctx)).toBe(true);
    // Still-active DEBATE_VOTE in an open round is NOT history.
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rVote' }, 'history', ctx)).toBe(false);
  });
});
