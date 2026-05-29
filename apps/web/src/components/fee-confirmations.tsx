'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardFeeApi, boardProposalsApi, type FeeHistoryPage, type FeeHistoryRow, type PendingFee } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { fmtDateTime } from './round-ui';
import { useUrlNav } from '@/lib/use-url-nav';

const HISTORY_PAGE = 20;

/**
 * §16 — board reviews submission-fee payments. The submitter pays the fee to the dedicated
 * address and provides the tx hash (they may have entered several — all are shown, each
 * verified on-chain). The reviewer **Approves** (→ Filtering, public) or **Rejects** (→
 * REJECTED) with feedback the submitter sees in a red FEEDBACK box.
 *
 * With `history` enabled, also renders the **decided** fee reviews (approved + fee-rejected)
 * with a pager (default 20/page, newest first) — so the board can look back at past
 * decisions without scrolling the live proposal pages.
 */
export function FeeConfirmations({ onChange, history = false }: { onChange?: () => void; history?: boolean }) {
  const [pending, setPending] = useState<PendingFee[]>([]);

  const load = useCallback(() => {
    boardFeeApi.pending().then(setPending).catch(() => setPending([]));
  }, []);
  useEffect(load, [load]);

  if (pending.length === 0 && !history) return null;

  return (
    <>
      {pending.length > 0 ? (
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
      ) : null}
      {history ? <FeeHistory /> : null}
    </>
  );
}

/**
 * Paginated history of decided fee reviews (approved + fee-rejected). Default
 * page size is 20 (matches the user's request); pager appears once total > 20.
 */
function FeeHistory() {
  const { setParams } = useUrlNav();
  const { txUrl } = useExplorer();
  const [page, setPage] = useState<FeeHistoryPage | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    boardFeeApi.history(HISTORY_PAGE, offset).then(setPage).catch(() => setPage(null));
  }, [offset]);
  if (!page) return null;

  const start = page.rows.length === 0 ? 0 : page.offset + 1;
  const end = page.offset + page.rows.length;
  const last = Math.floor((page.total - 1) / HISTORY_PAGE) * HISTORY_PAGE;

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Submission-fee history</h3>
        <span className="text-xs text-neutral-500">
          {page.total === 0 ? 'No decisions yet.' : `Showing ${start}–${end} of ${page.total}`}
        </span>
      </div>
      {page.rows.length === 0 ? null : (
        <ul className="space-y-2">
          {page.rows.map((r) => (
            <HistoryRow
              key={r.id}
              r={r}
              onOpen={() => setParams({ proposal: r.id })}
              onChanged={() => boardFeeApi.history(HISTORY_PAGE, offset).then(setPage).catch(() => undefined)}
            />
          ))}
        </ul>
      )}
      {page.total > HISTORY_PAGE ? (
        <div className="flex items-center justify-between text-xs">
          <div className="flex gap-1">
            <button onClick={() => setOffset(0)} disabled={offset === 0} className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-40 dark:border-neutral-700">⏮ First</button>
            <button onClick={() => setOffset(Math.max(0, offset - HISTORY_PAGE))} disabled={offset === 0} className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-40 dark:border-neutral-700">◀ Previous</button>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setOffset(Math.min(last, offset + HISTORY_PAGE))} disabled={offset >= last} className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-40 dark:border-neutral-700">Next ▶</button>
            <button onClick={() => setOffset(last)} disabled={offset >= last} className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-40 dark:border-neutral-700">Last ⏭</button>
          </div>
        </div>
      ) : null}
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

/**
 * One decided fee-review row. While `canChange` (round still in SUBMISSION) the
 * board can flip the decision: an approved row gets an "Undo / change to REJECT"
 * action that opens a reason textarea; a rejected row gets "Approve now" that
 * lets through an optional note. Backend re-anchors on each APPROVE so the
 * latest on-chain proof matches the latest decision.
 */
