import { describe, it, expect } from 'vitest';
import { isFeeStageReject } from './proposal-state';

describe('isFeeStageReject (§3 — category "Not accepted" count)', () => {
  it('is true for a fee/submission-stage rejection (stage null, result not finalized)', () => {
    expect(isFeeStageReject('REJECTED', null, null)).toBe(true);
  });

  it('is false for a Debate & Vote rejection — stage null but the tally was finalized', () => {
    expect(isFeeStageReject('REJECTED', null, new Date())).toBe(false);
  });

  it('is false for a filtering rejection (stage FILTERING)', () => {
    expect(isFeeStageReject('REJECTED', 'FILTERING', null)).toBe(false);
  });

  it('is false for non-rejected proposals', () => {
    expect(isFeeStageReject('PENDING', null, null)).toBe(false);
    expect(isFeeStageReject('ACTIVE', 'FILTERING', null)).toBe(false);
    expect(isFeeStageReject('APPROVED', 'FUNDING', null)).toBe(false);
  });
});
