'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryBucketsApi, type TreasuryBucket } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CopyButton } from './copy-button';

/**
 * §15.5 — labeled treasury buckets. Lists every bucket under the active
 * multisig with its live ₳ balance + a form (board-only) to add a new one.
 * Each bucket is a distinct on-chain address but spends with the same N
 * board signatures (see TreasuryBucketsService docstring).
 *
 * Self-hides until the multisig is assembled (no script to wrap).
 */
export function TreasuryBucketsPanel({ onChange }: { onChange?: () => void }) {
  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  const [data, setData] = useState<{ multisigConfigured: boolean; buckets: TreasuryBucket[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(() => {
    treasuryBucketsApi.list().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  if (!data) return null;
  if (!data.multisigConfigured) return null;

  const primary = data.buckets.find((b) => b.isPrimary);
  const labeled = data.buckets.filter((b) => !b.isPrimary);

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      await treasuryBucketsApi.create(label.trim());
      setLabel('');
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Treasury buckets ({data.buckets.length})</div>
        <span className="text-xs text-neutral-500">
          Labeled sub-addresses of the same multisig — same N-of-N signing requirement, distinct on-chain addresses.
        </span>
      </div>

      {/* Primary (bare multisig) always shown. */}
      {primary ? (
        <BucketRow b={primary} />
      ) : null}

      {/* Labeled buckets — collapsible to keep the panel compact when many. */}
      {labeled.length > 0 ? (
        <div className="mt-2 rounded border border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
          >
            <span>Labeled buckets ({labeled.length})</span>
            <span>{showHistory ? '▾ hide' : '▸ show'}</span>
          </button>
          {showHistory ? (
            <ul className="space-y-1 px-2 pb-2">
              {labeled.map((b) => <li key={b.id}><BucketRow b={b} /></li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Create form (board-only). */}
      {isBoard ? (
        <div className="mt-3 rounded border border-emerald-300 bg-emerald-50/40 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/20">
          <div className="font-semibold text-emerald-800 dark:text-emerald-200">Add a new bucket</div>
          <p className="mt-0.5 text-neutral-700 dark:text-neutral-300">
            Pick a clear label (e.g. &quot;Submission fees&quot;, &quot;Rewards&quot;, &quot;Funding&quot;). The platform derives
            a distinct on-chain address under the multisig.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Submission fees"
              maxLength={64}
              className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              disabled={busy || label.trim().length < 2}
              onClick={submit}
              className="rounded border border-emerald-500 px-2 py-0.5 text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
            >
              {busy ? '…' : 'Create bucket'}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </section>
  );
}

function BucketRow({ b }: { b: TreasuryBucket }) {
  return (
    <div className={`mt-1 rounded border p-2 text-xs ${
      b.isPrimary
        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
        : 'border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-800/30'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {b.label}
          {b.isPrimary ? <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">primary</span> : null}
        </span>
        <span className="tabular-nums text-neutral-700 dark:text-neutral-300">{b.balanceAda.toLocaleString()} ₳ on-chain</span>
      </div>
      <div className="mt-1 flex items-start gap-2">
        <div className="flex-1 break-all font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{b.bech32Address}</div>
        <CopyButton text={b.bech32Address} label="Copy" />
      </div>
      {b.createdBy ? <div className="mt-0.5 text-[10px] text-neutral-500">created by {b.createdBy}</div> : null}
    </div>
  );
}
