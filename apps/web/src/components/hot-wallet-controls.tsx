'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryApi, type TreasuryOverview, type HotWalletHistoryItem } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useExplorer } from '@/lib/explorer';
import { ConfirmDialog } from './confirm-dialog';

/**
 * §15.3 — board-only controls for the anchor hot wallet:
 *   • Top up: prepare an OPS multisig action (treasury → hot wallet) for any
 *     amount up to the platform cap (1000 ₳).
 *   • Sweep: single-click move of all hot-wallet funds back into the multisig.
 *   • History: collapsible list of every top-up + sweep with explorer links.
 *     Persisted so the data survives page refresh.
 *
 * Self-hides for non-board users.
 */
export function HotWalletControls({ onChange }: { onChange?: () => void }) {
  const { profile } = useAuth();
  const { txUrl } = useExplorer();
  const isBoard = !!profile?.roles.includes('BOARD');
  const [overview, setOverview] = useState<TreasuryOverview | null>(null);
  const [policy, setPolicy] = useState<{ minAda: number; topUpMaxAda: number; autoTopUpAda: number } | null>(null);
  const [history, setHistory] = useState<HotWalletHistoryItem[]>([]);
  const [amount, setAmount] = useState<string>('');
  const [busy, setBusy] = useState<'topup' | 'sweep' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccess] = useState<string | null>(null);
  const [confirmSweep, setConfirmSweep] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(() => {
    treasuryApi.overview().then(setOverview).catch(() => setOverview(null));
    treasuryApi.hotWalletPolicy().then(setPolicy).catch(() => setPolicy(null));
    treasuryApi.hotWalletHistory().then((r) => setHistory(r.items)).catch(() => setHistory([]));
  }, []);
  useEffect(load, [load]);

  if (!isBoard) return null;
  if (!overview || !policy) return null;
  if (!overview.hotWallet.address) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="font-semibold">Hot wallet</div>
        <div className="mt-1 text-xs text-amber-700">No anchor hot wallet is configured.</div>
      </section>
    );
  }
  const balance = overview.hotWallet.balanceAda;
  const low = balance < policy.minAda;
  const num = Number(amount);
  const validAmount = Number.isFinite(num) && num > 0 && num <= policy.topUpMaxAda;

  const topup = async () => {
    setError(null); setSuccess(null); setBusy('topup');
    try {
      await treasuryApi.prepareTopUp(num);
      setSuccess(`Top-up of ${num.toLocaleString()} ₳ prepared — awaiting 3-of-5 board signatures in Actions.`);
      setAmount('');
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };
  const sweep = async () => {
    setConfirmSweep(false);
    setError(null); setSuccess(null); setBusy('sweep');
    try {
      const r = await treasuryApi.sweepHotWallet();
      setSuccess(`Hot wallet swept to treasury — tx ${r.txHash.slice(0, 12)}…`);
      // Refresh history so the new sweep appears at the top.
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">Hot wallet — board controls</div>
          <span className={`text-xs tabular-nums ${low ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-500'}`}>
            balance {balance.toLocaleString()} ₳ {low ? `(below ${policy.minAda} ₳)` : ''}
          </span>
        </div>
        <p className="text-xs text-neutral-500">
          Top-ups go through the standard 3-of-5 board signing flow (they appear in <strong>Actions to sign</strong>).
          A sweep moves the full hot-wallet balance back into the treasury immediately (no threshold).
          A few ADA may remain at the hot wallet after a sweep due to the Cardano tx fee and minUTxO requirement.
        </p>
        {low ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            ⚠ Hot wallet is below {policy.minAda} ₳ — the platform also auto-prepares a {policy.autoTopUpAda} ₳ top-up
            when this happens. You can prepare a different amount below.
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs">
            Top-up amount (₳, max {policy.topUpMaxAda.toLocaleString()})
            <input
              type="number"
              min={1}
              max={policy.topUpMaxAda}
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setSuccess(null); }}
              placeholder={String(policy.autoTopUpAda)}
              className="mt-0.5 block w-32 rounded-md border border-neutral-300 px-2 py-1 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <button
            disabled={!validAmount || busy !== null}
            onClick={topup}
            className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
          >
            {busy === 'topup' ? '…' : 'Prepare top-up'}
          </button>
          <button
            disabled={balance <= 0 || busy !== null}
            onClick={() => setConfirmSweep(true)}
            title={balance <= 0 ? 'Hot wallet is empty.' : 'Move all hot-wallet funds back to the multisig treasury.'}
            className="rounded border border-neutral-400 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {busy === 'sweep' ? '…' : 'Sweep hot wallet → treasury'}
          </button>
        </div>
        {successMsg ? <div className="text-xs text-emerald-700 dark:text-emerald-300">{successMsg}</div> : null}
        {error ? <div className="text-xs text-red-600">{error}</div> : null}

        {/* §15.3 — collapsible TX history. Persisted server-side so refreshing
            the page (or another board member loading it) sees the same list. */}
        <div className="rounded border border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
          >
            <span>Hot wallet ↔ treasury history ({history.length})</span>
            <span>{showHistory ? '▾ hide' : '▸ show'}</span>
          </button>
          {showHistory ? (
            history.length === 0 ? (
              <div className="px-2 pb-2 text-[11px] text-neutral-500">No transactions yet.</div>
            ) : (
              <ul className="space-y-1 px-2 pb-2 text-xs">
                {history.map((h) => (
                  <li key={h.id} className="rounded border border-neutral-200 bg-neutral-50/60 p-1.5 dark:border-neutral-800 dark:bg-neutral-800/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          h.direction === 'TOP_UP'
                            ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                        }`}>
                          {h.direction === 'TOP_UP' ? 'TOP-UP · treasury → hot' : 'SWEEP · hot → treasury'}
                        </span>
                        <span className="tabular-nums">{h.amountAda.toLocaleString()} ₳</span>
                      </span>
                      <span className="text-[11px] text-neutral-500">{new Date(h.at).toLocaleString()}</span>
                    </div>
                    {h.txHash ? (
                      <div className="mt-0.5 break-all">
                        tx <a href={txUrl(h.txHash)} target="_blank" rel="noreferrer" className="font-mono text-emerald-700 underline dark:text-emerald-400">{h.txHash} ↗</a>
                      </div>
                    ) : null}
                    {h.initiatedBy ? <div className="text-[11px] text-neutral-500">initiated by {h.initiatedBy}</div> : null}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </section>

      <ConfirmDialog
        open={confirmSweep}
        title="Sweep hot wallet?"
        tone="danger"
        confirmLabel="Sweep to treasury"
        message={
          <>
            Move <strong>{balance.toLocaleString()} ₳</strong> from the hot wallet back to the treasury multisig.
            This runs immediately (no multisig threshold). A small amount may remain at the hot wallet because of the
            Cardano tx fee and minUTxO requirement.
          </>
        }
        onConfirm={sweep}
        onCancel={() => setConfirmSweep(false)}
      />
    </>
  );
}
