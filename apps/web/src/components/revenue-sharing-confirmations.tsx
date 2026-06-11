'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardRevenueApi, type PendingRevenueSharing } from '@/lib/api';
import { ConfirmDialog } from './confirm-dialog';

/**
 * §3.4 — board to-do: funded proposals that declared commercial/revenue-sharing terms must have
 * those conditions verified by the board before the team can submit milestone POAs. Without this,
 * the team is blocked with "the revenue-sharing conditions must be verified by the board…".
 */
export function RevenueSharingConfirmations({ onChange }: { onChange?: () => void }) {
  const [pending, setPending] = useState<PendingRevenueSharing[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const load = useCallback(() => { boardRevenueApi.pending().then(setPending).catch(() => setPending([])); }, []);
  useEffect(load, [load]);

  if (pending.length === 0) return null;

  const verify = async (id: string) => {
    setConfirmId(null);
    setBusy(id);
    try { await boardRevenueApi.verify(id); load(); onChange?.(); }
    catch { /* leave the row in place */ } finally { setBusy(null); }
  };

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h3 className="text-base font-semibold">Revenue-sharing to verify ({pending.length})</h3>
      <p className="text-xs text-neutral-500">
        §3.4 — these funded proposals declared commercial / revenue-sharing terms. Verify the
        conditions so the team can start submitting milestone POAs.
      </p>
      <ul className="space-y-2">
        {pending.map((p) => (
          <li key={p.id} className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{p.publicId ? `${p.publicId} · ` : ''}{p.title}</span>
              <button
                onClick={() => setConfirmId(p.id)}
                disabled={busy === p.id}
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy === p.id ? 'Verifying…' : 'Verify revenue-sharing'}
              </button>
            </div>
            <div className="text-xs text-neutral-500">
              by {p.submitter ?? '—'}{p.categoryName ? ` · ${p.categoryName}` : ''}{p.roundNumber != null ? ` · Round #${p.roundNumber}` : ''}
            </div>
            {p.revenueSharingMd ? (
              <div className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs text-neutral-600 dark:bg-neutral-900/40 dark:text-neutral-300">
                {p.revenueSharingMd}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!confirmId}
        title="Verify revenue-sharing conditions?"
        message="Confirm the proposal's commercial / revenue-sharing terms are acceptable. This unblocks the team to submit milestone POAs. It can't be undone."
        confirmLabel="Verify"
        cancelLabel="Cancel"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => confirmId && verify(confirmId)}
      />
    </section>
  );
}
