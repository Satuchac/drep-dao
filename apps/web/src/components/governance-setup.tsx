'use client';

import { useEffect, useState } from 'react';
import { governanceApi, type GovParam } from '@/lib/api';
import { invalidateConfig } from '@/lib/explorer';

const EXPLORER_OPTIONS = ['cardanoscan', 'cexplorer', 'adastat'];

/** §6/§28 — board edits platform governance parameters. */
export function GovernanceSetup() {
  const [params, setParams] = useState<GovParam[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    governanceApi
      .list()
      .then((p) => {
        setParams(p);
        setEdits(Object.fromEntries(p.map((x) => [x.key, String(x.value)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  useEffect(() => {
    load();
  }, []);

  const save = async (p: GovParam) => {
    setError(null);
    setMsg(null);
    setBusy(p.key);
    try {
      const raw = edits[p.key];
      const value = p.type === 'boolean' ? raw === 'true' : p.type === 'number' ? Number(raw) : raw;
      await governanceApi.update(p.key, value);
      setMsg(`Saved ${p.key}.`);
      // Explorer change → re-resolve all on-chain links live (no refresh needed).
      if (p.key.startsWith('CARDANO_EXPLORER')) invalidateConfig();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Platform setup</h2>
        <p className="text-sm text-neutral-500">
          Governance parameters (§6/§28). Changes apply to subsequent actions; defaults shown for reference.
        </p>
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {msg ? <div className="text-sm text-emerald-600">{msg}</div> : null}

      {/* §18 — the anchor hot wallet is managed by platform admins in the admin area, not here. */}
      <p className="text-xs text-neutral-500">
        Platform wallets (the anchor hot wallet + treasury) are managed by platform administrators in the admin
        area — DReps and the board don&apos;t handle the hot-wallet key.
      </p>
      {!params ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Parameter</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Default</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => {
                const dirty = edits[p.key] !== String(p.value);
                return (
                  <tr key={p.key} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                    <td className="px-3 py-1.5">
                      <div className="font-mono text-xs">{p.key}</div>
                      {p.description ? (
                        <div className="mt-0.5 max-w-xs text-xs font-normal text-neutral-500">{p.description}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      {p.type === 'boolean' ? (
                        <select
                          value={edits[p.key] ?? 'false'}
                          onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                          className="w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                        >
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </select>
                      ) : p.key === 'CARDANO_EXPLORER' ? (
                        <select
                          value={edits[p.key] ?? ''}
                          onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                          className="w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                        >
                          {EXPLORER_OPTIONS.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={edits[p.key] ?? ''}
                          onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                          inputMode={p.type === 'number' ? 'decimal' : 'text'}
                          className="w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                        />
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-neutral-500">{String(p.default)}</td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => save(p)}
                        disabled={busy === p.key || !dirty}
                        className="rounded-md border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
                      >
                        {busy === p.key ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
