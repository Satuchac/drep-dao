'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardActionMessage } from '@drep-dao/cardano';
import { treasuryApi, type BoardAction } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** §15.3 — pending board/treasury actions the platform prepared, awaiting 3-of-5 approval. */
export function BoardActions({ onChange }: { onChange?: () => void }) {
  const { profile, signMessage } = useAuth();
  const [actions, setActions] = useState<BoardAction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    treasuryApi
      .boardActions()
      .then((r) => setActions(r.actions))
      .catch(() => setActions([]));
  }, []);
  useEffect(load, [load]);

  const approve = async (a: BoardAction) => {
    setError(null);
    setBusy(a.id);
    try {
      let sig: { signature: string; signingKey: string; ts: string } | undefined;
      const ts = new Date().toISOString();
      if (profile) {
        const message = boardActionMessage({
          actionId: a.id,
          kind: a.kind,
          amountAda: a.amountAda ?? 0,
          voterStakeAddress: profile.user.stakeAddress,
          ts,
        });
        const s = await signMessage(message);
        if (s) sig = { signature: s.signature, signingKey: s.key, ts };
      }
      await treasuryApi.approveAction(a.id, sig ?? {});
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setBusy(null);
    }
  };

  if (actions.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <h3 className="text-base font-semibold">Actions to sign</h3>
      <p className="text-xs text-neutral-500">
        The platform prepared these treasury/hot-wallet actions. Each needs {actions[0]?.threshold ?? 3} of 5 board
        signatures before it can be executed on-chain.
      </p>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{a.description ?? a.kind}</span>
              {a.amountAda != null ? <span className="tabular-nums text-neutral-500">{a.amountAda.toLocaleString()} ₳</span> : null}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              {a.approvals}/{a.threshold} approvals{a.mineApproved ? ' · you approved ✓' : ''}
            </div>
            <button
              disabled={busy === a.id || a.mineApproved}
              onClick={() => approve(a)}
              className="mt-2 rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              {a.mineApproved ? 'Approved' : busy === a.id ? 'Signing…' : 'Approve & sign'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
