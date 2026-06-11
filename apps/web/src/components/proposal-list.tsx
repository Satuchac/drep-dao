'use client';

import { useEffect, useState } from 'react';
import { proposalsApi, type ProposalSummary, type ProposalProgress } from '@/lib/api';
import { useUrlNav } from '@/lib/use-url-nav';
import { StatusBadge, PROPOSAL_STATUS_CLS } from './round-ui';

/** §26.2 — public list of a round's proposals (DRAFTs are never returned). Click → shareable detail URL. */
export function ProposalList({ roundId }: { roundId: string }) {
  // Opening a proposal sets ?proposal=<id>; the shell renders the detail (shareable link).
  const { setParams } = useUrlNav();
  const [proposals, setProposals] = useState<ProposalSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!proposals) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (proposals.length === 0) return <p className="text-sm text-neutral-500">No proposals in this round yet.</p>;

  return (
    <ul className="space-y-2">
      {proposals.map((p) => {
        // Row colour per the user's spec:
        //   yellow → status PENDING (waiting for the platform/board)
        //   red    → REJECTED / FAILED (submitter may need to fix something)
        //   white  → everything else (ACTIVE / APPROVED / COMPLETE — ready or in-flight)
        const tint =
          p.status === 'PENDING'
            ? 'border-amber-300 bg-amber-50/70 hover:border-amber-500 dark:border-amber-900 dark:bg-amber-950/30'
            : p.status === 'REJECTED' || p.status === 'FAILED'
              ? 'border-red-300 bg-red-50/60 hover:border-red-500 dark:border-red-900 dark:bg-red-950/30'
              : 'border-neutral-200 hover:border-emerald-400 dark:border-neutral-800';
        return (
        <li key={p.id}>
          <button
            onClick={() => setParams({ proposal: p.id })}
            className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${tint}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {p.title}
                {p.submitter ? <span className="ml-2 text-xs font-normal text-neutral-500">by {p.submitter}</span> : null}
              </span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                {p.publicId ? <span>ID: <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{p.publicId}</span></span> : null}
                {p.stage ? <span>Stage: <span className="font-medium text-neutral-700 dark:text-neutral-300">{p.stage}</span></span> : null}
                <span className="flex items-center gap-1">Status: <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} /></span>
                {p.progress ? <ProgressChip p={p.progress} /> : null}
                {/* §11 — milestone reviewer assignment flag for FUNDING proposals. */}
                {p.milestoneReviewers === 'not_assigned' ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">milestone reviewers not assigned</span>
                ) : p.milestoneReviewers === 'assigned' ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    Milestone reviewers:{p.milestoneReviewerNames && p.milestoneReviewerNames.length > 0 ? ` ${p.milestoneReviewerNames.join(', ')}` : ' assigned'}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              {p.categoryName ?? 'uncategorized'}
              {p.requestedAmountAda ? ` · ${p.requestedAmountAda.toLocaleString()} ₳` : ''}
              {p.isCommercial != null ? ` · ${p.isCommercial ? 'commercial' : 'open-source'}` : ''}
            </div>
            {/* §16/§7/§8 — show WHY a proposal was rejected (fee feedback OR the NO rationales
                from the filtering / D&V vote that decided it). Avoids opening the detail just to
                find out why. */}
            {p.rejectionReasons && p.rejectionReasons.length > 0 ? (
              <div className="mt-2 rounded border border-red-200 bg-red-50/50 p-2 text-xs dark:border-red-900 dark:bg-red-950/30">
                <div className="font-medium text-red-800 dark:text-red-200">
                  Rejected — {p.rejectionReasons.length === 1 ? '1 reason' : `${p.rejectionReasons.length} reasons`}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {p.rejectionReasons.slice(0, 3).map((r, i) => (
                    <li key={i} className="text-neutral-700 dark:text-neutral-300">
                      <span className="text-[11px] text-neutral-500">
                        {r.stage === 'FEE' ? 'Board (fee review)' : `${r.stage} · ${r.from ?? 'DRep'}`}:
                      </span>
                      {' '}
                      <span className="line-clamp-2 whitespace-pre-wrap">{r.rationale}</span>
                    </li>
                  ))}
                  {p.rejectionReasons.length > 3 ? (
                    <li className="text-[11px] text-neutral-500">+ {p.rejectionReasons.length - 3} more — open the proposal to see all</li>
                  ) : null}
                </ul>
                <div className="mt-1 text-[11px] text-neutral-500">Open the proposal to read the full rationale.</div>
              </div>
            ) : null}
          </button>
        </li>
        );
      })}
    </ul>
  );
}

function ProgressChip({ p }: { p: ProposalProgress }) {
  const tones = {
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    neutral: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  };
  return (
    <span className="inline-flex items-center gap-1">
      <span title={p.label} className={`rounded px-2 py-0.5 text-[11px] font-medium ${tones[p.tone]}`}>{p.label}</span>
      {p.extra ? (
        <span title={p.extra.label} className={`rounded px-2 py-0.5 text-[11px] font-medium ${tones[p.extra.tone]}`}>{p.extra.label}</span>
      ) : null}
    </span>
  );
}
