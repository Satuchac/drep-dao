'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardPledgeApi, type PendingPledge } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { useUrlNav } from '@/lib/use-url-nav';

/**
 * §3 — board reviews on-chain pledge payments. The team committed a pledge at
 * proposal creation and pasted the tx hash after the proposal reached FUNDING.
 * The platform verifies the payment ON-CHAIN against the pledge address (same
 * verifyPayment used for the submission fee). Board Approves (confirms +
 * unlocks milestone POAs) or Rejects (team re-pastes a corrected hash).
 *
 * Self-hides when empty.
 */
export function PledgeConfirmations({ onChange }: { onChange?: () => void }) {
  const { setParams } = useUrlNav();
  const [pending, setPending] = useState<PendingPledge[]>([]);

  const load = useCallback(() => {
    boardPledgeApi.pending().then(setPending).catch(() => setPending([]));
  }, []);
  useEffect(load, [load]);

  if (pending.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <h3 className="text-base font-semibold">Pledge payments to confirm ({pending.length})</h3>
      <p className="text-xs text-neutral-500">
        The platform checks each pledge tx <strong>on-chain</strong> (did the paid amount reach the pledge address?).
        <strong> Approve</strong> to confirm — milestone POAs unlock — or <strong>Reject</strong> with a reason; the
        team will paste a corrected hash. Open the proposal to read the team&apos;s return-method plan.
      </p>
      <ul className="space-y-2">
        {pending.map((p) => (
          <PendingPledgeRow key={p.id} p={p} onReviewed={() => { load(); onChange?.(); }} onOpen={() => setParams({ proposal: p.id })} />
        ))}
      </ul>
    </section>
  );
}

function PendingPledgeRow({ p, onReviewed, onOpen }: { p: PendingPledge; onReviewed: () => void; onOpen: () => void }) {
  const { txUrl } = useExplorer();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = async (decision: 'APPROVE' | 'REJECT') => {
    setError(null);
    if (decision === 'REJECT' && !feedback.trim()) {
      setError('A reason is required to reject — the team will see it.');
      return;
    }
    setBusy(true);
    try {
      await boardPledgeApi.review(p.id, decision, feedback.trim() || undefined);
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
        <button onClick={onOpen} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
          {p.title}
        </button>
        <span className="text-xs text-neutral-500">
          {p.publicId ? <span className="mr-2 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{p.publicId}</span> : null}
          {p.roundNumber != null ? `round #${p.roundNumber}` : ''}
          {p.submitter ? ` · by ${p.submitter}` : ''}
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        pledge {p.pledgeAmountAda.toLocaleString()} ₳
        {p.pledgeReturnMethod ? ' · open the proposal to read the return-method plan' : ''}
      </div>

      <div className="mt-2 text-xs">
        <div className="font-medium text-neutral-600 dark:text-neutral-400">Pledge tx:</div>
        {p.pledgeTxHash ? (
          <div>
            <a href={txUrl(p.pledgeTxHash)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">
              {p.pledgeTxHash} ↗
            </a>
            <span className="ml-2 font-medium">
              {p.verification.paid ? (
                <span className="text-emerald-600">✓ paid {p.verification.paidAda.toLocaleString()} ₳</span>
              ) : p.verification.found ? (
                <span className="text-red-600">✗ only {p.verification.paidAda.toLocaleString()} ₳ to the pledge address</span>
              ) : (
                <span className="text-amber-600">⏳ not found on-chain</span>
              )}
            </span>
          </div>
        ) : (
          <div className="text-amber-600">no tx hash submitted yet</div>
        )}
      </div>

      <textarea
        className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        rows={2}
        placeholder="Feedback for the team (required to reject, optional to approve)"
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
          {busy ? 'Working…' : p.verification.paid ? 'Approve — pledge verified' : 'Approve anyway'}
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
