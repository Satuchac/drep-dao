import { describe, it, expect } from 'vitest';
import {
  GOVERNANCE_METADATA_LABEL,
  GovSubject,
  SUBJECT_TITLE,
  VotingStyle,
  buildSubmissionMetadata,
  buildDocHashMetadata,
  buildResultMetadata,
} from './governance-metadata';

describe('buildSubmissionMetadata (§3 — slimmed accepted-proposal anchor)', () => {
  const base = {
    title: "Dave's great tool",
    proposalId: 'R6-P3',
    round: 6,
    submitter: 'drep1abc',
    submitterType: 'DRep' as const,
    feeAda: 50,
  };

  it('uses the proposal title (not a generic label) and drops subject/proofHash', () => {
    const meta = buildSubmissionMetadata(base)[GOVERNANCE_METADATA_LABEL];
    expect(meta.title).toBe("Dave's great tool");
    expect((meta as Record<string, unknown>).subject).toBeUndefined();
    expect((meta as Record<string, unknown>).proofHash).toBeUndefined();
  });

  it('fee carries only ada + (optional) txHash — no required/paid flags', () => {
    const withTx = buildSubmissionMetadata({ ...base, feeTxHash: 'tx123' })[GOVERNANCE_METADATA_LABEL];
    expect(withTx.fee).toEqual({ ada: 50, txHash: 'tx123' });
    expect(Object.keys(withTx.fee).sort()).toEqual(['ada', 'txHash']);

    const noTx = buildSubmissionMetadata(base)[GOVERNANCE_METADATA_LABEL];
    expect(noTx.fee).toEqual({ ada: 50 });
    expect('txHash' in noTx.fee).toBe(false);
    expect('required' in noTx.fee).toBe(false);
    expect('paid' in noTx.fee).toBe(false);
  });

  it('rounds the fee to an integer (Cardano metadata forbids floats)', () => {
    const meta = buildSubmissionMetadata({ ...base, feeAda: 49.7 })[GOVERNANCE_METADATA_LABEL];
    expect(meta.fee.ada).toBe(50);
    expect(Number.isInteger(meta.fee.ada)).toBe(true);
  });

  it('defaults to accepted; carries a reason only when rejected', () => {
    const accepted = buildSubmissionMetadata(base)[GOVERNANCE_METADATA_LABEL];
    expect(accepted.outcome).toBe('accepted');
    expect(accepted.reason).toBeUndefined();

    const rejected = buildSubmissionMetadata({ ...base, outcome: 'rejected', reason: 'fee unpaid' })[GOVERNANCE_METADATA_LABEL];
    expect(rejected.outcome).toBe('rejected');
    expect(rejected.reason).toBe('fee unpaid');
  });

  it('omits round when not provided', () => {
    const meta = buildSubmissionMetadata({ ...base, round: null })[GOVERNANCE_METADATA_LABEL];
    expect('round' in meta).toBe(false);
  });

  it('carries the requested funding amount (rounded) when provided, omits it otherwise', () => {
    const withReq = buildSubmissionMetadata({ ...base, requestedAda: 1500.4 })[GOVERNANCE_METADATA_LABEL];
    expect(withReq.requested).toBe(1500);
    expect(Number.isInteger(withReq.requested as number)).toBe(true);

    const noReq = buildSubmissionMetadata(base)[GOVERNANCE_METADATA_LABEL];
    expect('requested' in noReq).toBe(false);
  });
});

describe('buildDocHashMetadata (§8.1 — post-debate content fingerprint)', () => {
  const base = {
    title: "Dave's great tool",
    proposalId: 'R6-P3',
    round: 6,
    hashAlgo: 'SHA-256',
    contentHash: 'a'.repeat(64),
    frozenAt: '2026-06-15T00:00:00.000Z',
  };

  it('is tagged with the proposal_doc subject + the named hash function + hash', () => {
    const meta = buildDocHashMetadata(base)[GOVERNANCE_METADATA_LABEL];
    expect(meta.subject).toBe(GovSubject.PROPOSAL_DOC);
    expect(meta.subject).toBe('proposal_doc');
    expect(meta.hashAlgo).toBe('SHA-256');
    expect(meta.contentHash).toBe('a'.repeat(64));
    expect(meta.title).toBe("Dave's great tool");
    expect(meta.proposalId).toBe('R6-P3');
    expect(meta.round).toBe(6);
    expect(meta.frozenAt).toBe('2026-06-15T00:00:00.000Z');
  });

  it('omits round when not provided', () => {
    const meta = buildDocHashMetadata({ ...base, round: null })[GOVERNANCE_METADATA_LABEL];
    expect('round' in meta).toBe(false);
  });

  it('has a human-readable subject title registered', () => {
    expect(SUBJECT_TITLE[GovSubject.PROPOSAL_DOC]).toBe('Proposal content fingerprint (post-debate)');
  });
});

describe('buildResultMetadata (§4 — on-chain voting-power precision)', () => {
  const base = {
    subject: GovSubject.INTERNAL,
    applicant: 'Internal proposal',
    outcome: 'APPROVED',
  };

  it('BALANCED: keeps fractional power precise as 2-decimal strings (not rounded to integers)', () => {
    const meta = buildResultMetadata({
      ...base,
      style: VotingStyle.BALANCED,
      votes: [
        { drep: 'drep1alice', vote: 'YES', power: 6.09 },
        { drep: 'drep1dave', vote: 'YES', power: 5.85 },
        { drep: 'drep1erin', vote: 'ABSTAIN', power: 4.23 },
      ],
      yes: 11.94,
      no: 0,
      threshold: 67,
      totalPower: 25.08,
    })[GOVERNANCE_METADATA_LABEL];
    expect(meta.votes[0].power).toBe('6.09');
    expect(meta.votes[1].power).toBe('5.85');
    expect(meta.tally.yes).toBe('11.94');
    expect(meta.tally.totalPower).toBe('25.08');
    expect(meta.tally.threshold).toBe(67); // a percentage — stays a whole number
    expect(meta.tally.unit).toBe('power');
  });

  it('ONCHAIN: also emits precise 2-decimal power strings', () => {
    const meta = buildResultMetadata({
      ...base,
      style: VotingStyle.ONCHAIN,
      votes: [{ drep: 'drep1alice', vote: 'YES', power: 67827.34 }],
      yes: 67827.34,
      no: 0,
      threshold: 67,
      totalPower: 67827.34,
    })[GOVERNANCE_METADATA_LABEL];
    expect(meta.votes[0].power).toBe('67827.34');
    expect(meta.tally.yes).toBe('67827.34');
  });

  it('1P1V: tallies stay whole vote counts (integers, unit "1 member - 1 vote")', () => {
    const meta = buildResultMetadata({
      ...base,
      style: VotingStyle.ONE_PERSON_ONE_VOTE,
      votes: [{ drep: 'drep1alice', vote: 'YES' }],
      yes: 3,
      no: 1,
      threshold: 3,
    })[GOVERNANCE_METADATA_LABEL];
    expect(meta.tally.yes).toBe(3);
    expect(meta.tally.no).toBe(1);
    expect(meta.tally.unit).toBe('1 member - 1 vote');
    expect('totalPower' in meta.tally).toBe(false);
  });
});
