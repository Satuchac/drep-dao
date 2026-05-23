'use client';

import { useEffect, useState } from 'react';
import { meApi } from '@/lib/api';
import { invalidateConfig } from '@/lib/explorer';

const OPTIONS = [
  { value: '', label: 'Platform default' },
  { value: 'cardanoscan', label: 'Cardanoscan' },
  { value: 'cexplorer', label: 'Cexplorer' },
  { value: 'adastat', label: 'AdaStat' },
  { value: 'custom', label: 'Custom…' },
];

/** §20 — personal preferences. Each member picks the block explorer used for their on-chain links. */
export function PreferencesPanel() {
  const [explorer, setExplorer] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    meApi.preferences().then((p) => { setExplorer(p.explorer ?? ''); setCustomUrl(p.explorerCustomTxUrl ?? ''); }).catch(() => undefined);
  }, []);

  const save = async () => {
    setError(null); setBusy(true); setSaved(false);
    try {
      await meApi.setPreferences({ explorer, explorerCustomTxUrl: explorer === 'custom' ? customUrl : '' });
      invalidateConfig(); // links re-resolve with the new choice
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">Preferences</h3>
      <p className="mb-2 text-sm text-neutral-500">Choose the block explorer used for your on-chain links across the platform.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          Block explorer{' '}
          <select
            value={explorer}
            onChange={(e) => { setExplorer(e.target.value); setSaved(false); }}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {explorer === 'custom' ? (
          <input
            value={customUrl}
            onChange={(e) => { setCustomUrl(e.target.value); setSaved(false); }}
            placeholder="https://my-explorer/tx/{hash}"
            className="w-72 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        ) : null}
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md border border-emerald-500 px-2.5 py-1 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved ? <span className="text-xs text-emerald-600">Saved ✓</span> : null}
      </div>
      {explorer === 'custom' ? (
        <p className="mt-1 text-xs text-neutral-500">Use <code>{'{hash}'}</code> as the transaction-hash placeholder.</p>
      ) : null}
      {error ? <div className="mt-1 text-sm text-red-600">{error}</div> : null}
    </section>
  );
}
