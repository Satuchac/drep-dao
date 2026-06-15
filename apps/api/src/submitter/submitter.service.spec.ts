import { describe, it, expect, vi } from 'vitest';

// Avoid loading the CSL / merit heavy modules — we only test pure resolution logic.
vi.mock('../cardano/anchor.service', () => ({ AnchorService: class {} }));
vi.mock('../merit/merit.service', () => ({ MeritService: class {} }));

import { SubmitterService } from './submitter.service';

// Minimal fake Prisma exposing just what resolveLinkedMember touches.
function svcWith(drepFindFirst: ReturnType<typeof vi.fn>) {
  const prisma = { drep: { findFirst: drepFindFirst } };
  return new SubmitterService(prisma as never);
}

describe('SubmitterService — cross-wallet link resolution (§2)', () => {
  it('resolves an explicit forward link (submitter declared a DAO member) as cross-wallet', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({
      drepIdOnchain: 'drep1member', userId: 'u-member', user: { displayName: 'Alice' },
    });
    const res = await (svcWith(findFirst) as never as { resolveLinkedMember: (u: string, l: string | null) => Promise<unknown> })
      .resolveLinkedMember('u-submitter', 'drep1member');
    expect(res).toEqual({ drepIdOnchain: 'drep1member', name: 'Alice', crossWallet: true });
    // Explicit hit short-circuits — the same-wallet query is never run.
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to the same-wallet member when there is no explicit link', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null) // explicit
      .mockResolvedValueOnce({ drepIdOnchain: 'drep1self', user: { displayName: 'Bob' } }); // same account
    const res = await (svcWith(findFirst) as never as { resolveLinkedMember: (u: string, l: string | null) => Promise<unknown> })
      .resolveLinkedMember('u-bob', null);
    expect(res).toEqual({ drepIdOnchain: 'drep1self', name: 'Bob', crossWallet: false });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('marks an explicit link as same-wallet when it points back at the same account', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({
      drepIdOnchain: 'drep1self', userId: 'u-same', user: { displayName: 'Cara' },
    });
    const res = await (svcWith(findFirst) as never as { resolveLinkedMember: (u: string, l: string | null) => Promise<{ crossWallet: boolean }> })
      .resolveLinkedMember('u-same', null);
    expect(res.crossWallet).toBe(false);
  });

  it('returns null when neither an explicit nor a same-wallet member exists', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const res = await (svcWith(findFirst) as never as { resolveLinkedMember: (u: string, l: string | null) => Promise<unknown> })
      .resolveLinkedMember('u-x', null);
    expect(res).toBeNull();
  });
});
