'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryApi, type TreasuryTx } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { useAuth } from '@/lib/auth-context';

/**
 * §15 — Treasury → Transactions: every on-chain tx that touched a treasury address,
 * enriched with the platform's context (submission fee → proposal/submitter; board
 * action → purpose/destination). Board members can add/edit a title + note for any
 * tx (e.g. label an anonymous deposit "Intersect — Milestone 1"). Incoming green,
 * outgoing red.
 */
export function TreasuryTransactions() {
  const { txUrl } = useExplorer();
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [txs, setTxs] = useState<TreasuryTx[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    treasuryApi
      .transactions()
      .then((r) => setTxs(r.transactions))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (txs === null) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-base font-semibold">Treasury transactions</h3>
        <p className="text-xs text-neutral-500">
          Every on-chain transaction that touched a treasury address (the multisig + its buckets),
          newest first. <span className="text-emerald-700 dark:text-emerald-400">Incoming</span> in green,{' '}
          <span className="text-red-700 dark:text-red-400">outgoing</span> in red.
          {isBoard ? ' Board members can add context with Edit.' : ''}
        </p>
      </div>

      {txs.length === 0 ? (
        <p className="text-sm text-neutral-500">No treasury transactions yet.</p>
      ) : (
        <ul className="space-y-2">
          {txs.map((t) => {
            const inbound = t.direction === 'IN';
            const displayLabel = t.annotationTitle || t.label;
            return (
              <li
                key={t.hash}
                className={`rounded-md border p-3 text-sm ${
                  inbound
                    ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'
                    : 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        inbound
                          ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100'
                          : 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100'
                      }`}
                    >
                      {inbound ? 'Incoming' : 'Outgoing'}
                    </span>
                    <span className="font-medium">{displayLabel}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`tabular-nums font-semibold ${
                        inbound ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {inbound ? '+' : '−'}
                      {t.amountAda.toLocaleString(undefined, { maximumFractionDigits: 6 })} ₳
                    </span>
                    {isBoard ? (
                      <button
                        onClick={() => setEditing(editing === t.hash ? null : t.hash)}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        {editing === t.hash ? 'Cancel' : 'Edit'}
                      </button>
                    ) : null}
                  </span>
                </div>

                {/* Platform-derived context (proposal / submitter / destination). */}
                {t.proposalTitle || t.submitter || t.destAddress ? (
                  <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                    {t.proposalTitle ? (
                      <>
                        Proposal:{' '}
                        {t.proposalPublicId ? (
                          <span className="rounded bg-neutral-100 px-1 font-mono text-[11px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                            {t.proposalPublicId}
                          </span>
                        ) : null}{' '}
                        <span className="font-medium">{t.proposalTitle}</span>{' '}
                      </>
                    ) : null}
                    {t.submitter ? (
                      <>
                        · paid by <span className="font-medium">{t.submitter}</span>{' '}
                      </>
                    ) : null}
                    {t.destAddress ? (
                      <>
                        · to <span className="break-all font-mono text-[11px]">{t.destAddress}</span>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {/* Board-provided note + attribution. */}
                {t.annotationNote || t.annotatedBy ? (
                  <div className="mt-1 rounded border border-neutral-200 bg-white/60 px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
                    {t.annotationNote ? <span className="text-neutral-700 dark:text-neutral-300">{t.annotationNote}</span> : null}
                    {t.annotatedBy ? (
                      <span className="text-neutral-500"> — context by {t.annotatedBy}</span>
                    ) : null}
                  </div>
                ) : null}

                {/* Board edit form. */}
                {editing === t.hash ? (
                  <AnnotateForm tx={t} onDone={() => { setEditing(null); load(); }} />
                ) : null}

                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                  <span>{new Date(t.time * 1000).toLocaleString()}</span>
                  <span>·</span>
                  <span className="break-all font-mono">
                    tx{' '}
                    <a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="underline">
                      {t.hash.slice(0, 16)}… ↗
                    </a>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AnnotateForm({ tx, onDone }: { tx: TreasuryTx; onDone: () => void }) {
  const [title, setTitle] = useState(tx.annotationTitle ?? '');
  const [description, setDescription] = useState(tx.annotationNote ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await treasuryApi.annotateTx(tx.hash, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
      <div>
        <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
          Title (overrides &ldquo;{tx.label}&rdquo;)
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={tx.label}
          maxLength={120}
          className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Note / context</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={'e.g. "Intersect transaction for Milestone 1"'}
          rows={2}
          maxLength={2000}
          className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
      </div>
      {err ? <div className="text-xs text-red-600">{err}</div> : null}
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? 'Saving…' : 'Save context'}
        </button>
        <span className="text-[11px] text-neutral-500">Clear both fields and save to remove.</span>
      </div>
    </div>
  );
}
