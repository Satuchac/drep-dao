import { describe, it, expect } from 'vitest';
import {
  GOVERNANCE_METADATA_LABEL,
  GovSubject,
  SUBJECT_TITLE,
  buildSubmissionMetadata,
  buildDocHashMetadata,
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
