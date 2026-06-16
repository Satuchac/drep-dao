'use client';

import { useEffect, useMemo, useState } from 'react';
import { proposalsApi, type ProposalSummary, type ProposalProgress } from '@/lib/api';
import { useUrlNav } from '@/lib/use-url-nav';
import { StatusBadge, PROPOSAL_STATUS_CLS } from './round-ui';
import { MilestoneBar } from './milestone-bar';

/** §26.2 — reader-facing buckets over the detailed proposal statuses:
 *    pending  — submitted, awaiting the board's fee confirmation (PENDING)
 *    active   — in the process: filtering / debate & vote (ACTIVE)
 *    approved — cleared / funded (APPROVED, COMPLETE)
 *    rejected — explicitly rejected or failed (REJECTED, FAILED)
 */
type Bucket = 'pending' | 'active' | 'approved' | 'rejected';
const bucketOf = (status: string): Bucket =>
  status === 'APPROVED' || status === 'COMPLETE' ? 'approved'
    : status === 'REJECTED' || status === 'FAILED' ? 'rejected'
      : status === 'ACTIVE' ? 'active'
        : 'pending';
// Pending first (needs board action), then active (in flight), then approved, then rejected.
const BUCKET_ORDER: Record<Bucket, number> = { pending: 0, active: 1, approved: 2, rejected: 3 };
const BUCKET_TABS = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
] as const;
const PAGE_SIZE = 50;

/** §26.2 — public list of a round's proposals (DRAFTs are never returned). Click → shareable
 *  detail URL. `roundId='all'` shows every proposal ever processed, across all rounds. */
export function ProposalList({ roundId }: { roundId: string }) {
  // Opening a proposal sets ?proposal=<id>; the shell renders the detail (shareable link).
  const { setParams } = useUrlNav();
  const [proposals, setProposals] = useState<ProposalSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<'' | Bucket>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    setProposals(null);
    setPage(1);
    (roundId === 'all' ? proposalsApi.allRounds() : proposalsApi.byRound(roundId))
      .then((p) => alive && setProposals(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'failed to load'));
    return () => {
      alive = false;
    };
  }, [roundId]);

  // Filter (bucket + ID/title search) → group-sort (pending/approved/rejected) → paginate.
  const filtered = useMemo(() => {
    if (!proposals) return [];
    const q = search.trim().toLowerCase();
    return proposals
      .filter((p) => (bucket ? bucketOf(p.status) === bucket : true))
      .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.publicId ?? '').toLowerCase().includes(q))
      .sort((a, b) => BUCKET_ORDER[bucketOf(a.status)] - BUCKET_ORDER[bucketOf(b.status)]);
  }, [proposals, bucket, search]);

  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!proposals) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (proposals.length === 0) return <p className="text-sm text-neutral-500">No proposals in this round yet.</p>;

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-2">
      {/* Bucket filter + ID/title search. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
          {BUCKET_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setBucket(t.key as '' | Bucket); setPage(1); }}
              className={`px-2.5 py-1 text-xs font-medium ${
                bucket === t.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by proposal ID (R1-P2) or title…"
          className="min-w-64 flex-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <span className="text-xs text-neutral-500">{filtered.length} proposal{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">No proposals match the filter.</p>
      ) : null}

    <ul className="space-y-2">
      {visible.map((p) => {
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
            {/* §11 — milestone progress bar (FUNDING-stage proposals; persists into history). */}
            {p.milestoneBar && p.milestoneBar.length > 0 ? (
              <div className="mt-2">
                <MilestoneBar segments={p.milestoneBar} />
              </div>
            ) : null}
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

      {/* Pager — max 50 proposals per page. */}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-3 pt-1 text-xs">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            ← Previous
          </button>
          <span className="text-neutral-500">Page {safePage} of {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={safePage >= pages}
            className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
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
