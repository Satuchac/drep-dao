'use client';

import { useEffect, useState } from 'react';
import { daoApi, type OnChainProof } from '@/lib/api';

const SCAN = 'https://preprod.cardanoscan.io/transaction/';

/** Everything the platform has anchored on-chain — human-readable + verifiable. */
export function OnChainProofs() {
  const [proofs, setProofs] = useState<OnChainProof[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    daoApi.proofs().then(setProofs).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">On-chain proofs</h2>
        <p className="text-sm text-neutral-500">
          Decisions anchored on Cardano as transaction metadata. Each links to the explorer; the metadata
          itself lists the voters and outcome, so anyone can verify it independently.
        </p>
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {!proofs ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : proofs.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing anchored on-chain yet.</p>
      ) : (
        <ul className="space-y-2">
          {proofs.map((p) => (
            <li key={p.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{p.title}</span>
                <span className="text-xs text-neutral-500">{new Date(p.createdAt).toLocaleString()}</span>
              </div>
              {p.detail ? <div className="text-neutral-600 dark:text-neutral-400">{p.detail}</div> : null}
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                <span>metadata label {p.label}</span>
                {p.txHash ? (
                  <a href={SCAN + p.txHash} target="_blank" rel="noreferrer" className="text-emerald-700 underline dark:text-emerald-400">
                    view on Cardanoscan ↗
                  </a>
                ) : (
                  <span className="text-amber-600">anchor pending (not yet submitted)</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