function HistoryRow({ r, onOpen, onChanged }: { r: FeeHistoryRow; onOpen: () => void; onChanged: () => void }) {
  const { txUrl } = useExplorer();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = async (decision: 'APPROVE' | 'REJECT') => {
    setError(null);
    if (decision === 'REJECT' && !feedback.trim()) {
      setError('A reason is required when rejecting.');
      return;
    }
    setBusy(true);
    try {
      await boardProposalsApi.reviewFee(r.id, decision, feedback.trim() || undefined);
      setOpen(false);
      setFeedback('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`rounded-md border p-3 text-sm ${
      r.decision === 'APPROVED'
        ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'
        : 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onOpen} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
          {r.title}
        </button>
        <span className="flex items-center gap-2 text-xs text-neutral-500">
          {r.publicId ? <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{r.publicId}</span> : null}
          {r.roundNumber != null ? <span>round #{r.roundNumber}</span> : null}
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            r.decision === 'APPROVED'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
          }`}>
            {r.decision === 'APPROVED' ? '✓ APPROVED' : '✗ REJECTED'}
          </span>
          {r.canChange ? (
            <button
              type="button"
              onClick={() => { setOpen((v) => !v); setError(null); }}
              className="rounded-md border border-neutral-400 px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
              title={r.decision === 'APPROVED'
                ? 'Round is still in SUBMISSION — you can undo this approval (changes to REJECTED).'
                : 'Round is still in SUBMISSION — you can change this rejection to APPROVED.'}
            >
              {open ? 'Cancel change' : r.decision === 'APPROVED' ? '↩ Undo / change to REJECT' : '✓ Change to APPROVE'}
            </button>
          ) : (
            <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" title="Round has moved past SUBMISSION — decisions are now frozen.">locked</span>
          )}
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        fee {r.submissionFeeAda.toLocaleString()} ₳ · {r.isCommercial ? 'commercial' : 'open-source'}
        {r.submitter ? ` · by ${r.submitter}` : ''}
        {r.submittedAt ? ` · submitted ${fmtDateTime(r.submittedAt)}` : ''}
      </div>
      {r.submissionFeeTxHash ? (
        <div className="mt-1 text-xs">
          <span className="text-neutral-500">tx: </span>
          <a href={txUrl(r.submissionFeeTxHash)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">
            {r.submissionFeeTxHash} ↗
          </a>
        </div>
      ) : null}
      {r.feedback ? (
        <div className="mt-2 rounded border border-neutral-200 bg-white/60 p-1.5 text-xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">
            {r.decision === 'APPROVED' ? 'Approval note' : 'Rejection reason'}
          </div>
          <div className="mt-0.5 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{r.feedback}</div>
        </div>
      ) : null}
      {open && r.canChange ? (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
          <div className="font-semibold text-amber-800 dark:text-amber-200">
            {r.decision === 'APPROVED' ? 'Change this approval to a REJECTION?' : 'Change this rejection to an APPROVAL?'}
          </div>
          <p className="mt-0.5 text-amber-700 dark:text-amber-300">
            The proposal will move {r.decision === 'APPROVED' ? 'back to REJECTED (stage cleared)' : 'into FILTERING (the public stage)'}. A fresh on-chain acceptance anchor is written on every approval so the latest decision is what shows on-chain. Allowed only while the round hasn&apos;t moved past SUBMISSION.
          </p>
          <textarea
            className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            rows={2}
            placeholder={r.decision === 'APPROVED' ? 'Reason for changing to REJECTED (required)' : 'Optional approval note'}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          {error ? <div className="mt-1 text-red-600">{error}</div> : null}
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => flip(r.decision === 'APPROVED' ? 'REJECT' : 'APPROVE')}
              className={`rounded border px-2.5 py-1 disabled:opacity-40 ${
                r.decision === 'APPROVED'
                  ? 'border-red-500 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950'
                  : 'border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950'
              }`}
            >
              {busy ? 'Working…' : r.decision === 'APPROVED' ? 'Reject now' : 'Approve now'}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
