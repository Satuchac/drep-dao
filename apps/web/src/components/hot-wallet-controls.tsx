'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryApi, type TreasuryOverview } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useExplorer } from '@/lib/explorer';

/**
 * §15.3 — board-only controls for the anchor hot wallet.
 *   • Top up: prepare an OPS multisig action (treasury → hot wallet) for any
 *     amount up to the platform cap (1000 ₳). Goes through the standard
 *     3-of-5 board signing flow.
 *   • Sweep: single-click move of all hot-wallet funds back into the
 *     multisig treasury. No threshold (the hot wallet is single-sig and
 *     funds-in-to-treasury is always a safe direction).
 *
 * Self-hides when not a board member or no hot wallet is configured.
 */
export function HotWalletControls({ onChange }: { onChange?: () => void }) {
  const { profile } = useAuth();
  const { txUrl } = useExplorer();
  const isBoard = !!profile?.roles.includes('BOARD');
  const [overview, setOverview] = useState<TreasuryOverview | null>(null);
  const [policy, setPolicy] = useState<{ minAda: number; topUpMaxAda: number; autoTopUpAda: number } | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [busy, setBusy] = useState<'topup' | 'sweep' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccess] = useState<string | null>(null);
  const [sweepTx, setSweepTx] = useState<string | null>(null);

  const load = useCallback(() => {
    treasuryApi.overview().then(setOverview).catch(() => setOverview(null));
    treasuryApi.hotWalletPolicy().then(setPolicy).catch(() => setPolicy(null));
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
    if (!confirm(`Move ALL ${balance.toLocaleString()} ₳ from the hot wallet back to the treasury multisig? This runs immediately (no multisig threshold).`)) return;
    setError(null); setSuccess(null); setBusy('sweep'); setSweepTx(null);
    try {
      const r = await treasuryApi.sweepHotWallet();
      setSuccess('Hot wallet swept to treasury.');
      setSweepTx(r.txHash);
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Hot wallet — board controls</div>
        <span className={`text-xs tabular-nums ${low ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-500'}`}>
          balance {balance.toLocaleString()} ₳ {low ? `(below ${policy.minAda} ₳)` : ''}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Top-ups go through the standard 3-of-5 board signing flow (they appear in <strong>Actions to sign</strong>).
        A sweep moves the full hot-wallet balance back into the treasury immediately (no threshold).
      </p>
      {low ? (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠ Hot wallet is below {policy.minAda} ₳ — the platform also auto-prepares a {policy.autoTopUpAda} ₳ top-up
          when this happens. You can prepare a different amount below.
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-end gap-2">
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
          onClick={sweep}
          title={balance <= 0 ? 'Hot wallet is empty.' : 'Move all hot-wallet funds back to the multisig treasury.'}
          className="rounded border border-neutral-400 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {busy === 'sweep' ? '…' : 'Sweep hot wallet → treasury'}
        </button>
      </div>
      {successMsg ? (
        <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
          {successMsg}
          {sweepTx ? <> · <a href={txUrl(sweepTx)} target="_blank" rel="noreferrer" className="font-mono underline">{sweepTx} ↗</a></> : null}
        </div>
      ) : null}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </section>
  );
}
