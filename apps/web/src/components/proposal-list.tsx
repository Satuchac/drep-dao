'use client';

import { useEffect, useState } from 'react';
import { proposalsApi, type ProposalSummary } from '@/lib/api';
import { StatusBadge, PROPOSAL_STATUS_CLS } from './round-ui';
import { ProposalDetail } from './proposal-detail';

/** §26.2 — public list of a round's proposals (DRAFTs are never returned). Click → full detail. */
export function ProposalList({ roundId }: { roundId: string }) {
  const [proposals, setProposals] = useState<ProposalSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setProposals(null);
    proposalsApi
      .byRound(roundId)
      .then((p) => alive && setProposals(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'failed to load'));
    return () => {
      alive = false;
    };
  }, [roundId]);

  if (openId) return <ProposalDetail id={openId} onBack={() => setOpenId(null)} />;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!proposals) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (proposals.length === 0) return <p className="text-sm text-neutral-500">No proposals in this round yet.</p>;

  return (
    <ul className="space-y-2">
      {proposals.map((p) => (
        <li key={p.id}>
          <button
            onClick={() => setOpenId(p.id)}
            className="block w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:border-emerald-400 dark:border-neutral-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{p.title}</span>
              <div className="flex items-center gap-1.5">
                {p.stage ? <span className="text-xs text-neutral-500">{p.stage}</span> : null}
                <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} />
              </div>
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              {p.categoryName ?? 'uncategorized'}
              {p.requestedAmountAda ? ` · ${p.requestedAmountAda.toLocaleString()} ₳` : ''}
              {p.isCommercial != null ? ` · ${p.isCommercial ? 'commercial' : 'open-source'}` : ''}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
