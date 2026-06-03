'use client';

import { useEffect, useState } from 'react';
import { treasuryApi, type TreasuryOverview as Overview } from '@/lib/api';
import { MultisigSetup } from './multisig-setup';

const ada = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const BUCKET_COLOR: Record<string, string> = {
  rewards: 'bg-emerald-500',
  operations: 'bg-sky-500',
};
const roundColor = 'bg-violet-500';

/** §15 — Treasury overview: budget buckets (allocated/spent/remaining) + balances. */
export function TreasuryOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    treasuryApi.overview().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Treasury</h2>
        <p className="text-sm text-neutral-500">
          The DAO&apos;s 3-of-5 multisig holds the budget; a low-balance hot wallet pays tx fees. Budgets:
          rewards, operations, and one per funding round.
        </p>
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {/* §15 — multisig setup panel above the balances: roster of board key
          submissions + assembled script address (or "not yet built" banner). */}
      <MultisigSetup />
      {!data ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <>
          {/* Balances */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Card label="Treasury (multisig) balance" value={data.treasury.configured ? `${ada(data.treasury.balanceAda)} ₳` : 'not configured'} addr={data.treasury.address} />
            <Card
              label="Anchor hot wallet"
              value={`${ada(data.hotWallet.balanceAda)} ₳`}
              addr={data.hotWallet.address}
              warn={data.hotWallet.balanceAda < data.hotWallet.minAda ? `below ${data.hotWallet.minAda} ₳ — top-up needed` : undefined}
            />
          </div>

          {/* Budget buckets — allocated, with spent overlaid as a bar. */}
          <div className="space-y-3">
            <div className="text-sm font-medium">Budget allocation</div>
            {data.buckets.map((b) => {
              const pct = b.allocatedAda > 0 ? Math.min(100, (b.spentAda / b.allocatedAda) * 100) : 0;
              const color = BUCKET_COLOR[b.key] ?? roundColor;
              return (
                <div key={b.key} className="text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-xs text-neutral-500 tabular-nums">
                      spent {ada(b.spentAda)} / {ada(b.allocatedAda)} ₳ · {ada(b.remainingAda)} left
                    </span>
                  </div>
                  <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div className={`h-full ${color}`} style={{ width: `${Math.max(pct, b.spentAda > 0 ? 2 : 0)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <div className="flex justify-between">
              <span className="text-neutral-500">Total allocated</span>
              <span className="font-medium tabular-nums">{ada(data.totalAllocatedAda)} ₳</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Total spent</span>
              <span className="font-medium tabular-nums">{ada(data.totalSpentAda)} ₳</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, addr, warn }: { label: string; value: string; addr: string | null; warn?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {addr ? <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-400">{addr}</div> : null}
      {warn ? <div className="mt-1 text-xs text-amber-600">{warn}</div> : null}
    </div>
  );
}
