import { describe, it, expect } from 'vitest';
import { matchesDvMode } from './proposal-lifecycle';

describe('matchesDvMode (§7/§8 — Debate & Vote To do / Recent / History)', () => {
  // rVote: round in VOTE (votable). rDebate: round in DEBATE (D&V phase, voting not open).
  // rFilter: round still in FILTERING. rClosed: round CLOSED.
  const ctx = {
    voteRoundIds: new Set(['rVote']),
    dvPhaseRoundIds: new Set(['rVote', 'rDebate']),
    closedRoundIds: new Set(['rClosed']),
  };

  it('To do = in DEBATE_VOTE and the round is in VOTE (votable now)', () => {
    const votable = { stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rVote' };
    expect(matchesDvMode(votable, 'pending', ctx)).toBe(true);
    expect(matchesDvMode(votable, 'recent', ctx)).toBe(true); // also shows in Recent

    const debating = { stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rDebate' };
    expect(matchesDvMode(debating, 'pending', ctx)).toBe(false); // voting not open yet
    expect(matchesDvMode(debating, 'recent', ctx)).toBe(true);   // ...but it is "Recent" (DEBATE phase)
  });

  it('BUG FIX: a proposal that passed filtering but whose round is STILL in FILTERING is NOT in D&V', () => {
    // It belongs to the Filtering panel (filtering vote still changeable) — without the phase gate
    // it would show in both panels' Recent at once.
    const passedButFilteringRound = { stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rFilter' };
    expect(matchesDvMode(passedButFilteringRound, 'recent', ctx)).toBe(false);
    expect(matchesDvMode(passedButFilteringRound, 'pending', ctx)).toBe(false);
    expect(matchesDvMode(passedButFilteringRound, 'history', ctx)).toBe(false);
  });

  it('Recent never includes finished proposals', () => {
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'REJECTED', roundId: 'rVote' }, 'recent', ctx)).toBe(false);
  });

  it('a proposal rejected at the FILTERING stage never appears in D&V History', () => {
    const filteringRejected = { stage: 'FILTERING', status: 'REJECTED', roundId: 'rFilter' };
    expect(matchesDvMode(filteringRejected, 'history', ctx)).toBe(false);
    expect(matchesDvMode(filteringRejected, 'recent', ctx)).toBe(false);
    expect(matchesDvMode(filteringRejected, 'pending', ctx)).toBe(false);
  });

  it('History = finished proposals that actually reached D&V', () => {
    expect(matchesDvMode({ stage: null, status: 'REJECTED', roundId: 'rVote' }, 'history', ctx)).toBe(true);
    expect(matchesDvMode({ stage: 'FUNDING', status: 'APPROVED', roundId: 'rVote' }, 'history', ctx)).toBe(true);
    expect(matchesDvMode({ stage: 'FUNDING', status: 'COMPLETE', roundId: 'rVote' }, 'history', ctx)).toBe(true);
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rClosed' }, 'history', ctx)).toBe(true);
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rVote' }, 'history', ctx)).toBe(false);
  });
});
