'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardFeeApi, boardProposalsApi, type PendingFee } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';

/**
 * §16 — board confirms submission-fee payments. The submitter pays the fee to the
 * dedicated fee address and provides the tx hash; a board member opens it in the
 * explorer, checks the amount, and confirms (moving the proposal into Filtering).
 * Self-hides when nothing is pending.
 */
export function FeeConfirmations({ onChange }: { onChange?: () => void }) {
  const { txUrl } = useExplorer();
  const [pending, setPending] = useState<PendingFee[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    boardFeeApi.pending().then(setPending).catch(() => setPending([]));
  }, []);
  useEffect(load, [load]);

  if (pending.length === 0) return null;

  const confirm = async (id: string) => {
    setError(null);
    setBusy(id);
    try {
      await boardProposalsApi.confirmFee(id);
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'confirm failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <h3 className="text-base font-semibold">Submission fees to confirm</h3>
      <p className="text-xs text-neutral-500">
        The platform checks each fee tx <strong>on-chain</strong> (did the paid amount reach the fee address?) and
        shows the result below. Confirm to admit the proposal into Filtering — and make it publicly visible.
      </p>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <ul className="space-y-2">
        {pending.map((p) => (
          <li key={p.id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{p.title}</span>
              <span className="text-xs text-neutral-500">
                round #{p.roundNumber} · {p.isCommercial ? 'commercial' : 'open-source'}
              </span>
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              fee {p.submissionFeeAda.toLocaleString()} ₳ of {p.requestedAmountAda.toLocaleString()} ₳ requested
              {p.submitter ? ` · by ${p.submitter}` : ''}
            </div>
            <div className="mt-1 text-xs">
              {p.submissionFeeTxHash ? (
                <a href={txUrl(p.submissionFeeTxHash)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">
                  {p.submissionFeeTxHash} ↗
                </a>
              ) : (
                <span className="text-amber-600">no tx hash provided</span>
              )}
            </div>
            {/* §16 — platform's on-chain verification of the fee payment. */}
            <div className="mt-1 text-xs font-medium">
              {p.feeVerified.paid ? (
                <span className="text-emerald-600">✓ Fee verified on-chain — {p.feeVerified.paidAda.toLocaleString()} ₳ paid to the fee address</span>
              ) : p.feeVerified.found ? (
                <span className="text-red-600">✗ Tx found, but only {p.feeVerified.paidAda.toLocaleString()} ₳ reached the fee address (need {p.submissionFeeAda.toLocaleString()} ₳)</span>
              ) : (
                <span className="text-amber-600">⏳ Not found on-chain yet (unconfirmed, wrong hash, or paid elsewhere)</span>
              )}
            </div>
            <button
              disabled={busy === p.id}
              onClick={() => confirm(p.id)}
              className="mt-2 rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              {busy === p.id ? 'Confirming…' : p.feeVerified.paid ? 'Confirm fee received' : 'Confirm anyway'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
