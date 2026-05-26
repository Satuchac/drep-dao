'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardFeeApi, boardProposalsApi, type PendingFee } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';

/**
 * §16 — board reviews submission-fee payments. The submitter pays the fee to the dedicated
 * address and provides the tx hash (they may have entered several — all are shown, each
 * verified on-chain). The reviewer **Approves** (→ Filtering, public) or **Rejects** (→
 * REJECTED) with feedback the submitter sees in a red FEEDBACK box. Self-hides when empty.
 */
export function FeeConfirmations({ onChange }: { onChange?: () => void }) {
  const [pending, setPending] = useState<PendingFee[]>([]);

  const load = useCallback(() => {
    boardFeeApi.pending().then(setPending).catch(() => setPending([]));
  }, []);
  useEffect(load, [load]);

  if (pending.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <h3 className="text-base font-semibold">Submission fees to confirm</h3>
      <p className="text-xs text-neutral-500">
        The platform checks each fee tx <strong>on-chain</strong> (did the paid amount reach the fee address?).
        <strong> Approve</strong> to admit the proposal into Filtering (public), or <strong>Reject</strong> with a
        reason the submitter will see.
      </p>
      <ul className="space-y-2">
        {pending.map((p) => (
          <PendingFeeRow key={p.id} p={p} onReviewed={() => { load(); onChange?.(); }} />
        ))}
      </ul>
    </section>
  );
}

function PendingFeeRow({ p, onReviewed }: { p: PendingFee; onReviewed: () => void }) {
  const { txUrl } = useExplorer();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = async (decision: 'APPROVE' | 'REJECT') => {
    setError(null);
    if (decision === 'REJECT' && !feedback.trim()) {
      setError('A reason is required to reject — the submitter will see it.');
      return;
    }
    setBusy(true);
    try {
      await boardProposalsApi.reviewFee(p.id, decision, feedback.trim() || undefined);
      onReviewed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'review failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
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

      {/* All tx hashes the submitter entered, each verified on-chain (latest last). */}
      <div className="mt-2 space-y-1">
        <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
          Submission fee tx{p.txs.length > 1 ? `s (${p.txs.length} entered)` : ''}:
        </div>
        {p.txs.length === 0 ? (
          <div className="text-xs text-amber-600">no tx hash provided</div>
        ) : (
          p.txs.map((t, i) => (
            <div key={t.hash} className="text-xs">
              <a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">
                {t.hash} ↗
              </a>
              {i === p.txs.length - 1 ? <span className="ml-1 text-[10px] uppercase text-neutral-400">latest</span> : null}
              <span className="ml-1 font-medium">
                {t.paid ? (
                  <span className="text-emerald-600">✓ paid {t.paidAda.toLocaleString()} ₳</span>
                ) : t.found ? (
                  <span className="text-red-600">✗ only {t.paidAda.toLocaleString()} ₳ to the fee address</span>
                ) : (
                  <span className="text-amber-600">⏳ not found on-chain</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Feedback shown to the submitter (red FEEDBACK box). Required to reject, optional to approve. */}
      <textarea
        className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        rows={2}
        placeholder="Feedback for the submitter (required to reject, optional to approve)"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={() => review('APPROVE')}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? 'Working…' : p.feeVerified.paid ? 'Approve — fee verified' : 'Approve anyway'}
        </button>
        <button
          disabled={busy}
          onClick={() => review('REJECT')}
          className="rounded border border-red-500 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
        >
          Reject
        </button>
      </div>
    </li>
  );
}
