'use client';

import { useEffect, useState } from 'react';
import { treasuryApi, type TreasuryTx } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';

/**
 * §15 — Treasury → Transactions: every on-chain tx that touched a treasury address,
 * enriched with the platform's context (submission fee → proposal/submitter; board
 * action → purpose/destination). Incoming green, outgoing red.
 */
export function TreasuryTransactions() {
  const { txUrl } = useExplorer();
  const [txs, setTxs] = useState<TreasuryTx[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    treasuryApi
      .transactions()
      .then((r) => setTxs(r.transactions))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (txs === null) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-base font-semibold">Treasury transactions</h3>
        <p className="text-xs text-neutral-500">
          Every on-chain transaction that touched a treasury address (multisig sub-addresses + hot wallet),
          newest first. <span className="text-emerald-700 dark:text-emerald-400">Incoming</span> in green,{' '}
          <span className="text-red-700 dark:text-red-400">outgoing</span> in red; context is shown where the
          platform knows it.
        </p>
      </div>

      {txs.length === 0 ? (
        <p className="text-sm text-neutral-500">No treasury transactions yet.</p>
      ) : (
        <ul className="space-y-2">
          {txs.map((t) => {
            const inbound = t.direction === 'IN';
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
                    <span className="font-medium">{t.label}</span>
                  </span>
                  <span
                    className={`tabular-nums font-semibold ${
                      inbound ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {inbound ? '+' : '−'}
                    {t.amountAda.toLocaleString(undefined, { maximumFractionDigits: 6 })} ₳
                  </span>
                </div>

                {t.proposalTitle || t.submitter || t.destAddress ? (
                  <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                    {t.proposalTitle ? (
                      <>
                        Proposal: <span className="font-medium">{t.proposalTitle}</span>{' '}
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
