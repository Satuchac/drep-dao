'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryApi, treasuryBucketsApi, type TreasuryBucket } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * §15.5 — internal transfer: move ADA between the DAO's own treasury
 * addresses (the primary multisig + its labeled buckets). Both ends are
 * picked from dropdowns — no free-form address, so funds can never leave
 * the DAO through this form. Source ≠ destination is enforced. Follows the
 * same 3-of-5 signing flow and shows as INTERNAL (yellow) in the history.
 *
 * Self-hides for non-board users and when there are fewer than two treasury
 * addresses (nothing to transfer between).
 */
export function InternalTransferPanel({ onChange }: { onChange?: () => void }) {
  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  const [buckets, setBuckets] = useState<TreasuryBucket[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(() => {
    treasuryBucketsApi.list().then((r) => setBuckets(r.buckets)).catch(() => setBuckets([]));
  }, []);
  useEffect(load, [load]);

  if (!isBoard) return null;
  // One address = nothing to transfer between; the panel appears once the
  // board configures a second bucket.
  if (buckets.length < 2) return null;

  const source = buckets.find((b) => b.id === sourceId) ?? buckets.find((b) => b.isPrimary) ?? buckets[0];
  // Destination: anything except the chosen source (uniqueness by construction).
  const destOptions = buckets.filter((b) => b.id !== source.id);
  const dest = destOptions.find((b) => b.id === destId) ?? destOptions[0];

  const amt = Number(amount);
  const validAmount = Number.isFinite(amt) && amt > 0;
  const insufficient = validAmount && amt > source.balanceAda;
  const canSubmit = validAmount && !!dest && !busy;

  const submit = async () => {
    setError(null); setSuccess(null); setBusy(true);
    try {
      await treasuryApi.prepareInternalTransfer({ sourceBucketId: source.id, destBucketId: dest.id, amountAda: amt });
      setSuccess(`Internal transfer of ${amt.toLocaleString()} ₳ (${source.label} → ${dest.label}) queued — needs 3-of-5 board signatures in Signatures.`);
      setAmount('');
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const selectCls = 'w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Internal transfers</div>
        <div className="text-xs text-neutral-500">moves between the DAO&apos;s own addresses — funds never leave the treasury</div>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        Pick a source and a destination treasury address (no manual address entry). The transfer needs 3-of-5
        board signatures and shows as <span className="text-amber-700 dark:text-amber-400">Internal</span> in the
        transaction history.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_8rem]">
        <label className="block text-xs text-neutral-600 dark:text-neutral-400">
          From
          <select value={source.id} onChange={(e) => { setSourceId(e.target.value); if (e.target.value === dest?.id) setDestId(''); }} className={selectCls}>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>{b.label} — {b.balanceAda.toLocaleString()} ₳</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-neutral-600 dark:text-neutral-400">
          To
          <select value={dest?.id ?? ''} onChange={(e) => setDestId(e.target.value)} className={selectCls}>
            {destOptions.map((b) => (
              <option key={b.id} value={b.id}>{b.label} — {b.balanceAda.toLocaleString()} ₳</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-neutral-600 dark:text-neutral-400">
          Amount (₳)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className={selectCls}
          />
        </label>
      </div>
      {insufficient ? (
        <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          ⚠ {source.label} currently holds {source.balanceAda.toLocaleString()} ₳ — the transfer can be queued, but
          it won&apos;t broadcast until the balance covers it.
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? 'Queueing…' : 'Queue internal transfer'}
        </button>
      </div>
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      {success ? <div className="mt-1 text-xs text-emerald-600">{success}</div> : null}
    </section>
  );
}
