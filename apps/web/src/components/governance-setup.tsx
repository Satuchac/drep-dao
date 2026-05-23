'use client';

import { useEffect, useState } from 'react';
import { governanceApi, type GovParam, type WalletStatus } from '@/lib/api';

/** §6/§28 — board edits platform governance parameters. */
export function GovernanceSetup() {
  const [params, setParams] = useState<GovParam[] | null>(null);
  const [wallets, setWallets] = useState<WalletStatus | null>(null);
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
    governanceApi.wallets().then(setWallets).catch(() => undefined);
  }, []);

  const save = async (p: GovParam) => {
    setError(null);
    setMsg(null);
    setBusy(p.key);
    try {
      const raw = edits[p.key];
      const value = p.type === 'number' ? Number(raw) : raw;
      await governanceApi.update(p.key, value);
      setMsg(`Saved ${p.key}.`);
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

      {/* §15/§18 — platform wallets: hot wallet pays tx fees, treasury (multisig) tops it up. */}
      <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <h3 className="text-sm font-semibold">Platform wallets</h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          The <strong>anchor hot wallet</strong> pays the small per-decision tx fees. It holds minimal funds
          and is topped up from the <strong>treasury</strong> (3-of-5 multisig). The hot-wallet signing key
          is an operator secret (env/KMS) — never shown here. On compromise, rotate the key off-platform and
          re-fund a new address; the bounded balance limits exposure.
        </p>
        {!wallets ? (
          <p className="mt-2 text-xs text-neutral-500">…</p>
        ) : (
          <dl className="mt-2 space-y-2 text-xs">
            <Wallet label="Anchor hot wallet" address={wallets.hotWallet.address} balanceAda={wallets.hotWallet.balanceAda} />
            <Wallet label="Treasury (multisig)" address={wallets.treasury.address} balanceAda={wallets.treasury.balanceAda} />
          </dl>
        )}
      </div>
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
                  <tr key={p.key} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="px-3 py-1.5 font-mono text-xs">{p.key}</td>
                    <td className="px-3 py-1.5">
                      <input
                        value={edits[p.key] ?? ''}
                        onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                        inputMode={p.type === 'number' ? 'decimal' : 'text'}
                        className="w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                      />
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

function Wallet({ label, address, balanceAda }: { label: string; address: string | null; balanceAda: number }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-36 shrink-0 font-medium text-neutral-500">{label}</dt>
      <dd className="min-w-0 flex-1">
        {address ? (
          <>
            <span className="break-all font-mono text-neutral-600 dark:text-neutral-400">{address}</span>
            <span className="ml-2 tabular-nums text-neutral-500">· {balanceAda.toLocaleString()} ₳</span>
          </>
        ) : (
          <span className="text-amber-600">not configured</span>
        )}
      </dd>
    </div>
  );
}
