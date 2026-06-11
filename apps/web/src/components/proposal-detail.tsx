'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SUBCAT_LABEL } from '@/lib/ui';
import { card } from '@/lib/ui';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import { useAuth } from '@/lib/auth-context';
import { useExplorer } from '@/lib/explorer';
import {
  proposalsApi,
  proposalVersionsApi,
  proposalEditApi,
  filteringApi,
  dvApi,
  milestonesApi,
  roundsApi,
  commentsApi,
  boardMilestoneApi,
  boardProposalsApi,
  boardPledgeApi,
  configApi,
  type ProposalDetail as PDetail,
  type VoteRationale,
  type ProposalVersionEntry,
  type ProposalSnapshot,
  type MilestoneView,
  type MilestoneCandidate,
  type StopFundingView,
  type CommentNode,
  type FilterResult,
  type FilterCandidate,
  type DvResult,
  type PledgeVerification,
  type RoundDetail,
} from '@/lib/api';
import { BackButton, StatusBadge, PROPOSAL_STATUS_CLS, fmtDateTime, RationaleText } from './round-ui';
import { Markdown, MarkdownEditor } from './markdown';
import { CopyButton } from './copy-button';
import { ConfirmDialog } from './confirm-dialog';
import { RevenueSharingBlock } from './proposal-submit';
import { ProposalMessagesPanel } from './proposal-messages';
import { boardDeadlinesApi } from '@/lib/api';


// Subtle blue tint on platform-managed governance sections (Filtering jury, D&V,
// Pledge, Milestones) so the reader can tell at a glance these blocks are
// platform information / actions, not content the team wrote.
const platformCard = 'rounded-lg border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900 dark:bg-blue-950/20';

const choiceCls: Record<string, string> = {
  YES: 'text-emerald-600',
  NO: 'text-red-600',
  ABSTAIN: 'text-neutral-500',
};

/** §20 — full proposal view: content, version diff, votes + public rationale, milestones, comments. */
export function ProposalDetail({
  id,
  onBack,
  onEditFull,
  initialEditing,
}: {
  id: string;
  onBack: () => void;
  onEditFull?: () => void;
  /** Pre-open the inline EditSection — set when the user clicked "Edit" in
   *  the My-area row instead of "Open", so they don't have to click again. */
  initialEditing?: boolean;
}) {
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [p, setP] = useState<PDetail | null>(null);
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lifted so the read-only proposal content can hide while the submitter is editing
  // (otherwise the same fields would appear twice — once in the form, once below).
  const [editingOpen, setEditingOpen] = useState(!!initialEditing);

  const load = useCallback(() => {
    proposalsApi.get(id).then(setP).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
    proposalsApi.mine().then((list) => setMine(list.some((m) => m.id === id))).catch(() => setMine(false));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <div className="space-y-2"><BackBtn onBack={onBack} /><div className="text-sm text-red-600">{error}</div></div>;
  if (!p) return <div className="space-y-2"><BackBtn onBack={onBack} /><p className="text-sm text-neutral-500">Loading…</p></div>;

  const stageReached = (s: string) => {
    const order = ['FILTERING', 'DEBATE_VOTE', 'FUNDING'];
    return p.stage ? order.indexOf(p.stage) >= order.indexOf(s) : false;
  };
  // Filtering result is relevant once filtering started; D&V tally only when the
  // round has actually advanced to VOTE (during DEBATE the proposal is in stage
  // DEBATE_VOTE but ballots aren't open yet — feedback goes through comments).
  const showFiltering = !!p.stage; // any post-submission stage has filtering history
  const showDv =
    (stageReached('DEBATE_VOTE') && (p.roundStatus === 'VOTE' || p.roundStatus === 'DV')) ||
    ['APPROVED', 'REJECTED', 'COMPLETE', 'FAILED'].includes(p.status);
  const showMilestones = p.stage === 'FUNDING' || ['COMPLETE', 'FAILED'].includes(p.status);

  return (
    <div className="space-y-4">
      <BackBtn onBack={onBack} />
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {p.title}
            {p.submitter ? <span className="ml-2 text-sm font-normal text-neutral-500">by {p.submitter}</span> : null}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            {p.publicId ? (
              <span>Proposal ID: <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{p.publicId}</span></span>
            ) : null}
            {p.stage ? <span>Stage: <span className="font-medium text-neutral-700 dark:text-neutral-300">{p.stage}</span></span> : null}
            <span className="flex items-center gap-1">Status: <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} /></span>
            {/* §3 — once in FUNDING, a promised-but-unconfirmed pledge holds the
                proposal effectively PENDING (milestone POAs blocked). Surface that
                explicitly so the team / reviewers see the gating without scrolling. */}
            {p.stage === 'FUNDING' && p.status === 'APPROVED' && p.pledgeAmountAda > 0 ? (
              p.pledgeConfirmedAt ? (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">ACTIVE · pledge confirmed</span>
              ) : (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">PENDING · awaiting pledge confirmation</span>
              )
            ) : null}
            {/* §7/§8/§11 — at-a-glance: how many DReps must still vote at the current stage. */}
            <VotingProgressChip id={id} status={p.status} stage={p.stage} />
          </div>
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          {p.categoryName ?? 'uncategorized'} · {p.requestedAmountAda.toLocaleString()} ₳ ·{' '}
          {p.isCommercial ? 'commercial' : 'open-source'} · fee {p.submissionFeeAda.toLocaleString()} ₳
          {p.categoryAsk && (p.categoryAsk.minAda != null || p.categoryAsk.maxAda != null) ? (
            <> · category ask {p.categoryAsk.minAda != null ? `${p.categoryAsk.minAda.toLocaleString()}` : '0'}–{p.categoryAsk.maxAda != null ? `${p.categoryAsk.maxAda.toLocaleString()}` : '∞'} ₳</>
          ) : null}
        </div>
        {/* §3.5 — board can message the submitter at any stage (jumps to the thread list below). */}
        {isBoard ? (
          <button
            onClick={() => document.getElementById('proposal-messages')?.scrollIntoView({ behavior: 'smooth' })}
            className="mt-2 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Send message to the submitter
          </button>
        ) : null}
        {/* Why a proposal was rejected — shown to everyone (submitter + reviewers), not buried. */}
        {p.status === 'REJECTED' ? <RejectionBanner proposal={p} /> : null}
        {/* §12 — a pending budget-change request is visible to everyone (so DReps
            know voting will reset on approval); board sees inline approve/reject. */}
        {p.pendingBudgetChange ? (
          <PendingBudgetChangeBanner proposal={p} isBoard={isBoard} onChange={load} />
        ) : null}
        {/* §7.4 — when the submitter is the viewer and the proposal is a rejected
            filter (revise + resubmit cycle), surface the action UI directly under
            the banner so it isn't buried below the read-only proposal content. */}
        {mine && p.status === 'REJECTED' && p.stage === 'FILTERING' ? (
          <>
            <ResubmitPanel id={id} proposal={p} onChange={load} />
            <EditSection id={id} proposal={p} onChange={load} open={editingOpen} onOpenChange={setEditingOpen} />
          </>
        ) : null}
        {/* When editing is open, every field below is duplicated by the form above —
            hide the read-only blocks so the submitter sees one canonical copy. */}
        {editingOpen ? null : (
          <>
            <CollapsibleView label="Pitch / summary">
              <Markdown className="text-sm text-neutral-700 dark:text-neutral-300">{p.contentMd}</Markdown>
            </CollapsibleView>
            {/* §3.4/§11 — the complete milestone plan (title, budget, description,
                acceptance criteria) stays visible inside the proposal card at all
                times — including during FUNDING — so reviewers always have the
                full promise to compare a POA against. The lower MilestonesSection
                handles the actual POA submission / review workflow. */}
            {p.milestones.length > 0 ? <MilestonePlan milestones={p.milestones} /> : null}
            {/* §3.4 — every funding field from the form is shown (collapsible); empty ones collapse with an "empty" marker. */}
            <DetailBlock label="Expected ecosystem impact" md={p.ecosystemImpactMd} hint="what changes if this is built" />
            <DetailBlock label="Success metrics / KPIs" md={p.successMetricsMd} hint="how success will be measured" />
            <DetailBlock label="Cost breakdown" md={p.costBreakdownMd} hint="how the budget is spent" />
            <DetailBlock label="Team info" md={p.teamInfoMd} hint="who is delivering this" />
            <RevenueSharingReadOnly proposal={p} isBoard={isBoard} onChange={load} />
            <SkinInTheGameReadOnly proposal={p} />
            {/* §3 — when a pledge was promised and the round is in FUNDING, render the
                payment panel right here (inside the proposal card, next to the read-only
                "Skin in the game" block) so the proposer immediately sees the address +
                tx-hash input. Hidden once the proposal lands in COMPLETE / FAILED. */}
            {p.pledgeAmountAda > 0 && p.stage === 'FUNDING' && !['COMPLETE', 'FAILED'].includes(p.status) ? (
              <PledgeSection id={id} proposal={p} isBoard={isBoard} isMine={mine} onChange={load} />
            ) : null}
            {/* §5.3/§7.1 — expertise tags (always shown like the form). */}
            <CollapsibleView label="Expertise areas" hint="helps match filtering reviewers" empty={!p.subcategoryIds || p.subcategoryIds.length === 0}>
              {p.subcategoryIds && p.subcategoryIds.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {p.subcategoryIds.map((sid) => (
                    <span key={sid} className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                      {SUBCAT_LABEL[sid] ?? sid}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-neutral-400">None selected.</span>
              )}
            </CollapsibleView>
            {p.categoryAsk?.conditions ? <DetailBlock label="Category conditions" md={p.categoryAsk.conditions} /> : null}
            {/* Payout / refund address — where the DAO sends fee refunds + the budget once funded. */}
            <div className="mt-3 rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700">
              <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Payout / refund address</div>
              {p.payoutAddress ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-xs text-neutral-600 dark:text-neutral-400">{p.payoutAddress}</span>
                  <CopyButton text={p.payoutAddress} />
                </div>
              ) : (
                <div className="mt-0.5 text-xs text-neutral-400">Not provided.</div>
              )}
            </div>
            {mine ? <FeeBlock proposal={p} /> : null}
            {/* §12 — once ACTIVE, the budget can change but the fee delta is settled by the board. */}
            {mine && p.status === 'ACTIVE' ? <BudgetChangeSection id={id} proposal={p} onChange={load} /> : null}
            {/* Pre-public (PENDING / fee-rejected): edit ALL fields in the full form. */}
            {mine && onEditFull && (p.status === 'PENDING' || (p.status === 'REJECTED' && !p.stage)) ? (
              <button onClick={onEditFull} className="mt-3 rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                {p.status === 'REJECTED' ? 'Edit & re-submit (all fields)' : 'Edit all fields'}
              </button>
            ) : null}
          </>
        )}
        {/* EditSection lives OUTSIDE the read-only block so it stays mounted
            when editingOpen flips true (in which case the read-only blocks
            above are hidden and only the form below renders). The rejected
            case handles its own copy of EditSection above with ResubmitPanel. */}
        {mine && !(p.status === 'REJECTED' && p.stage === 'FILTERING') ? (
          <EditSection id={id} proposal={p} onChange={load} open={editingOpen} onOpenChange={setEditingOpen} />
        ) : null}
      </div>

      <VersionsSection id={id} />
      {showFiltering ? <FilteringSection id={id} isBoard={isBoard} proposal={p} /> : null}
      {showDv ? <DvSection id={id} isBoard={isBoard} /> : null}
      {/* §3 — the PledgeSection itself is rendered inside the proposal card next to
          the "Skin in the game" read-only block (so the proposer sees the address +
          tx input immediately on page open). Nothing to render here. */}
      {showMilestones ? (
        <MilestonesSection id={id} isBoard={isBoard} isMine={mine} proposal={p} onChange={load} />
      ) : null}
      {/* §20.1 — viewers (no membership) can see but not post; members and the
          submitter can post + reply + edit their own. */}
      <CommentsSection
        id={id}
        title={p.title}
        canPost={
          !!profile &&
          (mine ||
            profile.roles.some((r) => ['BOARD', 'DREP', 'DAO_MEMBER', 'EXPERT_APPROVED'].includes(r)))
        }
      />
      {/* §3.5 — board ↔ submitter message history (board + submitter only). */}
      {isBoard || mine ? <ProposalMessagesPanel proposalId={id} canBoard={isBoard} /> : null}
    </div>
  );
}

function BackBtn({ onBack }: { onBack: () => void }) {
  return <BackButton onBack={onBack} label="back to proposals" />;
}

/**
 * Inline status chip next to the proposal Status badge: "voting progress" at a glance —
 * how many DReps have voted vs. how many still need to. Polls the right service for the
 * current stage (filtering reviewers / D&V snapshot / funding milestones + stop-funding)
 * and self-hides while still loading or once the proposal is fully decided (COMPLETE /
 * FAILED / REJECTED). On hover, the title attribute shows a short summary.
 */
function VotingProgressChip({ id, status, stage }: { id: string; status: string; stage: string | null }) {
  type Chip = { label: string; tone: 'amber' | 'emerald' | 'neutral' | 'red'; title: string } | null;
  const [chip, setChip] = useState<Chip>(null);

  useEffect(() => {
    let alive = true;
    const set = (c: Chip) => { if (alive) setChip(c); };
    const run = async () => {
      if (['COMPLETE', 'REJECTED', 'FAILED'].includes(status)) { set(null); return; }
      if (stage === 'FILTERING' && status === 'ACTIVE') {
        const r = await filteringApi.result(id).catch(() => null);
        if (!r) return;
        if (!r.assigned || r.assigned.length === 0) {
          set({ label: 'awaiting reviewer draw', tone: 'neutral', title: 'Board has not drawn the filtering jury yet.' });
        } else {
          const voted = r.assigned.filter((a) => a.voted).length;
          const decided = r.yes >= r.threshold || r.no >= r.threshold;
          set({
            label: `${voted}/${r.reviewers} voted (need ${r.threshold})`,
            tone: decided ? 'emerald' : voted === 0 ? 'amber' : 'amber',
            title: `Filtering: ${voted}/${r.reviewers} reviewers voted · ${r.yes} YES · ${r.no} NO · ${r.threshold} required to decide.`,
          });
        }
      } else if (stage === 'DEBATE_VOTE' && status === 'ACTIVE') {
        const r = await dvApi.result(id).catch(() => null);
        if (!r) return;
        if (!r.open) {
          set({ label: 'D&V not yet open', tone: 'neutral', title: 'Board hasn\'t opened the Debate & Vote voting window.' });
        } else {
          set({
            label: `${r.cast}/${r.eligible} DReps voted · ${r.approved ? 'passing' : 'short'} (${r.ratioPct}% / ${r.thresholdPct}%)`,
            tone: r.approved ? 'emerald' : 'amber',
            title: `D&V: ${r.cast} of ${r.eligible} eligible voted. ${r.ratioPct}% of participating power — needs ${r.thresholdPct}% to pass.`,
          });
        }
      } else if (stage === 'FUNDING' && status === 'APPROVED') {
        const [ms, stops] = await Promise.all([
          milestonesApi.forProposal(id).catch(() => [] as MilestoneView[]),
          milestonesApi.stopFundings(id).catch(() => [] as StopFundingView[]),
        ]);
        const active = stops.find((s) => s.status === 'ACTIVE');
        if (active) {
          set({
            label: `stop-funding open · ${active.yes}/${active.threshold} YES`,
            tone: 'red',
            title: `Stop-funding ACTIVE — board votes 1p1v, ${active.yes} YES / ${active.no} NO of ${active.threshold} needed.`,
          });
          return;
        }
        if (ms.length === 0) { set(null); return; }
        const approved = ms.filter((m) => m.status === 'APPROVED').length;
        const inReview = ms.filter((m) => m.status === 'POA_SUBMITTED');
        // Rejected = a current POA the submitter must address (either ≥threshold
        // NO, or approval became mathematically unreachable). Show this red so
        // the team can't miss the "you need to resubmit" state.
        const rejected = ms.filter((m) => m.status === 'REJECTED');
        if (rejected.length > 0) {
          const m = rejected[0];
          set({
            label: `M#${m.idx + 1} POA rejected — resubmit needed`,
            tone: 'red',
            title: `Milestone #${m.idx + 1} POA was rejected (${m.yes} YES / ${m.no} NO of ${m.threshold} needed). The team can post a revised POA.`,
          });
        } else if (inReview.length > 0) {
          const m = inReview[0];
          // If any NO is on file, max-possible YES = reviewers - no. When that
          // drops below threshold, the POA can't be approved with the current
          // ballots — turn the chip red so it reads as "stuck", not "pending".
          const maxPossibleYes = m.reviewers.length - m.no;
          const stuck = m.no > 0 && maxPossibleYes < m.threshold;
          set({
            label: stuck
              ? `M#${m.idx + 1} stuck · ${m.yes} YES / ${m.no} NO (need ${m.threshold})`
              : `M#${m.idx + 1} in review · ${m.yes} YES / ${m.no} NO (need ${m.threshold})`,
            tone: stuck ? 'red' : m.no > 0 ? 'amber' : 'amber',
            title: `Milestone #${m.idx + 1} POA — ${m.yes} YES / ${m.no} NO of ${m.threshold} needed${stuck ? '. Approval is no longer reachable with the current ballots — the POA will close as rejected.' : '.'}`,
          });
        } else {
          set({
            label: `${approved}/${ms.length} milestones approved`,
            tone: approved === ms.length ? 'emerald' : 'neutral',
            title: `${approved} of ${ms.length} milestones approved.`,
          });
        }
      } else {
        set(null);
      }
    };
    void run();
    // §11 — milestone state changes (POA submitted, vote cast, auto-reject,
    // approval) need to surface in the header chip without a page refresh.
    // Reviewer / submitter actions inside the page already trigger a reload
    // of MilestonesSection, but this chip lives outside that subtree, so it
    // polls every 15 s for a fresh picture.
    const interval = setInterval(() => { void run(); }, 15_000);
    return () => { alive = false; clearInterval(interval); };
  }, [id, status, stage]);

  if (!chip) return null;
  const toneCls = {
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    neutral: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  }[chip.tone];
  return (
    <span title={chip.title} className={`rounded px-2 py-0.5 text-[11px] font-medium ${toneCls}`}>
      {chip.label}
    </span>
  );
}

/**
 * A read-only section with a clickable header that shrinks/expands its content — like the
 * form's fields. Optional `hint` (muted, after the label) and `empty` (shows "empty" + starts
 * collapsed) so every field from the form is present in the view, even when not filled.
 */
function CollapsibleView({
  label,
  hint,
  empty = false,
  defaultOpen,
  children,
}: {
  label: string;
  hint?: string;
  empty?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? !empty);
  // Mirror the form's collapsible field: a bordered card with a ▸/▾ label + hint, an "empty"
  // marker, and an Expand/Shrink button; content sits below a divider when open.
  return (
    <div className="mt-2 rounded-md border border-neutral-300 dark:border-neutral-700">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex flex-1 items-center gap-1 text-left text-sm font-medium text-neutral-700 hover:text-neutral-900 dark:text-neutral-300">
          <span className="text-neutral-400">{open ? '▾' : '▸'}</span>
          {label}
          {hint ? <span className="font-normal text-neutral-400"> — {hint}</span> : null}
        </button>
        {empty ? <span className="text-xs text-neutral-400">empty</span> : null}
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700">
          {open ? '▣ Shrink' : '⤢ Expand'}
        </button>
      </div>
      {open ? <div className="border-t border-neutral-200 px-2 py-1.5 dark:border-neutral-700">{children}</div> : null}
    </div>
  );
}

/** §3.4 — a labelled, collapsible markdown detail section. Always shown (parity with the form);
 * when empty it collapses with an "empty" marker rather than disappearing. */
function DetailBlock({ label, md, hint }: { label: string; md?: string | null; hint?: string }) {
  const has = !!md && md.trim().length > 0;
  return (
    <CollapsibleView label={label} hint={hint} empty={!has}>
      {has ? (
        <Markdown className="text-sm text-neutral-700 dark:text-neutral-300">{md as string}</Markdown>
      ) : (
        <span className="text-sm text-neutral-400">Not provided.</span>
      )}
    </CollapsibleView>
  );
}

/**
 * §3.4 — revenue-sharing status, always visible to everyone. Mirrors the
 * checkbox state so reviewers can tell whether the team committed to any
 * post-approval action — and, once approved, whether the board has verified it.
 */
function RevenueSharingReadOnly({ proposal: p, isBoard, onChange }: { proposal: PDetail; isBoard: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!p.revenueSharingRequired) {
    return (
      <CollapsibleView label="Revenue sharing" hint="no post-approval conditions" empty>
        <span className="text-sm text-neutral-400">Not promised.</span>
      </CollapsibleView>
    );
  }
  const verified = !!p.revenueSharingVerifiedAt;
  // Board can mark verified once the proposal is APPROVED and the team's
  // committed action has happened on-chain. Pre-APPROVED there's nothing
  // to verify yet (no funding has started).
  const canVerify = isBoard && !verified && p.status === 'APPROVED';
  const verify = async () => {
    setBusy(true); setError(null);
    try { await boardProposalsApi.verifyRevenueSharing(p.id); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };
  return (
    <CollapsibleView
      label="Revenue sharing"
      hint={verified ? 'verified by the board' : p.status === 'APPROVED' ? 'pending board verification' : 'verified by the board after approval'}
    >
      <div className="space-y-2">
        <div className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
          verified
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
            : p.status === 'APPROVED'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
        }`}>
          {verified
            ? `✓ Verified ${fmtDateTime(p.revenueSharingVerifiedAt!)}`
            : p.status === 'APPROVED'
              ? '⏳ Pending board verification — milestone POAs are blocked until verified'
              : 'The board verifies these conditions once the proposal is approved (FUNDING) — nothing to confirm yet'}
        </div>
        {p.revenueSharingMd?.trim() ? (
          <Markdown className="text-sm text-neutral-700 dark:text-neutral-300">{p.revenueSharingMd}</Markdown>
        ) : (
          <span className="text-sm text-neutral-400">No conditions text provided.</span>
        )}
        {canVerify ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={verify}
              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Verifying…' : '✓ Confirm conditions met'}
            </button>
            {error ? <span className="text-xs text-red-600">{error}</span> : null}
          </div>
        ) : null}
      </div>
    </CollapsibleView>
  );
}

/**
 * §3 — skin-in-the-game (pledge) status, always visible to everyone so reviewers
 * can see at a glance whether the team is staking anything. Hides the on-chain
 * tx / verification panel — that's in the dedicated PledgeSection in FUNDING.
 */
function SkinInTheGameReadOnly({ proposal: p }: { proposal: PDetail }) {
  const promised = p.pledgeAmountAda > 0;
  if (!promised) {
    return (
      <CollapsibleView label="Skin in the game" hint="optional refundable pledge" empty>
        <span className="text-sm text-neutral-400">Not promised.</span>
      </CollapsibleView>
    );
  }
  const confirmed = !!p.pledgeConfirmedAt;
  return (
    <CollapsibleView label="Skin in the game" hint={confirmed ? 'pledge confirmed on-chain' : 'pledge promised (confirmed by board post-approval)'}>
      <div className="space-y-1.5">
        <div className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
          confirmed
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
            : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
        }`}>
          Promised: {p.pledgeAmountAda.toLocaleString()} ₳ {confirmed ? '· ✓ confirmed' : '· awaiting payment + board confirmation (FUNDING)'}
        </div>
        {p.pledgeReturnMethod?.trim() ? (
          <div>
            <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Return method</div>
            <Markdown className="text-sm text-neutral-700 dark:text-neutral-300">{p.pledgeReturnMethod}</Markdown>
          </div>
        ) : null}
      </div>
    </CollapsibleView>
  );
}

/** Read-only milestone plan (title · budget · description · acceptance), shown to everyone. */
function MilestonePlan({ milestones }: { milestones: PDetail['milestones'] }) {
  return (
    <CollapsibleView label={`Milestones (${milestones.length})`}>
      <ul className="space-y-2">
        {milestones.map((m) => (
          <li key={m.id} className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
            <div className="font-medium">
              Milestone #{m.idx + 1}{m.title ? ` — ${m.title}` : ''}
              <span className="text-neutral-500"> · {m.amountAda.toLocaleString()} ₳</span>
            </div>
            {m.description ? <Markdown className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">{m.description}</Markdown> : null}
            <div className="mt-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Acceptance criteria</div>
              {m.acceptanceCriteria ? (
                <Markdown className="text-xs text-neutral-600 dark:text-neutral-400">{m.acceptanceCriteria}</Markdown>
              ) : (
                <span className="text-xs text-neutral-400">Not provided.</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </CollapsibleView>
  );
}

/**
 * A prominent red banner explaining WHY a proposal was rejected, visible to the submitter and
 * reviewers alike.
 *   - stage === null            → fee-stage rejection; reason comes from feeReviewFeedback
 *     (which is also where a board fee APPROVAL feedback lives, so we only treat it as a
 *     rejection reason when stage is null — otherwise we ignore that field entirely).
 *   - stage === 'FILTERING'     → filtering rejection; banner explains the rule and lists
 *     every NO reviewer with their rationale in a collapsible (per-DRep "show / hide").
 *   - stage === 'DEBATE_VOTE'   → tally + rationales render in the D&V section below.
 */
function RejectionBanner({ proposal: p }: { proposal: PDetail }) {
  const [filterRes, setFilterRes] = useState<FilterResult | null>(null);
  useEffect(() => {
    if (p.stage === 'FILTERING') {
      filteringApi.result(p.id).then(setFilterRes).catch(() => setFilterRes(null));
    }
  }, [p.id, p.stage]);

  if (p.stage === null) {
    // §9.3 — a D&V rejection also has stage=null (set by finalize), but it's NOT
    // a fee-stage rejection — discriminate by resultFinalizedAt being set.
    if (p.resultFinalizedAt) {
      return (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          <div className="text-sm font-semibold text-red-800 dark:text-red-300">Rejected at Debate &amp; Vote</div>
          <div className="mt-0.5 text-sm text-red-700 dark:text-red-300">
            The published tally did not meet the approval threshold — see the rationales + per-voter weights in the
            Debate &amp; Vote section below.
          </div>
        </div>
      );
    }
    const reason = p.feeReviewFeedback?.trim() || 'No reason was recorded.';
    return (
      <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
        <div className="text-sm font-semibold text-red-800 dark:text-red-300">Proposal rejected</div>
        <div className="mt-0.5 whitespace-pre-wrap text-sm text-red-700 dark:text-red-300">{reason}</div>
      </div>
    );
  }

  if (p.stage === 'FILTERING') {
    const noVoters = (filterRes?.votes ?? []).filter((v) => v.choice === 'NO');
    return (
      <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
        <div className="text-sm font-semibold text-red-800 dark:text-red-300">Rejected during the Filtering review</div>
        <div className="mt-0.5 text-sm text-red-700 dark:text-red-300">
          {filterRes
            ? `${noVoters.length} reviewer${noVoters.length === 1 ? '' : 's'} voted NO — a YES decision is no longer mathematically possible.`
            : 'Loading reviewer rationales…'}
        </div>
        {noVoters.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {noVoters.map((v, i) => (
              <li key={i} className="rounded border border-red-200 bg-white/60 px-2 py-1.5 text-xs dark:border-red-900 dark:bg-red-950/30">
                <div className="font-medium text-red-900 dark:text-red-200">
                  {v.displayName ?? (v.drep ? `${v.drep.slice(0, 16)}…` : 'Reviewer')} · <span className="text-red-700 dark:text-red-300">NO</span>
                </div>
                <RationaleText text={v.rationale} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
      <div className="text-sm font-semibold text-red-800 dark:text-red-300">Proposal rejected</div>
      <div className="mt-0.5 whitespace-pre-wrap text-sm text-red-700 dark:text-red-300">
        Rejected at Debate &amp; Vote — see the published tally and rationales below.
      </div>
    </div>
  );
}

/**
 * §12/§16 — the submitter's view of the submission fee: every tx hash they entered, plus the
 * board's review feedback. **Color signals the decision**: green when the board approved
 * (status moved past fee-review), red when the board rejected (status=REJECTED, stage=null —
 * a fee-stage rejection). A PENDING proposal (fee paid but no board decision yet) shows a
 * yellow "waiting for payment confirmation" banner above the tx list.
 *
 * Non-fee rejections (e.g. "Not submitted before the SUBMISSION phase ended.") carry their
 * reason in `feeReviewFeedback` too — they render as a separate sibling block OUTSIDE the
 * fee box. A draft that was never submitted has `submittedAt == null`; that's our signal.
 */
function FeeBlock({ proposal }: { proposal: PDetail }) {
  const { txUrl } = useExplorer();
  const hashes = proposal.submissionFeeTxHashes?.length
    ? proposal.submissionFeeTxHashes
    : proposal.submissionFeeTxHash
      ? [proposal.submissionFeeTxHash]
      : [];
  const rejected = proposal.status === 'REJECTED' && proposal.stage == null;
  // A rejection whose reason is the fee itself: the proposal had been submitted
  // (submittedAt set), so the failure was at fee review or fee non-confirmation.
  // A draft that was never submitted carries a non-fee reason; we render it as
  // a sibling block outside the fee box.
  const feeRejected = rejected && proposal.submittedAt != null;
  const nonFeeRejection = rejected && proposal.submittedAt == null && proposal.feeReviewFeedback;
  const feedbackInBox = proposal.feeReviewFeedback && !nonFeeRejection;
  const awaitingFeeConfirmation = proposal.status === 'PENDING' && hashes.length > 0;
  const showBox = hashes.length > 0 || awaitingFeeConfirmation || feedbackInBox;
  if (!showBox && !nonFeeRejection) return null;
  return (
    <>
      {showBox ? (
        <div className="mt-3 rounded border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Submission fee{proposal.submissionFeeAda ? ` · ${proposal.submissionFeeAda.toLocaleString()} ₳` : ''}
          </div>
          {/* §16 — submitter has paid (tx hash entered) but the board hasn't reviewed yet. */}
          {awaitingFeeConfirmation ? (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Waiting for payment confirmation</div>
              <div className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
                A board member will verify your on-chain payment to the submission-fee address. Once approved your proposal moves to Filtering and becomes public.
              </div>
            </div>
          ) : null}
          {hashes.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {hashes.map((h, i) => (
                <div key={h} className="text-xs">
                  <a href={txUrl(h)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">
                    {h} ↗
                  </a>
                  {hashes.length > 1 && i === hashes.length - 1 ? <span className="ml-1 text-[10px] uppercase text-neutral-400">latest</span> : null}
                </div>
              ))}
            </div>
          ) : null}
          {feedbackInBox ? (
            feeRejected ? (
              <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
                <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-400">Rejected — feedback</div>
                <div className="mt-0.5 whitespace-pre-wrap text-xs text-red-800 dark:text-red-300">{proposal.feeReviewFeedback}</div>
              </div>
            ) : (
              <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
                <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Approved — feedback</div>
                <div className="mt-0.5 whitespace-pre-wrap text-xs text-emerald-800 dark:text-emerald-200">{proposal.feeReviewFeedback}</div>
              </div>
            )
          ) : null}
        </div>
      ) : null}
      {nonFeeRejection ? (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
          <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-400">Rejected — feedback</div>
          <div className="mt-0.5 whitespace-pre-wrap text-xs text-red-800 dark:text-red-300">{proposal.feeReviewFeedback}</div>
        </div>
      ) : null}
    </>
  );
}

/** Public rationale list (filtering / D&V / milestone), with optional balanced weight. */
function Votes({ votes }: { votes: VoteRationale[] }) {
  if (!votes || votes.length === 0) return <p className="text-xs text-neutral-400">No votes yet.</p>;
  return (
    <ul className="space-y-1.5">
      {votes.map((v, i) => (
        <li key={i} className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="font-medium">{v.displayName ?? (v.drep ? `${v.drep.slice(0, 16)}…` : 'DRep')}</span>
            <span className={`font-semibold ${choiceCls[v.choice] ?? ''}`}>
              {v.choice}
              {v.weight != null ? ` · ${v.weight.toLocaleString()} power` : ''}
            </span>
          </div>
          <RationaleText text={v.rationale} />
        </li>
      ))}
    </ul>
  );
}

function AnchorLink({ txHash }: { txHash: string | null | undefined }) {
  const { txUrl } = useExplorer();
  if (!txHash) return <span className="text-xs text-neutral-400">recorded (anchor pending submission)</span>;
  return (
    <a href={txUrl(txHash)} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline dark:text-emerald-400">
      on-chain proof ↗
    </a>
  );
}

/** §11/§15 — milestone payout badge: collapses the multisig signing + on-chain
 *  state into a single chip with the explorer link when PAID. */
function PayoutBadge({ payout }: { payout: MilestoneView['payout'] }) {
  const { txUrl } = useExplorer();
  if (!payout) return null;
  const base = 'rounded px-2 py-0.5 text-[11px] font-medium';
  if (payout.status === 'CONFIRMED') {
    return (
      <span className={`${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200`} title={`Paid ${payout.paidAt ? `on ${fmtDateTime(payout.paidAt)}` : ''}`}>
        ✓ PAID{payout.txHash ? <> · <a href={txUrl(payout.txHash)} target="_blank" rel="noreferrer" className="underline">tx ↗</a></> : null}
      </span>
    );
  }
  if (payout.status === 'BROADCASTED') {
    return (
      <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200`} title="Tx broadcast, on-chain verification pending.">
        Payment broadcasting{payout.txHash ? <> · <a href={txUrl(payout.txHash)} target="_blank" rel="noreferrer" className="underline">tx ↗</a></> : null}
      </span>
    );
  }
  if (payout.status === 'READY') {
    return (
      <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200`} title="All board signatures collected — board is broadcasting the multisig tx.">
        Payment ready — awaiting broadcast
      </span>
    );
  }
  // PENDING_SIGS (default) — show the signature progress.
  return (
    <span className={`${base} bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300`} title="Awaiting 3-of-5 board signatures.">
      Payment pending · {payout.approvals}/{payout.threshold} sigs
    </span>
  );
}

function FilteringSection({ id, isBoard, proposal }: { id: string; isBoard: boolean; proposal: PDetail }) {
  const [r, setR] = useState<FilterResult | null>(null);
  const [roundStatus, setRoundStatus] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  // §7.1 — which assigned reviewer the board is currently swapping (UUID of the
  // old DRep); null = no picker open. The ChangeReviewerPicker fetches candidates
  // when shown and calls boardProposalsApi.replaceFilterReviewer on click.
  const [changingDrepId, setChangingDrepId] = useState<string | null>(null);
  const load = useCallback(() => {
    filteringApi.result(id).then(setR).catch(() => setR(null));
  }, [id]);
  // Reload when the proposal itself changes (status / stage / version bump after
  // a budget-change approval or resubmit) so the votes panel never goes stale.
  // proposal.version bumps on every edit; pendingBudgetChange flips when one is
  // raised or decided. Both surface here as cache-busting deps.
  useEffect(load, [load, proposal.status, proposal.stage, proposal.pendingBudgetChange?.id]);
  useEffect(() => {
    if (!proposal.roundId) { setRoundStatus(null); return; }
    roundsApi.get(proposal.roundId).then((rd) => setRoundStatus(rd.status)).catch(() => setRoundStatus(null));
  }, [proposal.roundId]);
  if (!r) return null;
  // §7 — rationale belongs to the reviewer who wrote it; fold it into that reviewer's row
  // (keyed by on-chain DRep id) so we render exactly the assigned jury, never a duplicate list.
  const rationaleByDrep = new Map((r.votes ?? []).filter((v) => v.rationale).map((v) => [v.drep, v.rationale]));
  // §3 — voting is open only when the proposal is ACTIVE-in-FILTERING AND the round
  // is in FILTERING. While the round is in SUBMISSION, juries can be pre-assigned
  // but no votes are cast yet (server rejects + the UI hides the vote inputs).
  const inFilteringStage = r.status === 'ACTIVE' && r.stage === 'FILTERING';
  const roundOpen = !roundStatus || roundStatus === 'FILTERING'; // unknown → assume open (failsafe)
  const open = inFilteringStage && roundOpen;
  const submissionPhase = inFilteringStage && roundStatus === 'SUBMISSION';
  const voted = (r.assigned ?? []).filter((a) => a.voted).length;
  const decided = r.yes >= r.threshold || r.no >= r.threshold;

  const draw = async () => {
    setDrawing(true); setDrawError(null);
    try { await boardProposalsApi.drawReviewers(id); load(); }
    catch (e) { setDrawError(e instanceof Error ? e.message : 'failed'); }
    finally { setDrawing(false); }
  };

  // §7.4 — once filtering is decided the proposal either advances (status=ACTIVE,
  // stage moved past FILTERING — D&V or further) or is REJECTED (status=REJECTED
  // with the stage frozen on FILTERING). Show a clear outcome chip in both cases.
  const advanced = r.status === 'ACTIVE' && r.stage !== 'FILTERING' && r.stage !== null;
  const rejectedAtFiltering = r.status === 'REJECTED' && r.stage === 'FILTERING';
  const outcomeChip = advanced
    ? { label: '✓ Filtering passed — advanced to Debate & Vote', tone: 'emerald' as const }
    : rejectedAtFiltering
      ? { label: '✗ Rejected at filtering', tone: 'red' as const }
      : null;

  return (
    <section className={platformCard}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Filtering — 1 member · 1 vote</h3>
        <div className="flex items-center gap-2">
          {outcomeChip ? (
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${outcomeChip.tone === 'emerald'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}`}
              title={outcomeChip.label}
            >
              {outcomeChip.label}
            </span>
          ) : open ? (
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${decided
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                : voted === 0
                  ? 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}`}
              title="Voting progress"
            >
              {voted}/{r.reviewers || 0} voted{decided ? ' · passed (advancing)' : ' · awaiting votes'}
            </span>
          ) : null}
          <AnchorLink txHash={r.anchorTxHash} />
        </div>
      </div>
      {/* §7.1 — a fixed jury (FILTER_REVIEWER_COUNT) decides; no abstain in filtering. */}
      <div className="mt-1 text-xs text-neutral-500">
        {r.reviewers} reviewers · {r.yes} YES / {r.no} NO · need {r.threshold} to decide
      </div>
      {submissionPhase ? (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>Round in SUBMISSION.</strong> Reviewer voting opens when the board moves the round to FILTERING.
          Reviewers can already be pre-assigned here.
          {r.assigned && r.assigned.length > 0 ? (
            <> The assigned reviewers will be <strong>automatically notified to vote</strong> the moment the round moves to FILTERING — no further action needed if the board doesn&apos;t want to swap anyone.</>
          ) : null}
        </div>
      ) : null}
      {r.assigned && r.assigned.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {r.assigned.map((a, i) => {
            const rationale = a.drep ? rationaleByDrep.get(a.drep) : null;
            // Board can replace a reviewer who hasn't cast a vote yet AND while the
            // proposal is still actively in FILTERING (not after the decision).
            const canChange = isBoard && !a.voted && inFilteringStage;
            return (
              <li key={i} className="rounded border border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">{a.displayName ?? (a.drep ? `${a.drep.slice(0, 16)}…` : 'DRep')}</span>
                    {a.expertiseMatch ? (
                      <span className="rounded bg-emerald-100 px-1 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" title="matched the proposal's expertise areas">⭐ expertise</span>
                    ) : (
                      <span className="rounded bg-neutral-200 px-1 py-0.5 text-[10px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" title="no expertise overlap with the proposal's categories — picked at random">random pick</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {a.voted ? (
                      <span className={`font-semibold ${choiceCls[a.choice ?? ''] ?? ''}`}>{a.choice}</span>
                    ) : (
                      // §5 — "pending" only while filtering is open; otherwise the reviewer simply didn't vote.
                      <span className="text-amber-600">{open ? 'pending' : 'not voted'}</span>
                    )}
                    {canChange ? (
                      <button
                        onClick={() => setChangingDrepId(changingDrepId === a.drepId ? null : a.drepId)}
                        title="Swap this reviewer for someone else (only available before they vote)"
                        className={
                          changingDrepId === a.drepId
                            ? 'rounded border border-neutral-400 px-1.5 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-500 dark:text-neutral-300 dark:hover:bg-neutral-800'
                            : 'rounded border border-emerald-500 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950'
                        }
                      >
                        {changingDrepId === a.drepId ? 'Cancel' : '↻ Change reviewer'}
                      </button>
                    ) : null}
                  </span>
                </div>
                {changingDrepId === a.drepId ? (
                  <ChangeReviewerPicker
                    proposalId={id}
                    oldDrepId={a.drepId}
                    onDone={() => { setChangingDrepId(null); load(); }}
                  />
                ) : null}
                <RationaleText text={rationale} />
              </li>
            );
          })}
        </ul>
      ) : isBoard && inFilteringStage ? (
        // §7.1 — board triggers the jury draw. Allowed during SUBMISSION (pre-assign)
        // and during FILTERING. Once drawn, the reviewer list (with per-reviewer
        // voting status) replaces this button.
        <div className="mt-2 space-y-1">
          <div className="text-xs text-neutral-500">
            No reviewers drawn yet — the jury is picked by the board (expertise overlap first, then equal participation).
            {submissionPhase ? ' Pre-assigning now is fine; their votes open once the round moves to FILTERING.' : ''}
          </div>
          <button onClick={draw} disabled={drawing} className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950">
            {drawing ? 'Drawing…' : 'Draw + confirm reviewers'}
          </button>
          {drawError ? <div className="text-xs text-red-600">{drawError}</div> : null}
        </div>
      ) : (
        <div className="mt-2 text-xs text-neutral-400">No reviewers drawn yet.</div>
      )}
    </section>
  );
}

/**
 * §7.1 — board's inline reviewer picker. Lazily fetches the candidate list (every
 * eligible DRep with expertise + load + alreadyAssigned/alreadyVoted flags),
 * sorts expertise-matched first, then by load; clicking a row calls
 * `replaceFilterReviewer` and bubbles the refresh.
 */
function ChangeReviewerPicker({ proposalId, oldDrepId, onDone }: { proposalId: string; oldDrepId: string; onDone: () => void }) {
  const [cands, setCands] = useState<FilterCandidate[] | null>(null);
  const [showAll, setShowAll] = useState(false); // include admitted DReps outside this round's eligibility
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCands(null);
    boardProposalsApi.filterCandidates(proposalId, showAll)
      .then(setCands)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [proposalId, showAll]);

  const pick = async (newDrepId: string) => {
    setBusy(true); setError(null);
    try { await boardProposalsApi.replaceFilterReviewer(proposalId, oldDrepId, newDrepId); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };

  if (!cands) return <div className="mt-1.5 text-[11px] text-neutral-500">{error ?? 'Loading candidates…'}</div>;
  const pickable = cands.filter((c) => !c.alreadyAssigned && !c.alreadyVoted);
  return (
    <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-neutral-500">
          {showAll
            ? 'Pick a replacement (in-round first, then expertise-matched, then equal participation):'
            : 'Pick a replacement (expertise-matched first, then equal participation):'}
        </span>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          title={showAll ? 'Show only DReps already eligible for this round' : 'Show every admitted DRep in the DAO; picking one outside the round auto-adds them to it'}
        >
          {showAll ? '↩ Show round-eligible only' : '🌐 Show all admitted DReps'}
        </button>
      </div>
      {pickable.length === 0 ? (
        <div className="text-[11px] text-amber-700">No other DReps available — every other admitted reviewer is already assigned or has voted on this proposal.{!showAll ? ' Click "Show all admitted DReps" above to broaden the search.' : ''}</div>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {pickable.map((c) => (
            <li key={c.drepId} className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-2 py-1 dark:border-neutral-800">
              <span className="flex items-center gap-1.5">
                <span className="font-medium">{c.displayName ?? `${c.drepIdOnchain.slice(0, 16)}…`}</span>
                {c.matchedSubcategoryIds.length > 0 ? (
                  <span className="flex flex-wrap items-center gap-1" title="Subcategories shared with the proposal">
                    <span className="text-amber-600">⭐</span>
                    {c.matchedSubcategoryIds.map((sid) => (
                      <span key={sid} className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{SUBCAT_LABEL[sid] ?? sid}</span>
                    ))}
                  </span>
                ) : (
                  <span title="No expertise overlap — would be a random pick" className="rounded bg-neutral-200 px-1 py-0.5 text-[10px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">random pick</span>
                )}
                {!c.inRound ? (
                  <span title="Not in this round's eligibility yet; will be added on assignment" className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">not in round (auto-add)</span>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">load {c.loadInRound}</span>
                <button
                  onClick={() => pick(c.drepId)}
                  disabled={busy}
                  className="rounded border border-emerald-500 px-1.5 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
                >
                  {busy ? '…' : 'Assign'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </div>
  );
}

function DvSection({ id }: { id: string; isBoard: boolean }) {
  const [r, setR] = useState<DvResult | null>(null);
  const load = useCallback(() => dvApi.result(id).then(setR).catch(() => setR(null)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!r || !r.open) return null;

  const total = r.totalPower ?? 0;
  const yes = r.yesPower ?? 0;
  const abstain = r.abstainPower ?? 0;
  const no = Math.max(0, total - yes - abstain); // explicit + implicit NO
  const denom = r.denominator ?? total - abstain;
  // Threshold is a % of the denominator (total − abstain); place it on the total-power scale.
  const thresholdPosPct = total > 0 ? ((((r.thresholdPct ?? 0) / 100) * denom) / total) * 100 : 0;

  return (
    <section className={platformCard}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Debate &amp; Vote — balanced voting power</h3>
        <AnchorLink txHash={r.anchorTxHash} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {r.cast}/{r.eligible} eligible DReps voted · {r.approved ? 'passing' : 'not passing'} at {r.ratioPct}% (need {r.thresholdPct}% of participating power)
      </div>
      <PowerBar yes={yes} no={no} abstain={abstain} total={total} thresholdPosPct={thresholdPosPct} thresholdPct={r.thresholdPct ?? 0} />
      {/* §8.2 — board members are voters by default; the per-proposal opt-in
          was replaced by a profile-level switch. To opt out, board members
          flip it off in My area → Profile. */}
      <div className="mt-3"><Votes votes={r.votes ?? []} /></div>
    </section>
  );
}

/** §4.4 — YES / NO / abstain as balanced voting power, scaled to total power, with a threshold marker. */
function PowerBar({ yes, no, abstain, total, thresholdPosPct, thresholdPct }: { yes: number; no: number; abstain: number; total: number; thresholdPosPct: number; thresholdPct: number }) {
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const tpos = Math.min(100, Math.max(0, thresholdPosPct));
  return (
    <div className="mt-6">
      <div className="relative h-5 w-full rounded bg-neutral-200 dark:bg-neutral-800">
        <div className="absolute inset-0 overflow-hidden rounded">
          <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${pct(yes)}%` }} />
          <div className="absolute inset-y-0 bg-red-400" style={{ left: `${pct(yes)}%`, width: `${pct(no)}%` }} />
          <div className="absolute inset-y-0 bg-neutral-400" style={{ left: `${pct(yes + no)}%`, width: `${pct(abstain)}%` }} />
        </div>
        {/* §6 — threshold marker with a labelled percentage above the line. */}
        <div className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-neutral-700 dark:text-neutral-300" style={{ left: `${tpos}%` }}>
          threshold {thresholdPct}%
        </div>
        <div className="absolute -top-1.5 bottom-0 w-0.5 bg-neutral-900 dark:bg-white" style={{ left: `${tpos}%` }} title={`threshold ${thresholdPct}%`} />
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />YES {fmt(yes)}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-400" />NO {fmt(no)}</span>
        {abstain > 0 ? <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-neutral-400" />abstain {fmt(abstain)}</span> : null}
        <span className="tabular-nums">total power {fmt(total)} · threshold {thresholdPct}%</span>
      </div>
    </div>
  );
}

/** §7/§8 — content version history with a simple line diff (original vs selected). */
function VersionsSection({ id }: { id: string }) {
  const [versions, setVersions] = useState<ProposalVersionEntry[]>([]);
  useEffect(() => {
    proposalVersionsApi.list(id).then(setVersions).catch(() => setVersions([]));
  }, [id]);
  const [sel, setSel] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [showFull, setShowFull] = useState(false);
  if (versions.length < 2) return null; // nothing was edited → no history to show
  const current = versions[versions.length - 1];
  const prev = versions.find((v) => v.version === (sel ?? versions[versions.length - 2].version)) ?? versions[versions.length - 2];

  if (!open) {
    return (
      <section className={card}>
        <button onClick={() => setOpen(true)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-semibold">Edit history</span>
          <span className="text-xs text-neutral-500">{versions.length} versions · view changes ▸</span>
        </button>
      </section>
    );
  }
  return (
    <section className={card}>
      <button onClick={() => setOpen(false)} className="flex w-full items-center justify-between text-left">
        <span className="text-base font-semibold">Edit history</span>
        <span className="text-xs text-neutral-500">hide ▾</span>
      </button>
      {/* Pick any earlier version; compare it to (or view it next to) the current one. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        version
        <select
          className="rounded border border-neutral-300 px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
          value={prev.version}
          onChange={(e) => setSel(Number(e.target.value))}
        >
          {versions.filter((v) => !v.current).map((v) => (
            <option key={v.version} value={v.version}>v{v.version} ({fmtDateTime(v.editedAt)}{v.editor ? ` · ${v.editor}` : ''})</option>
          ))}
        </select>
        → current (v{current.version})
        <button onClick={() => setShowFull((s) => !s)} className="ml-2 underline">
          {showFull ? 'inline diff' : 'side-by-side diff'}
        </button>
      </div>
      <VersionDiff prev={prev} current={current} sideBySide={showFull} />
    </section>
  );
}

/**
 * §7 — multi-field version diff. Walks every editable field in the snapshot;
 * emits a labelled section only for fields that actually changed:
 *   - Text fields (title, pitch, ecosystem impact, etc.) → LCS line diff
 *     (inline or side-by-side, driven by the parent toggle)
 *   - Scalars (requested amount, commercial flag) → "old → new" badge
 *   - String list (expertise areas) → added (green) / removed (red) sets
 *   - Milestones → compact per-milestone table comparing both versions
 * Falls back to a contentMd-only diff when older rows don't have a snapshot.
 */
function VersionDiff({ prev, current, sideBySide }: { prev: ProposalVersionEntry; current: ProposalVersionEntry; sideBySide: boolean }) {
  const renderText = (oldText: string, newText: string) =>
    sideBySide
      ? <SideBySideDiff oldText={oldText} newText={newText} oldLabel={`v${prev.version}`} newLabel={`v${current.version}`} />
      : <Diff oldText={oldText} newText={newText} />;

  // Backward compatibility: older rows have no snapshot — compare contentMd only.
  if (!prev.snapshot || !current.snapshot) {
    if (prev.contentMd === current.contentMd) {
      return <p className="mt-2 text-xs italic text-neutral-500">No textual changes detected (older version captured only the pitch text).</p>;
    }
    return (
      <div className="mt-2">
        <DiffFieldHeader label="Pitch / summary" />
        {renderText(prev.contentMd, current.contentMd)}
      </div>
    );
  }

  const TEXT_FIELDS: { key: keyof ProposalSnapshot; label: string }[] = [
    { key: 'title', label: 'Title' },
    { key: 'contentMd', label: 'Pitch / summary' },
    { key: 'ecosystemImpactMd', label: 'Expected ecosystem impact' },
    { key: 'successMetricsMd', label: 'Success metrics / KPIs' },
    { key: 'costBreakdownMd', label: 'Cost breakdown' },
    { key: 'teamInfoMd', label: 'Team info' },
    { key: 'revenueSharingMd', label: 'Revenue sharing' },
    { key: 'payoutAddress', label: 'Payout / refund address' },
  ];

  const a = prev.snapshot, b = current.snapshot;
  const sections: React.ReactNode[] = [];

  for (const { key, label } of TEXT_FIELDS) {
    const oldVal = String(a[key] ?? '');
    const newVal = String(b[key] ?? '');
    if (oldVal !== newVal) {
      sections.push(
        <div key={`text-${key}`} className="mt-3">
          <DiffFieldHeader label={label} />
          {renderText(oldVal, newVal)}
        </div>,
      );
    }
  }

  if (a.requestedAmountAda !== b.requestedAmountAda) {
    sections.push(
      <div key="amount" className="mt-3">
        <DiffFieldHeader label="Requested amount" />
        <ScalarChange before={`${a.requestedAmountAda.toLocaleString()} ₳`} after={`${b.requestedAmountAda.toLocaleString()} ₳`} />
      </div>,
    );
  }
  if (a.isCommercial !== b.isCommercial) {
    sections.push(
      <div key="commercial" className="mt-3">
        <DiffFieldHeader label="Commercial / for profit" />
        <ScalarChange before={a.isCommercial ? 'yes' : 'no'} after={b.isCommercial ? 'yes' : 'no'} />
      </div>,
    );
  }

  const aSubs = new Set(a.subcategoryIds);
  const bSubs = new Set(b.subcategoryIds);
  const removed = [...aSubs].filter((x) => !bSubs.has(x));
  const added = [...bSubs].filter((x) => !aSubs.has(x));
  if (removed.length || added.length) {
    sections.push(
      <div key="subs" className="mt-3">
        <DiffFieldHeader label="Expertise areas" />
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
          {removed.map((s) => (
            <span key={`r-${s}`} className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 line-through dark:bg-red-950 dark:text-red-300">{SUBCAT_LABEL[s] ?? s}</span>
          ))}
          {added.map((s) => (
            <span key={`a-${s}`} className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">+ {SUBCAT_LABEL[s] ?? s}</span>
          ))}
        </div>
      </div>,
    );
  }

  if (!sameMilestones(a.milestones, b.milestones)) {
    sections.push(
      <div key="milestones" className="mt-3">
        <DiffFieldHeader label="Milestones" />
        <MilestoneDiff before={a.milestones} after={b.milestones} />
      </div>,
    );
  }

  if (sections.length === 0) {
    return <p className="mt-2 text-xs italic text-neutral-500">No differences between v{prev.version} and v{current.version}.</p>;
  }
  return <div>{sections}</div>;
}

function DiffFieldHeader({ label }: { label: string }) {
  return <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</div>;
}

function ScalarChange({ before, after }: { before: string; after: string }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded bg-red-50 px-2 py-0.5 text-red-800 line-through dark:bg-red-950 dark:text-red-200">{before}</span>
      <span className="text-neutral-400">→</span>
      <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{after}</span>
    </div>
  );
}

function sameMilestones(a: ProposalSnapshot['milestones'], b: ProposalSnapshot['milestones']) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if ((x.title ?? '') !== (y.title ?? '') || (x.description ?? '') !== (y.description ?? '') || (x.acceptanceCriteria ?? '') !== (y.acceptanceCriteria ?? '') || x.amountAda !== y.amountAda) {
      return false;
    }
  }
  return true;
}

function MilestoneDiff({ before, after }: { before: ProposalSnapshot['milestones']; after: ProposalSnapshot['milestones'] }) {
  const max = Math.max(before.length, after.length);
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < max; i++) {
    const a = before[i];
    const b = after[i];
    if (!a) {
      rows.push(
        <div key={`add-${i}`} className="mt-1 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="font-semibold text-emerald-800 dark:text-emerald-200">+ Milestone #{i + 1} added</div>
          <MilestoneSummary m={b} />
        </div>,
      );
      continue;
    }
    if (!b) {
      rows.push(
        <div key={`del-${i}`} className="mt-1 rounded border border-red-200 bg-red-50 p-2 text-xs dark:border-red-900 dark:bg-red-950/30">
          <div className="font-semibold text-red-800 dark:text-red-200">− Milestone #{i + 1} removed</div>
          <MilestoneSummary m={a} />
        </div>,
      );
      continue;
    }
    const changed = (a.title ?? '') !== (b.title ?? '') || (a.description ?? '') !== (b.description ?? '') || (a.acceptanceCriteria ?? '') !== (b.acceptanceCriteria ?? '') || a.amountAda !== b.amountAda;
    if (!changed) continue;
    rows.push(
      <div key={`ch-${i}`} className="mt-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/30">
        <div className="font-semibold text-amber-800 dark:text-amber-200">Milestone #{i + 1} changed</div>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          <div><div className="text-[10px] uppercase text-neutral-500">before</div><MilestoneSummary m={a} /></div>
          <div><div className="text-[10px] uppercase text-neutral-500">after</div><MilestoneSummary m={b} /></div>
        </div>
      </div>,
    );
  }
  return <div className="mt-1">{rows}</div>;
}

function MilestoneSummary({ m }: { m: ProposalSnapshot['milestones'][number] }) {
  return (
    <div className="text-neutral-700 dark:text-neutral-300">
      <div><span className="text-neutral-500">Title:</span> {m.title || <span className="italic text-neutral-400">(none)</span>}</div>
      <div><span className="text-neutral-500">Budget:</span> {m.amountAda.toLocaleString()} ₳</div>
      <div className="whitespace-pre-wrap"><span className="text-neutral-500">Description:</span> {m.description || <span className="italic text-neutral-400">(none)</span>}</div>
      {m.acceptanceCriteria ? <div className="whitespace-pre-wrap"><span className="text-neutral-500">Acceptance:</span> {m.acceptanceCriteria}</div> : null}
    </div>
  );
}

/**
 * §7.4 — side-by-side diff: two aligned columns. Deleted lines render red on
 * the left and a blank slot on the right; added lines render the inverse;
 * unchanged lines appear in both columns. Driven by the same LCS as the
 * inline view, so the two stay in sync.
 */
function SideBySideDiff({ oldText, newText, oldLabel, newLabel }: { oldText: string; newText: string; oldLabel: string; newLabel: string }) {
  const rows = useMemo(() => diffLines(oldText.split('\n'), newText.split('\n')), [oldText, newText]);
  // Pair deletes with adjacent inserts so an edited line lines up across columns.
  type Pair = { left: { line: string; op: 'eq' | 'del' } | null; right: { line: string; op: 'eq' | 'add' } | null };
  const pairs: Pair[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.op === 'eq') {
      pairs.push({ left: { line: r.line, op: 'eq' }, right: { line: r.line, op: 'eq' } });
      i++;
      continue;
    }
    // Collect a run of consecutive del/add and zip them by index.
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < rows.length && rows[i].op !== 'eq') {
      if (rows[i].op === 'del') dels.push(rows[i].line);
      else adds.push(rows[i].line);
      i++;
    }
    const len = Math.max(dels.length, adds.length);
    for (let k = 0; k < len; k++) {
      pairs.push({
        left: k < dels.length ? { line: dels[k], op: 'del' } : null,
        right: k < adds.length ? { line: adds[k], op: 'add' } : null,
      });
    }
  }
  const cellCls = (op: 'eq' | 'add' | 'del' | null) =>
    op === 'add' ? 'bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
    : op === 'del' ? 'bg-red-50 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200'
    : op === 'eq' ? 'px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-300'
    : 'select-none bg-neutral-50 px-2 py-0.5 text-xs text-neutral-300 dark:bg-neutral-900';
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-500">{oldLabel}</div>
        <div className="overflow-x-auto whitespace-pre-wrap rounded border border-neutral-200 dark:border-neutral-800">
          {pairs.map((p, idx) => (
            <div key={idx} className={cellCls(p.left?.op ?? null)}>{p.left?.line || (p.left ? ' ' : '·')}</div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-500">{newLabel}</div>
        <div className="overflow-x-auto whitespace-pre-wrap rounded border border-neutral-200 dark:border-neutral-800">
          {pairs.map((p, idx) => (
            <div key={idx} className={cellCls(p.right?.op ?? null)}>{p.right?.line || (p.right ? ' ' : '·')}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Minimal LCS line diff → red (removed) / green (added) / unchanged. */
function Diff({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(() => diffLines(oldText.split('\n'), newText.split('\n')), [oldText, newText]);
  return (
    <pre className="mt-2 overflow-x-auto rounded border border-neutral-200 p-2 text-xs leading-relaxed dark:border-neutral-800">
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            r.op === 'add'
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : r.op === 'del'
                ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
                : 'text-neutral-600 dark:text-neutral-400'
          }
        >
          {r.op === 'add' ? '+ ' : r.op === 'del' ? '- ' : '  '}
          {r.line || ' '}
        </div>
      ))}
    </pre>
  );
}

function diffLines(a: string[], b: string[]): { op: 'eq' | 'add' | 'del'; line: string }[] {
  const n = a.length, m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: { op: 'eq' | 'add' | 'del'; line: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: 'eq', line: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ op: 'del', line: a[i] }); i++; }
    else { out.push({ op: 'add', line: b[j] }); j++; }
  }
  while (i < n) out.push({ op: 'del', line: a[i++] });
  while (j < m) out.push({ op: 'add', line: b[j++] });
  return out;
}

/**
 * §12 — a pending budget-change request banner. Visible to everyone (so DReps
 * and the submitter know voting is paused on the proposal until the board
 * decides). The board sees inline Approve / Reject buttons + a feedback box.
 * Approval applies the change (clears filtering votes if the round is in
 * FILTERING, queues the fee delta); rejection leaves the proposal — and the
 * existing reviewer votes — untouched.
 */
function PendingBudgetChangeBanner({ proposal, isBoard, onChange }: { proposal: PDetail; isBoard: boolean; onChange: () => void }) {
  const pending = proposal.pendingBudgetChange;
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!pending) return null;
  const inFiltering = proposal.roundStatus === 'FILTERING';

  const decide = async (kind: 'APPROVE' | 'REJECT') => {
    setError(null);
    if (kind === 'REJECT' && !feedback.trim()) {
      setError('Rejection feedback is required so the team understands why.');
      return;
    }
    setBusy(true);
    try {
      if (kind === 'APPROVE') await boardProposalsApi.approveBudgetChange(pending.id, feedback.trim() || undefined);
      else await boardProposalsApi.rejectBudgetChange(pending.id, feedback.trim());
      setFeedback('');
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        Budget change pending board approval
      </div>
      <div className="mt-1 text-xs text-amber-800 dark:text-amber-200">
        {pending.requester ? <strong>{pending.requester}</strong> : 'The submitter'} requested{' '}
        <strong>{pending.prevAmountAda.toLocaleString()} ₳ → {pending.proposedAmountAda.toLocaleString()} ₳</strong> on{' '}
        {new Date(pending.createdAt).toLocaleString()}.
        {inFiltering ? ' If approved, the jury\'s filtering votes will be cleared and they vote again on the revised budget.' : ''}
      </div>
      {pending.reason ? (
        <div className="mt-1.5 rounded bg-white/70 p-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <span className="text-[10px] font-semibold uppercase">Reason from team:</span> {pending.reason}
        </div>
      ) : null}
      {pending.proposedMilestones?.length ? (
        <div className="mt-2">
          <div className="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">Proposed milestones</div>
          <ul className="mt-0.5 space-y-0.5 text-xs text-amber-900 dark:text-amber-100">
            {pending.proposedMilestones.map((m, i) => (
              <li key={i}>
                M#{i + 1} — {m.title || <em>(untitled)</em>} · {m.amountAda.toLocaleString()} ₳{m.description ? <span className="text-amber-700 dark:text-amber-300"> · {m.description.slice(0, 80)}{m.description.length > 80 ? '…' : ''}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {isBoard ? (
        <div className="mt-2 space-y-1.5 border-t border-amber-300 pt-2 dark:border-amber-900">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback (required to reject; optional on approve)"
            rows={2}
            className="w-full rounded border border-amber-300 px-2 py-1 text-xs dark:border-amber-900 dark:bg-amber-950/50"
          />
          {error ? <div className="text-xs text-red-600">{error}</div> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => decide('APPROVE')}
              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? '…' : '✓ Approve change'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide('REJECT')}
              className="rounded-md border border-red-500 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"
            >
              ✗ Reject change
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * §7.4 — submitter's panel after a filtering rejection. Shows the remaining
 * resubmission budget; the actual edits go through the existing EditSection +
 * version snapshots. Clicking "Resubmit for re-vote" calls /resubmit which
 * deletes the filtering votes and reopens the proposal as ACTIVE+FILTERING.
 */
function ResubmitPanel({ id, proposal, onChange }: { id: string; proposal: PDetail; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rejected = proposal.status === 'REJECTED' && proposal.stage === 'FILTERING';
  if (!rejected) return null;
  const used = proposal.filterResubmissionsUsed;
  const allowed = proposal.filterResubmissionsAllowed;
  const remaining = Math.max(0, allowed - used);
  const exhausted = remaining === 0;

  const resubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await proposalsApi.resubmit(id);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        Rejected at filtering — you can revise
      </div>
      <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
        Edit your proposal below (every save is captured as a new version DReps can diff),
        then click <strong>Resubmit for re-vote</strong>. The current filtering votes are
        cleared and the jury votes again on the revised content.{' '}
        {exhausted
          ? `All ${allowed} resubmissions used — no more retries this round.`
          : `${remaining} of ${allowed} resubmission${allowed === 1 ? '' : 's'} remaining.`}
      </p>
      <div className="mt-2">
        <button
          type="button"
          onClick={resubmit}
          disabled={busy || exhausted}
          className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? 'Resubmitting…' : exhausted ? 'No resubmissions left' : 'Resubmit for re-vote'}
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function EditSection({
  id,
  proposal,
  onChange,
  open,
  onOpenChange,
}: {
  id: string;
  proposal: PDetail;
  onChange: () => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { cfg } = useExplorer();
  const [title, setTitle] = useState(proposal.title);
  const [content, setContent] = useState(proposal.contentMd);
  const [costBreakdown, setCostBreakdown] = useState(proposal.costBreakdownMd ?? '');
  const [teamInfo, setTeamInfo] = useState(proposal.teamInfoMd ?? '');
  const [revenueSharing, setRevenueSharing] = useState(proposal.revenueSharingMd ?? '');
  // §3.4 — revenue-sharing gate checkbox (board verifies post-approval).
  const [revenueSharingRequired, setRevenueSharingRequired] = useState(!!proposal.revenueSharingRequired);
  const [ecosystemImpact, setEcosystemImpact] = useState(proposal.ecosystemImpactMd ?? '');
  const [successMetrics, setSuccessMetrics] = useState(proposal.successMetricsMd ?? '');
  const [payoutAddress, setPayoutAddress] = useState(proposal.payoutAddress ?? '');
  const [subcatIds, setSubcatIds] = useState<string[]>(proposal.subcategoryIds ?? []);
  const [amount, setAmount] = useState(proposal.requestedAmountAda);
  const [commercial, setCommercial] = useState(!!proposal.isCommercial);
  const [milestones, setMilestones] = useState(proposal.milestones.map((m) => ({
    title: m.title ?? '',
    description: m.description ?? '',
    acceptanceCriteria: m.acceptanceCriteria ?? '',
    amountAda: m.amountAda,
  })));
  // §3 — pledge (skin in the game). Editable inline alongside everything else
  // during the resubmit/DEBATE phases; locked once the team confirms it on-chain.
  const [pledgeEnabled, setPledgeEnabled] = useState((proposal.pledgeAmountAda ?? 0) > 0);
  const [pledgeAmount, setPledgeAmount] = useState<number>(proposal.pledgeAmountAda ?? 0);
  const [pledgeReturnMethod, setPledgeReturnMethod] = useState(proposal.pledgeReturnMethod ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §3/§7.4/§8.1 — versioned post-submission edit. Mirrors the backend ownEditable gate:
  //   - while the round is in SUBMISSION the team can polish a submitted (ACTIVE) proposal,
  //   - during the round's DEBATE window the team can revise based on reviewer feedback,
  //   - after a filtering rejection (REJECTED at FILTERING) while the round is still in
  //     FILTERING, until the resubmission budget is exhausted.
  // Pre-public states (DRAFT / PENDING / fee-rejected) edit in the full form, not here.
  const inSubmission = proposal.roundStatus === 'SUBMISSION' && proposal.status === 'ACTIVE';
  const inDebate = proposal.roundStatus === 'DEBATE' && proposal.status === 'ACTIVE';
  const canResubmit =
    proposal.status === 'REJECTED' &&
    proposal.stage === 'FILTERING' &&
    proposal.roundStatus === 'FILTERING' &&
    proposal.filterResubmissionsUsed < proposal.filterResubmissionsAllowed;
  const editable = inSubmission || inDebate || canResubmit;
  // Budget + milestones + pledge are unlocked in the resubmit cycle (the team
  // rebuilds after a filtering rejection) AND during DEBATE (the team revises
  // the whole proposal — no votes have been cast on the new shape yet, ballots
  // only start in VOTE). SUBMISSION polish keeps amount + milestones locked
  // because the fee was already quoted from the original amount — that path
  // uses the existing "Request a budget change" flow which settles the fee delta.
  const budgetEditable = canResubmit || inDebate;
  // Pledge follows the same rule: editable wherever the rest of the budget is.
  const pledgeEditable = budgetEditable && !proposal.pledgeConfirmedAt;
  if (!editable) return null;

  const milestoneSum = milestones.reduce((acc, m) => acc + Number(m.amountAda || 0), 0);
  const milestonesMatch = milestoneSum === Number(amount);

  const save = async () => {
    setError(null);
    if (budgetEditable && !milestonesMatch) {
      setError(`Milestones sum to ${milestoneSum.toLocaleString()} ₳ but must equal the requested amount ${Number(amount).toLocaleString()} ₳.`);
      return;
    }
    setBusy(true);
    try {
      await proposalEditApi.update(id, {
        title,
        contentMd: content,
        costBreakdownMd: costBreakdown,
        teamInfoMd: teamInfo,
        revenueSharingMd: revenueSharingRequired ? revenueSharing : '',
        revenueSharingRequired,
        ecosystemImpactMd: ecosystemImpact,
        successMetricsMd: successMetrics,
        payoutAddress,
        subcategoryIds: subcatIds,
        ...(budgetEditable
          ? {
              requestedAmountAda: Number(amount),
              isCommercial: commercial,
              milestones: milestones.map((m) => ({
                title: m.title.trim() || undefined,
                description: m.description,
                acceptanceCriteria: m.acceptanceCriteria.trim() || undefined,
                amountAda: Number(m.amountAda),
              })),
            }
          : {}),
        ...(pledgeEditable
          ? {
              pledgeAmountAda: pledgeEnabled && pledgeAmount > 0 ? Number(pledgeAmount) : 0,
              pledgeReturnMethod: pledgeEnabled ? (pledgeReturnMethod.trim() || undefined) : undefined,
            }
          : {}),
      });
      onOpenChange(false);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'edit failed');
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button onClick={() => onOpenChange(true)} className="mt-3 rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
        Edit proposal
      </button>
    );
  return (
    <div className="mt-3 space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">
        {budgetEditable
          ? 'Revise the proposal — every field including the budget and milestones (the submission-fee tx hash is locked).'
          : 'Edit the proposal text. The budget (amount + milestones) changes via "Request a budget change".'}
      </div>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Title</span>
        <input className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {budgetEditable ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            <span className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Requested ₳</span>
            <input type="number" className="mt-0.5 w-36 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} />
            Commercial / for profit
          </label>
        </div>
      ) : null}
      {/* Entering edit mode signals intent to edit — keep every section expanded so
          the submitter can see all editable fields, even the ones that were empty. */}
      <MarkdownEditor value={content} onChange={setContent} title="Pitch / summary" subtitle="What are you proposing to build, and why? Who is it for, what does it solve, and what makes it the right project at the right time?" placeholder="Proposal pitch (markdown)" minRows={6} />
      {budgetEditable ? (
        <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="text-sm font-medium">Milestones (must sum to the requested amount)</div>
          <div className="mt-1 space-y-2">
            {milestones.map((m, i) => {
              const set = (patch: Partial<typeof m>) =>
                setMilestones((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-500">Milestone {i + 1}</span>
                    {milestones.length > 1 ? (
                      <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setMilestones((p) => p.filter((_, j) => j !== i))}>remove</button>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-end gap-2">
                    <label className="flex-1">
                      <span className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Title</span>
                      <input className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" placeholder="Milestone title" value={m.title} onChange={(e) => set({ title: e.target.value })} />
                    </label>
                    <label>
                      <span className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Budget (₳)</span>
                      <input type="number" className="mt-0.5 w-32 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" value={m.amountAda} onChange={(e) => set({ amountAda: Number(e.target.value) })} />
                    </label>
                  </div>
                  <div className="mt-2">
                    <MarkdownEditor value={m.description} onChange={(v) => set({ description: v })} title="Description" placeholder="What is delivered in this milestone" minRows={3} required />
                  </div>
                  <div className="mt-2">
                    <MarkdownEditor value={m.acceptanceCriteria} onChange={(v) => set({ acceptanceCriteria: v })} title="Acceptance criteria" hint="how completion is judged" placeholder="How completion will be verified" minRows={3} />
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" className="mt-1 text-xs underline" onClick={() => setMilestones((p) => [...p, { title: '', description: '', acceptanceCriteria: '', amountAda: 0 }])}>+ add milestone</button>
          <div className={`mt-1 text-xs ${milestonesMatch ? 'text-emerald-600' : 'font-medium text-red-600'}`}>
            {milestonesMatch
              ? `✓ Milestones sum to ${milestoneSum.toLocaleString()} ₳ (matches requested).`
              : `⚠ Milestones sum to ${milestoneSum.toLocaleString()} ₳ but the requested amount is ${Number(amount).toLocaleString()} ₳ — they must be equal (off by ${Math.abs(milestoneSum - Number(amount)).toLocaleString()} ₳).`}
          </div>
        </div>
      ) : null}
      <MarkdownEditor value={ecosystemImpact} onChange={setEcosystemImpact} title="Expected ecosystem impact" subtitle="What specific benefit will the project have for the ecosystem? Who will the result serve, what problem does it solve and why should it be funded from community funds?" placeholder="Who benefits, what changes — short- and long-term." minRows={3} />
      <MarkdownEditor value={successMetrics} onChange={setSuccessMetrics} title="Success metrics / KPIs" subtitle="What measurable indicators will you use to evaluate the success of the project? Specify the target values, time frame and method of verification." placeholder="How will success be measured (with targets where you can)" minRows={3} />
      <MarkdownEditor value={costBreakdown} onChange={setCostBreakdown} title="Cost breakdown" hint="optional" placeholder="How the budget is spent" minRows={3} />
      <MarkdownEditor value={teamInfo} onChange={setTeamInfo} title="Team info" hint="optional" placeholder="Who is delivering this" minRows={3} />
      <RevenueSharingBlock
        required={revenueSharingRequired}
        onRequiredChange={setRevenueSharingRequired}
        text={revenueSharing}
        onTextChange={setRevenueSharing}
        submissionFeeAddress={cfg?.submissionFeeAddress ?? null}
      />
      <label className="block">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Payout / refund address (Cardano)</span>
        <input className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900" placeholder="addr_test1…" value={payoutAddress} onChange={(e) => setPayoutAddress(e.target.value)} />
      </label>
      {/* §3 — skin-in-the-game pledge. Same shape as the submission form.
          Locked once confirmed on-chain by the board (proposal in FUNDING). */}
      {pledgeEditable ? (
        <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pledgeEnabled} onChange={(e) => setPledgeEnabled(e.target.checked)} />
            <span className="font-medium">Skin in the game (refundable pledge — optional)</span>
          </label>
          {pledgeEnabled ? (
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                Pledge ₳
                <input
                  type="number"
                  className="w-32 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  value={pledgeAmount || ''}
                  onChange={(e) => setPledgeAmount(Number(e.target.value))}
                />
              </label>
              <MarkdownEditor
                value={pledgeReturnMethod}
                onChange={setPledgeReturnMethod}
                title="Pledge return method"
                subtitle="How and when will the pledge be returned? Common patterns: a slice with each milestone, or the full amount only after the final milestone."
                placeholder="Example: 25% returned after milestone 1, 25% after milestone 2, the rest after the final milestone."
                minRows={3}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <div>
        <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Expertise areas</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {DEFAULT_SUBCATEGORIES.map((s) => {
            const on = subcatIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSubcatIds((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border-neutral-300 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700'}`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
      <div className="flex gap-2">
        <button disabled={busy} onClick={save} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save (creates a new version)'}
        </button>
        <button onClick={() => onOpenChange(false)} className="text-xs text-neutral-500 hover:underline">cancel</button>
      </div>
    </div>
  );
}

/**
 * §12 — the submitter changes an ACTIVE proposal's budget. The new amount + milestones take
 * effect immediately; the fee difference becomes a top-up (more to pay) or refund the board
 * settles. Milestones must still sum to the new requested amount.
 */
function BudgetChangeSection({ id, proposal, onChange }: { id: string; proposal: PDetail; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(proposal.requestedAmountAda);
  const [ms, setMs] = useState(proposal.milestones.map((m) => ({ description: m.description ?? '', amountAda: m.amountAda })));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const sum = ms.reduce((a, m) => a + Number(m.amountAda || 0), 0);
  const match = sum === Number(amount);
  const delta = Number(amount) - proposal.requestedAmountAda;
  // §12 — while the round is in FILTERING, an APPROVED budget change clears the
  // jury's filtering votes (they re-vote on the revised budget). Capped per round
  // so the submitter can't repeatedly invalidate votes; separate counter from
  // post-rejection resubmissions.
  const invalidatesVotes = proposal.roundStatus === 'FILTERING';
  const budgetRemaining = Math.max(0, proposal.filterBudgetChangesAllowed - proposal.budgetChangesUsed);
  const budgetExhausted = invalidatesVotes && budgetRemaining === 0;
  const pending = proposal.pendingBudgetChange;

  const save = async () => {
    setError(null);
    setMsg(null);
    if (!match) { setError(`Milestones sum to ${sum.toLocaleString()} ₳ but must equal ${Number(amount).toLocaleString()} ₳.`); return; }
    setBusy(true);
    try {
      await proposalsApi.budgetChange(id, {
        requestedAmountAda: Number(amount),
        milestones: ms.map((m) => ({ description: m.description, amountAda: Number(m.amountAda) })),
        reason: reason.trim() || undefined,
      });
      setMsg('Budget change submitted — waiting for a board member to approve. Your existing reviewer votes stay until the board decides.');
      setOpen(false);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'budget change failed');
    } finally {
      setBusy(false);
    }
  };

  // A pending banner (visible to everyone, with approve/reject for board) is
  // rendered at the top of the proposal card — this section just hides while
  // there's a pending request so the submitter isn't tempted to file another.
  if (pending) return null;

  if (budgetExhausted) {
    return (
      <div className="mt-3">
        {msg ? <div className="mb-1 text-xs text-emerald-600">{msg}</div> : null}
        <div className="text-xs text-neutral-500">
          No in-filter budget changes left ({proposal.budgetChangesUsed} of {proposal.filterBudgetChangesAllowed} used) — the budget is locked for the rest of this round&apos;s filtering.
        </div>
      </div>
    );
  }
  if (!open)
    return (
      <div className="mt-3 space-y-1">
        {msg ? <div className="text-xs text-emerald-600">{msg}</div> : null}
        <button onClick={() => setOpen(true)} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
          Request a budget change
        </button>
        {invalidatesVotes ? (
          <div className="text-[11px] text-neutral-500">
            A budget change now needs board approval first. If they approve, the jury&apos;s filtering votes will be cleared and they re-vote on the revised budget. {budgetRemaining} of {proposal.filterBudgetChangesAllowed} budget change{proposal.filterBudgetChangesAllowed === 1 ? '' : 's'} remaining.
          </div>
        ) : null}
      </div>
    );
  return (
    <div className="mt-3 space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Request a budget change</div>
      <label className="block text-sm">
        New requested ₳
        <input type="number" className="ml-2 w-36 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </label>
      <div>
        <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Milestones (must sum to the new amount)</div>
        {ms.map((m, i) => (
          <div key={i} className="mt-1 flex flex-wrap items-center gap-2">
            <input className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" placeholder="description" value={m.description} onChange={(e) => setMs((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <input type="number" className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" value={m.amountAda} onChange={(e) => setMs((p) => p.map((x, j) => (j === i ? { ...x, amountAda: Number(e.target.value) } : x)))} />
            {ms.length > 1 ? <button type="button" className="text-xs text-red-600" onClick={() => setMs((p) => p.filter((_, j) => j !== i))}>remove</button> : null}
          </div>
        ))}
        <button type="button" className="mt-1 text-xs underline" onClick={() => setMs((p) => [...p, { description: '', amountAda: 0 }])}>+ add milestone</button>
        <div className={`mt-1 text-xs ${match ? 'text-emerald-600' : 'font-medium text-red-600'}`}>
          {match ? `✓ sums to ${sum.toLocaleString()} ₳` : `⚠ sums to ${sum.toLocaleString()} ₳ — must equal ${Number(amount).toLocaleString()} ₳`}
        </div>
      </div>
      <div className="text-xs text-neutral-500">
        {delta > 0
          ? 'Increasing the budget will create a submission-fee top-up the board collects on-chain.'
          : delta < 0
            ? 'Decreasing the budget will create a fee refund the board returns on-chain.'
            : 'Change the amount to create a fee top-up (increase) or refund (decrease).'}
      </div>
      {invalidatesVotes ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          ⚠ This request needs board approval first. If they approve, the jury&apos;s filtering votes will be cleared and they re-vote on the revised budget. {budgetRemaining} of {proposal.filterBudgetChangesAllowed} budget change{proposal.filterBudgetChangesAllowed === 1 ? '' : 's'} remaining for this round.
        </div>
      ) : null}
      <label className="block">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Reason for the change <span className="text-neutral-400">(optional — context for the board)</span></span>
        <textarea
          className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is the budget changing? What did you learn that motivated this?"
        />
      </label>
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
      <div className="flex gap-2">
        <button disabled={busy || delta === 0} onClick={save} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Submitting…' : 'Submit for board approval'}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-neutral-500 hover:underline">cancel</button>
      </div>
    </div>
  );
}

/**
 * §11 — funding-stage milestone review. The board allocates a reviewer set (one panel
 * for the whole proposal — every milestone shares the same 3 reviewers); the submitter
 * posts a POA per milestone (immutable once submitted; resubmit only after REJECTED);
 * reviewers vote 1p1v. Approved milestones auto-prepare a board PROJECT_FUNDING
 * payout. The section also surfaces the **stop-funding** flow (reviewer / board
 * proposes → board votes → 3 YES → FAILED).
 */
/**
 * §3 — pledge confirmation panel. Appears in FUNDING when a pledge was promised.
 *   - Submitter view: address + Copy + tx hash input ("Submit pledge tx") + status.
 *     If the board rejected an earlier attempt, the red feedback box is shown so
 *     the submitter can paste a corrected hash.
 *   - Board view: each submitted hash gets an on-chain verification chip (paid/
 *     not paid / not found) + Approve / Reject buttons. Reject requires feedback;
 *     Approve sets pledgeConfirmedAt and unlocks milestone POAs.
 *   - Everyone else: a read-only status badge so the proposal page makes sense.
 */
function PledgeSection({ id, proposal, isBoard, isMine, onChange }: { id: string; proposal: PDetail; isBoard: boolean; isMine: boolean; onChange: () => void }) {
  const { txUrl } = useExplorer();
  const [pledgeAddress, setPledgeAddress] = useState<string | null>(null);
  const [tx, setTx] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [pV, setPV] = useState<PledgeVerification | null>(null);

  useEffect(() => {
    configApi.get().then((c) => setPledgeAddress(c.pledgeAddress)).catch(() => setPledgeAddress(null));
  }, []);

  const confirmed = !!proposal.pledgeConfirmedAt;
  const paidNotConfirmed = !!proposal.pledgeTxHash && !confirmed;
  const notPaid = !proposal.pledgeTxHash && !confirmed;

  // §3 — auto on-chain verification of the saved pledge tx. Mirrors the
  // submission-fee flow: 700 ms after a hash becomes available, run the
  // chain check; then re-check every 10 s while not fully paid. Stops once
  // the board confirms (confirmed=true) or the hash is cleared.
  useEffect(() => { setPV(null); }, [proposal.pledgeTxHash]);
  useEffect(() => {
    if (!proposal.pledgeTxHash || confirmed) return;
    const delay = pV ? 10_000 : 700;
    const t = setTimeout(() => {
      proposalsApi.verifyPledge(id).then(setPV).catch(() => { /* keep last result */ });
    }, delay);
    return () => clearTimeout(t);
  }, [id, proposal.pledgeTxHash, confirmed, pV]);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await proposalsApi.pledgeTx(id, tx); setTx(''); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };

  const review = async (decision: 'APPROVE' | 'REJECT') => {
    if (decision === 'REJECT' && !feedback.trim()) { setError('A reason is required when rejecting a pledge.'); return; }
    setBusy(true); setError(null);
    try { await boardPledgeApi.review(id, decision, feedback || undefined); setFeedback(''); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };

  return (
    <section className={platformCard}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Proposer pledge (§3)</h3>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${
          confirmed
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
            : paidNotConfirmed
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
        }`}>
          {confirmed ? '✓ confirmed on-chain' : paidNotConfirmed ? 'paid, awaiting board confirmation' : 'pledge not paid yet'}
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        Pledge: <strong>{proposal.pledgeAmountAda.toLocaleString()} ₳</strong>
        {proposal.pledgeReturnMethod ? <> · return method shown below</> : null}
      </div>
      {proposal.pledgeReturnMethod ? (
        <div className="mt-2 rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-800/40">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Return method (set by the team)</div>
          <Markdown className="mt-0.5 text-neutral-700 dark:text-neutral-300">{proposal.pledgeReturnMethod}</Markdown>
        </div>
      ) : null}

      {/* Address (visible to everyone — payment is on-chain, the address is public). */}
      {!confirmed && pledgeAddress ? (
        <div className="mt-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Send the pledge to</div>
          <div className="mt-0.5 flex items-start gap-2">
            <div className="flex-1 break-all font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{pledgeAddress}</div>
            <CopyButton text={pledgeAddress} label="Copy address" />
          </div>
        </div>
      ) : null}

      {/* Board's rejection feedback (red box) so the submitter can fix + repaste. */}
      {proposal.pledgeFeedback && !confirmed ? (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
          <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-400">Board feedback</div>
          <div className="mt-0.5 whitespace-pre-wrap text-xs text-red-800 dark:text-red-300">{proposal.pledgeFeedback}</div>
        </div>
      ) : null}

      {/* The tx hash on file (link out to the explorer). */}
      {proposal.pledgeTxHash ? (
        <div className="mt-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Pledge tx</div>
          <a href={txUrl(proposal.pledgeTxHash)} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-emerald-700 underline dark:text-emerald-400">
            {proposal.pledgeTxHash} ↗
          </a>
        </div>
      ) : null}

      {/* §3 — automatic on-chain verification banner (mirrors the fee flow). */}
      {pV && !confirmed ? (
        <div
          className={`mt-2 rounded border p-2 text-xs ${
            pV.fullyPaid
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
              : !pV.koiosAvailable
                ? 'border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
                : pV.paidAda > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
          }`}
        >
          {pV.fullyPaid ? (
            <span>
              <strong>✓ Fully paid</strong> — {pV.paidAda.toLocaleString()} ₳ received at the pledge address
              (required {pV.requiredAda.toLocaleString()} ₳). Awaiting the board&apos;s final confirmation.
            </span>
          ) : !pV.koiosAvailable ? (
            <span>
              <strong>⚠ Couldn&apos;t reach the chain right now</strong> — Koios is throttling. Your hash is saved;
              the platform re-checks every ~10 s and the answer will appear here automatically.
            </span>
          ) : pV.paidAda > 0 ? (
            <span>
              <strong>Partial payment:</strong> {pV.paidAda.toLocaleString()} ₳ received,{' '}
              <strong>{pV.missingAda.toLocaleString()} ₳ still missing</strong>{' '}
              (required {pV.requiredAda.toLocaleString()} ₳). Send the rest and paste the new tx hash below.
            </span>
          ) : pV.tx && !pV.tx.found ? (
            <span>✗ The tx hash isn&apos;t on-chain yet. Re-checking every ~10 s — it will update automatically when the next block lands.</span>
          ) : (
            <span>✗ This tx didn&apos;t pay the pledge address. Did you send to the right address (shown above)?</span>
          )}
        </div>
      ) : null}

      {/* Submitter — paste tx hash (always available until confirmed). */}
      {isMine && !confirmed ? (
        <div className="mt-3 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            {notPaid ? 'Paste the on-chain tx hash to send your pledge' : 'Paste a corrected tx hash if the board rejected the previous one'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={tx}
              onChange={(e) => setTx(e.target.value)}
              placeholder="pledge tx hash (e.g. 43bce05db…)"
              className="flex-1 rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button disabled={busy || !tx.trim()} onClick={submit} className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
              {busy ? '…' : 'Submit pledge tx'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Board — approve / reject the pasted tx (only when one is pending review). */}
      {isBoard && paidNotConfirmed ? (
        <div className="mt-3 space-y-1 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Board: confirm the pledge payment</div>
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback (required to reject, optional to approve)"
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => review('APPROVE')} className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
              Approve (confirm on-chain payment)
            </button>
            <button disabled={busy} onClick={() => review('REJECT')} className="rounded border border-red-500 px-2.5 py-1 text-xs text-red-700 disabled:opacity-40 dark:text-red-300">
              Reject (team re-pastes)
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      {notPaid && !isMine ? (
        <div className="mt-2 text-xs text-neutral-500">Milestone POAs are blocked until the pledge is paid and the board confirms it.</div>
      ) : null}
    </section>
  );
}

function MilestonesSection({ id, isBoard, isMine, proposal, onChange }: { id: string; isBoard: boolean; isMine: boolean; proposal: PDetail; onChange: () => void }) {
  const [ms, setMs] = useState<MilestoneView[] | null>(null);
  // We need the round's milestone settings (reviewer count + approval votes)
  // — not just status — so the allocation panel + UI hints match the round's
  // own configuration instead of platform defaults.
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [showApproved, setShowApproved] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const load = useCallback(() => {
    milestonesApi.forProposal(id).then(setMs).catch(() => setMs([]));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!proposal.roundId) { setRound(null); return; }
    roundsApi.get(proposal.roundId).then(setRound).catch(() => setRound(null));
  }, [proposal.roundId]);
  if (!ms) return null;
  const noReviewers = ms.every((m) => m.reviewers.length === 0);
  const inFunding = (proposal.stage === 'FUNDING') && (proposal.status === 'APPROVED') && (round?.status === 'FUNDING');
  const stoppedOrDone = ['COMPLETE', 'FAILED'].includes(proposal.status);
  // Fall back to the per-milestone `threshold` (already round-aware) for the
  // approval-votes hint; reviewer count uses the round setting directly with a
  // 3 fallback (only hit while the round detail is still loading).
  const requiredReviewers = round?.settings.milestoneReviewerCount ?? 3;
  const requiredYes = round?.settings.milestoneApprovalVotes ?? ms[0]?.threshold ?? 2;

  // §11.2 — sequential gate. The "active" milestone is the first one that hasn't
  // been APPROVED yet. Earlier milestones are APPROVED (collapsible history);
  // later milestones are LOCKED until each preceding one is approved
  // (collapsible upcoming list so the team can see what's queued without the
  // POA form distracting them). This mirrors the backend rule in submitPoa.
  const approved = ms.filter((m) => m.status === 'APPROVED');
  const activeIdx = ms.findIndex((m) => m.status !== 'APPROVED');
  const active = activeIdx >= 0 ? ms[activeIdx] : null;
  const upcoming = activeIdx >= 0 ? ms.slice(activeIdx + 1) : [];

  return (
    <section className={platformCard}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Funding — milestones (§11)</h3>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>{approved.length}/{ms.length} approved</span>
          <span className="rounded border border-neutral-300 px-2 py-0.5 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
            Round rule: {requiredReviewers} reviewer{requiredReviewers === 1 ? '' : 's'} · {requiredYes} YES to approve
          </span>
          {!inFunding && !stoppedOrDone ? (
            <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Round is not in the FUNDING stage — POAs are closed
            </span>
          ) : null}
        </div>
      </div>

      {/* Reviewer allocation panel (board only) — shown before any POA is submitted. */}
      {isBoard && noReviewers && inFunding ? <ReviewerAllocationPanel id={id} target={requiredReviewers} onChange={() => { load(); onChange(); }} /> : null}

      {/* §11.1 — board's always-visible reviewer roster + per-proposal controls.
          The roster + swap controls live together so a board member can see at
          a glance who is on the jury and reassign without scrolling. The
          re-allocate button is only offered before any POA has been submitted
          (the backend rejects it afterwards); the swap panel is offered always
          (vacancy / illness / conflict can hit even mid-review). */}
      {isBoard && !noReviewers && active ? (
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">Currently assigned reviewers:</span>
            <span className="text-neutral-700 dark:text-neutral-300">
              {active.reviewers.map((r) => r.displayName ?? (r.drepIdOnchain?.slice(0, 14) + '…')).join(', ')}
            </span>
            {!ms.some((m) => m.poaCount > 0) ? (
              <>
                <span className="text-neutral-400">·</span>
                <span className="text-neutral-500">no POA submitted yet</span>
                <ReleaseReviewersButton id={id} onChange={() => { load(); onChange(); }} />
              </>
            ) : null}
          </div>
          <ReplaceMilestoneReviewerPanel id={id} reviewers={active.reviewers} onChange={() => { load(); onChange(); }} />
        </div>
      ) : null}

      {/* Stop-funding panel (reviewers + board may propose; board votes). */}
      <StopFundingPanel proposalId={id} canShowProposeButton={inFunding && !stoppedOrDone} isBoard={isBoard} onChange={() => { load(); onChange(); }} />

      {/* Past (approved) — collapsible so the active milestone is what the eye
          lands on. Approved milestones are immutable: read-only summary only. */}
      {approved.length > 0 ? (
        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
          <button
            type="button"
            onClick={() => setShowApproved((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200"
          >
            <span>✓ Approved milestones ({approved.length})</span>
            <span>{showApproved ? '▾ hide' : '▸ show'}</span>
          </button>
          {showApproved ? (
            <ul className="space-y-2 px-2 pb-2">
              {approved.map((m) => (
                <MilestoneRow key={m.id} m={m} isMine={isMine} canPoa={false} locked isBoard={isBoard} proposalId={id} onChange={() => { load(); onChange(); }} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Active milestone — the only one the submitter can act on right now.
          Rendered prominently (no collapse) so it's the focus of the section. */}
      {active ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Active milestone — #{active.idx + 1} of {ms.length}
          </div>
          <ul className="space-y-2">
            <MilestoneRow m={active} isMine={isMine} canPoa={inFunding} isBoard={isBoard} proposalId={id} onChange={() => { load(); onChange(); }} />
          </ul>
        </div>
      ) : null}

      {/* Upcoming (locked) — collapsible. Read-only; the submitter cannot post
          a POA until each preceding milestone is approved. Shown so the team
          can still see what's coming + reviewers/budget. */}
      {upcoming.length > 0 ? (
        <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setShowUpcoming((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
          >
            <span>🔒 Upcoming milestones ({upcoming.length}) — unlock one at a time as each prior milestone is approved</span>
            <span>{showUpcoming ? '▾ hide' : '▸ show'}</span>
          </button>
          {showUpcoming ? (
            <ul className="space-y-2 px-2 pb-2">
              {upcoming.map((m) => (
                <MilestoneRow key={m.id} m={m} isMine={isMine} canPoa={false} locked isBoard={isBoard} proposalId={id} onChange={() => { load(); onChange(); }} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * §11.1 — board's allocation UI. Pulls the candidate DReps with their **expertise match**
 * (subcategory overlap with the proposal) + **load this round** (how many milestone
 * reviews they're already on). Board ticks exactly the required number (per-round
 * override of `milestoneReviewerCount`) and confirms — the same set is assigned to every
 * milestone of the proposal.
 */
function ReviewerAllocationPanel({ id, target, onChange }: { id: string; target: number; onChange: () => void }) {
  const [cands, setCands] = useState<MilestoneCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    boardMilestoneApi.candidates(id).then(setCands).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [id]);

  const toggle = (cid: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const drepIds = [...picked].filter((p) => cands?.find((c) => c.id === p)?.kind === 'DRep');
      const expertIds = [...picked].filter((p) => cands?.find((c) => c.id === p)?.kind === 'Expert');
      await boardMilestoneApi.assign(id, drepIds, expertIds);
      setPicked(new Set());
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  if (!cands) return <div className="mt-2 text-xs text-neutral-500">Loading candidate reviewers…</div>;
  if (cands.length === 0) return <div className="mt-2 text-xs text-amber-700">No admitted DReps are eligible to review this round.</div>;

  const offBy = picked.size - target;
  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">Allocate milestone reviewers</div>
        <div className="text-xs text-neutral-500">
          Pick {target} DRep{target === 1 ? '' : 's'} · {picked.size} selected
        </div>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        ⭐ = expertise match (overlapping subcategories) · &nbsp;<span className="text-neutral-700 dark:text-neutral-300">load N</span> = how many milestone reviews this DRep is already on in this round.
      </p>
      <ul className="mt-2 max-h-72 overflow-y-auto rounded border border-neutral-200 dark:border-neutral-800">
        {cands.map((c) => {
          const sel = picked.has(c.id);
          return (
            <li key={c.id} className={`flex items-center justify-between gap-2 border-b border-neutral-200 px-2 py-1.5 text-xs last:border-b-0 dark:border-neutral-800 ${sel ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''}`}>
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={sel} onChange={() => toggle(c.id)} />
                <span className="font-medium">{c.displayName ?? (c.drepIdOnchain?.slice(0, 18) ?? c.id.slice(0, 8)) + '…'}</span>
                {c.kind === 'Expert' ? <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">Expert</span> : null}
                {c.matchedSubcategoryIds.length > 0 ? (
                  <span className="flex flex-wrap items-center gap-1" title="Subcategories shared with the proposal">
                    <span className="text-amber-600">⭐</span>
                    {c.matchedSubcategoryIds.map((sid) => (
                      <span key={sid} className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">{SUBCAT_LABEL[sid] ?? sid}</span>
                    ))}
                  </span>
                ) : null}
              </label>
              <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">load {c.loadInRound}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={confirm}
          disabled={busy || picked.size !== target}
          title={offBy === 0 ? 'Assign these reviewers' : `Pick exactly ${target} reviewer${target === 1 ? '' : 's'} (round setting)`}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
        >
          {busy ? 'Assigning…' : `Confirm ${picked.size} reviewer${picked.size === 1 ? '' : 's'}`}
        </button>
        {offBy !== 0 ? (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Pick exactly {target} reviewer{target === 1 ? '' : 's'} ({offBy > 0 ? `remove ${offBy}` : `add ${-offBy} more`}).
          </span>
        ) : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}

function ReleaseReviewersButton({ id, onChange }: { id: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const doRelease = async () => {
    setConfirming(false);
    setBusy(true); setErr(null);
    try { await boardMilestoneApi.release(id); onChange(); } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); } finally { setBusy(false); }
  };
  return (
    <>
      <button onClick={() => setConfirming(true)} disabled={busy} className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
        {busy ? '…' : 're-allocate'}
      </button>
      {err ? <span className="text-[11px] text-red-600">{err}</span> : null}
      <ConfirmDialog
        open={confirming}
        title="Release reviewers?"
        message="Release the current reviewers and pick a new set. Only allowed while no POA has been submitted yet."
        confirmLabel="Release"
        onConfirm={doRelease}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

/**
 * §11.1 — board swaps a single milestone reviewer (vacancy / illness / conflict
 * of interest). Mirrors the FILTERING reviewer-replace flow:
 *   - lists the currently-assigned reviewers (mirrored across every milestone),
 *   - lets the board pick one to replace + a candidate from the ranked list,
 *   - server-side gates: cast votes are final → can't swap a reviewer who has
 *     already voted on any milestone; new DRep must be admitted, not the
 *     submitter, not already on this proposal.
 */
function ReplaceMilestoneReviewerPanel({ id, reviewers, onChange }: { id: string; reviewers: MilestoneView['reviewers']; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<MilestoneCandidate[] | null>(null);
  const [oldDrepId, setOldDrepId] = useState<string>('');
  const [newDrepId, setNewDrepId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    boardMilestoneApi.candidates(id).then(setCands).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [open, id]);

  const assignedIds = new Set(reviewers.map((r) => r.drepId).filter(Boolean) as string[]);
  const eligibleNew = (cands ?? []).filter((c) => !assignedIds.has(c.drepId ?? ''));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await boardMilestoneApi.replaceReviewer(id, oldDrepId, newDrepId);
      setOldDrepId(''); setNewDrepId(''); setOpen(false); onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-2 text-xs">
        <button
          onClick={() => setOpen(true)}
          className="rounded border border-neutral-300 px-2 py-0.5 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          title="Swap an assigned reviewer (vacancy / illness / conflict of interest)"
        >
          ↻ Replace a reviewer
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded border border-neutral-300 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold">Replace a milestone reviewer</span>
        <button onClick={() => { setOpen(false); setError(null); }} className="text-neutral-500 hover:underline">cancel</button>
      </div>
      <div className="mb-1 text-[11px] text-neutral-500">
        Same reviewer set is mirrored across every milestone, so the swap applies to all of them. A reviewer who has already cast their vote cannot be replaced.
      </div>
      <div className="mb-2 text-[11px]">
        <span className="font-semibold text-neutral-600 dark:text-neutral-400">Currently assigned:</span>{' '}
        <span className="text-neutral-700 dark:text-neutral-300">
          {reviewers.map((r) => r.displayName ?? (r.drepIdOnchain?.slice(0, 14) + '…')).join(', ')}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] text-neutral-500">Old reviewer</span>
          <select value={oldDrepId} onChange={(e) => setOldDrepId(e.target.value)} className="mt-0.5 w-full rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
            <option value="">— pick the reviewer to swap out —</option>
            {reviewers.filter((r) => r.drepId).map((r) => (
              <option key={r.drepId!} value={r.drepId!}>{r.displayName ?? `${r.drepIdOnchain?.slice(0, 14)}…`}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Replacement</span>
          <select value={newDrepId} onChange={(e) => setNewDrepId(e.target.value)} disabled={!cands} className="mt-0.5 w-full rounded border border-neutral-300 px-1.5 py-0.5 text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900">
            <option value="">{cands ? '— pick a replacement DRep —' : 'Loading candidates…'}</option>
            {eligibleNew.filter((c) => c.kind === 'DRep' && c.drepId).map((c) => (
              <option key={c.drepId} value={c.drepId ?? ''}>
                {c.displayName ?? `${c.drepIdOnchain?.slice(0, 14)}…`}
                {c.expertiseMatch ? ' · expertise match' : ''} · load {c.loadInRound}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button disabled={busy || !oldDrepId || !newDrepId} onClick={submit} className="rounded border border-emerald-500 px-2 py-0.5 text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
          {busy ? '…' : 'Replace reviewer'}
        </button>
        {error ? <span className="text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}

/**
 * §11 — stop-funding panel: every proposal shows the current/history of stop-funding
 * proposals, a propose-button for assigned reviewers AND any board member (the server
 * enforces who is authorized), and per-row board YES/NO voting (board only). One
 * ACTIVE stop-funding per proposal at a time.
 */
function StopFundingPanel({ proposalId, canShowProposeButton, isBoard, onChange }: { proposalId: string; canShowProposeButton: boolean; isBoard: boolean; onChange: () => void }) {
  const [items, setItems] = useState<StopFundingView[]>([]);
  const [showHist, setShowHist] = useState(false);
  const [reason, setReason] = useState('');
  const [proposing, setProposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    milestonesApi.stopFundings(proposalId).then(setItems).catch(() => setItems([]));
  }, [proposalId]);
  useEffect(load, [load]);
  const active = items.find((s) => s.status === 'ACTIVE');
  const history = items.filter((s) => s.status !== 'ACTIVE');

  const submit = async () => {
    setBusy(true); setError(null);
    try { await milestonesApi.proposeStop(proposalId, reason); setReason(''); setProposing(false); load(); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };

  if (items.length === 0 && !canShowProposeButton) return null;

  return (
    <div className="mt-3 rounded-md border border-red-200 bg-red-50/50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-red-800 dark:text-red-200">⛔ Stop funding</div>
        {canShowProposeButton && !active && !proposing ? (
          <button onClick={() => setProposing(true)} className="rounded border border-red-400 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950">
            Propose stopping funding
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
        Any assigned reviewer or any board member may propose stopping a project mid-funding. The board votes 1 member · 1 vote — {items[0]?.threshold ?? 3} YES → project FAILED + on-chain anchor.
      </p>

      {proposing ? (
        <div className="mt-2 space-y-1">
          <textarea
            rows={3}
            placeholder="Reason for stopping funding (required, ≥ 10 chars) — what did the project fail to deliver, what concrete evidence supports it?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="flex items-center gap-2">
            <button onClick={submit} disabled={busy || reason.trim().length < 10} className="rounded border border-red-500 px-2 py-0.5 text-xs text-red-700 disabled:opacity-40 dark:text-red-300">
              {busy ? 'Proposing…' : 'Open stop-funding vote'}
            </button>
            <button onClick={() => { setProposing(false); setReason(''); setError(null); }} className="rounded border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">
              Cancel
            </button>
            {error ? <span className="text-xs text-red-600">{error}</span> : null}
          </div>
        </div>
      ) : null}

      {active ? <StopFundingRow s={active} isBoard={isBoard} onChange={() => { load(); onChange(); }} /> : null}
      {history.length > 0 ? (
        <div className="mt-2">
          <button onClick={() => setShowHist((v) => !v)} className="text-[11px] text-neutral-600 underline hover:text-neutral-800 dark:text-neutral-400">
            {showHist ? `▾ hide history (${history.length})` : `▸ show history (${history.length})`}
          </button>
          {showHist ? (
            <ul className="mt-1 space-y-1">
              {history.map((s) => <StopFundingRow key={s.id} s={s} isBoard={false} onChange={() => { /* read-only */ }} />)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StopFundingRow({ s, isBoard, onChange }: { s: StopFundingView; isBoard: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const vote = async (choice: 'YES' | 'NO') => {
    setBusy(true); setError(null);
    try { await milestonesApi.voteStop(s.id, choice, rationale || undefined); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-2 rounded border border-neutral-300 bg-white p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <StatusBadge status={s.status} cls={PROPOSAL_STATUS_CLS} />
          <span className="ml-2">Proposed by <span className="font-medium">{s.proposerName ?? s.proposerDrep ?? 'unknown'}</span> ({s.proposerRole === 'BOARD' ? 'board' : 'reviewer'})</span>
          <span className="ml-2 text-neutral-500">{fmtDateTime(s.createdAt)}</span>
        </span>
        <span className="tabular-nums text-neutral-500">
          {s.yes} YES / {s.no} NO (need {s.threshold}) <AnchorLink txHash={s.anchorTxHash} />
        </span>
      </div>
      <div className="mt-1 whitespace-pre-wrap rounded bg-neutral-100 p-1.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"><strong>Reason:</strong> {s.reason}</div>
      {s.votes.length > 0 ? <div className="mt-1"><Votes votes={s.votes} /></div> : null}
      {isBoard && s.status === 'ACTIVE' ? (
        <div className="mt-2 space-y-1">
          <input
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="rationale (required for NO)"
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => vote('YES')} className="rounded border border-red-500 px-2 py-0.5 text-xs text-red-700 disabled:opacity-40 dark:text-red-300">
              YES — stop funding
            </button>
            <button disabled={busy} onClick={() => vote('NO')} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
              NO — continue
            </button>
          </div>
          {error ? <div className="text-xs text-red-600">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function MilestoneRow({ m, isMine, canPoa, locked = false, isBoard = false, proposalId, onChange }: { m: MilestoneView; isMine: boolean; canPoa: boolean; locked?: boolean; isBoard?: boolean; proposalId?: string; onChange: () => void }) {
  const [poa, setPoa] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  // §11.5 — inline board "extend deadline" mini-form (no native prompt — house rule).
  const [extOpen, setExtOpen] = useState(false);
  const [extDays, setExtDays] = useState('30');
  const run = async (fn: () => Promise<unknown>) => {
    setError(null); setBusy(true);
    try { await fn(); onChange(); } catch (e) { setError(e instanceof Error ? e.message : 'failed'); } finally { setBusy(false); }
  };
  // POA is allowed iff: this row is the ACTIVE one (locked=false), the round is
  // in FUNDING, the milestone is not APPROVED, and it's NOT currently under
  // review (POA_SUBMITTED is immutable until reviewers decide). REJECTED →
  // resubmit. Locked rows (approved-past or upcoming) never show the form.
  const submitterCanPoa = !locked && isMine && canPoa && m.status !== 'APPROVED' && m.status !== 'POA_SUBMITTED';
  return (
    <li className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          Milestone #{m.idx + 1}{m.title ? ` — ${m.title}` : ''}
          <span className="text-neutral-500"> · {m.amountAda.toLocaleString()} ₳</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">
            {m.reviewers.length} reviewer{m.reviewers.length === 1 ? '' : 's'} · {m.yes} YES / {m.no} NO (need {m.threshold})
          </span>
          <StatusBadge status={m.status} cls={PROPOSAL_STATUS_CLS} />
          <AnchorLink txHash={m.anchorTxHash} />
          {/* §11/§15 — disbursement status: visible to everyone (the payment
              is on-chain, after all). PAID + tx link when CONFIRMED; otherwise
              "Payment pending (N/M sigs)" or "Payment ready — awaiting broadcast". */}
          <PayoutBadge payout={m.payout} />
        </div>
      </div>
      {m.reviewers.length > 0 ? (
        <div className="mt-0.5 text-[11px] text-neutral-500">
          Reviewers: {m.reviewers.map((r) => r.displayName ?? r.drepIdOnchain?.slice(0, 14) + '…').join(', ')}
        </div>
      ) : null}
      {/* §11.5 — POA deadline + extension state; the board may grant ONE extra extension. */}
      {m.deadlineAt || m.paidAt ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
          {m.deadlineAt ? (
            <span className={new Date(m.deadlineAt) < new Date() && m.status !== 'APPROVED' ? 'text-red-600' : ''}>
              POA deadline {new Date(m.deadlineAt).toLocaleDateString()}
              {m.autoExtendedCount > 0 ? ` · auto-extended ${m.autoExtendedCount}×` : ''}
              {m.boardExtendedAt ? ` · board +${m.boardExtensionDays}d` : ''}
            </span>
          ) : null}
          {m.paidAt ? <span className="text-emerald-600">✓ paid {new Date(m.paidAt).toLocaleDateString()}</span> : null}
          {isBoard && proposalId && m.status !== 'APPROVED' && !m.boardExtendedAt ? (
            extOpen ? (
              <span className="flex items-center gap-1">
                <input value={extDays} onChange={(e) => setExtDays(e.target.value)} className="w-14 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900" />
                <span>days</span>
                <button onClick={() => { const d = Number(extDays); if (d > 0) void run(() => boardDeadlinesApi.extendMilestone(proposalId, m.id, d)).then(() => setExtOpen(false)); }} disabled={busy} className="rounded bg-emerald-600 px-1.5 py-0.5 text-white disabled:opacity-40">OK</button>
                <button onClick={() => setExtOpen(false)} className="rounded border border-neutral-300 px-1.5 py-0.5 dark:border-neutral-700">✕</button>
              </span>
            ) : (
              <button onClick={() => setExtOpen(true)} disabled={busy} title="One-time board extension (§11.5)" className="rounded border border-neutral-300 px-1.5 py-0.5 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700">
                Extend deadline
              </button>
            )
          ) : null}
        </div>
      ) : null}
      {/* §11 — "What was promised": description + acceptance criteria pulled
          straight from the proposal submission. Shown ONLY on the active row
          so the reviewer can compare the promise against the POA below
          without scrolling; the same content for past/upcoming milestones
          is already rendered in the "Milestones" plan at the top of the
          proposal card, so we skip it on locked rows to avoid duplication. */}
      {!locked && (m.description || m.acceptanceCriteria) ? (
        <div className="mt-1 rounded border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">What the team promised to deliver</div>
          {m.description ? (
            <div className="mt-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Description</div>
              <Markdown className="text-neutral-700 dark:text-neutral-300">{m.description}</Markdown>
            </div>
          ) : null}
          {m.acceptanceCriteria ? (
            <div className="mt-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Acceptance criteria</div>
              <Markdown className="text-neutral-700 dark:text-neutral-300">{m.acceptanceCriteria}</Markdown>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-neutral-400">No acceptance criteria were provided at submission.</div>
          )}
        </div>
      ) : null}
      {m.latestPoa ? (
        <div className="mt-1 rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-800/50">
          <div className="font-medium">Proof of Achievement (attempt {m.latestPoa.attempt}{m.status === 'REJECTED' ? ' — REJECTED, may resubmit' : m.status === 'POA_SUBMITTED' ? ' — under review' : m.status === 'APPROVED' ? ' — APPROVED' : ''})</div>
          <Markdown className="mt-0.5 text-neutral-600 dark:text-neutral-400">{m.latestPoa.contentMd ?? ''}</Markdown>
        </div>
      ) : null}
      {/* Earlier (superseded) POA attempts — every entry was rejected. Collapsible
          so the current attempt stays prominent; lets the team / reviewers
          reference the prior submissions without scrolling. */}
      {m.pastPoas && m.pastPoas.length > 0 ? (
        <div className="mt-1 rounded border border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold text-neutral-500"
          >
            <span>Previous attempts ({m.pastPoas.length}) — all rejected, superseded by the current attempt</span>
            <span>{showPast ? '▾ hide' : '▸ show'}</span>
          </button>
          {showPast ? (
            <ul className="space-y-1 px-2 pb-2">
              {m.pastPoas.map((p) => (
                <li key={p.attempt} className="rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-800/40">
                  <div className="font-medium text-neutral-500">Attempt {p.attempt} — rejected (superseded)</div>
                  <Markdown className="mt-0.5 text-neutral-500 dark:text-neutral-400">{p.contentMd ?? ''}</Markdown>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {m.votes.length > 0 ? <div className="mt-1"><Votes votes={m.votes} /></div> : null}

      {/* Submitter posts the POA. Once submitted it's immutable until reviewers decide; only a
          REJECTED milestone allows another attempt (so the next POA can address the feedback). */}
      {submitterCanPoa ? (
        <div className="mt-2 space-y-1">
          <MarkdownEditor value={poa} onChange={setPoa} placeholder={m.status === 'REJECTED' ? 'New Proof of Achievement — address the reviewers\' feedback above' : 'Proof of Achievement (markdown + links)'} minRows={4} />
          <button disabled={busy || !poa.trim()} onClick={() => run(() => milestonesApi.submitPoa(m.id, poa))} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
            {m.status === 'REJECTED' ? `Submit attempt ${m.poaCount + 1}` : 'Submit POA'}
          </button>
        </div>
      ) : isMine && !locked && m.status === 'POA_SUBMITTED' ? (
        <div className="mt-2 text-xs text-neutral-500">Your POA is under review — you can resubmit only if the reviewers reject it.</div>
      ) : isMine && !locked && !canPoa && m.status !== 'APPROVED' ? (
        <div className="mt-2 text-xs text-amber-700">POA submission is closed (round is not in the FUNDING stage).</div>
      ) : isMine && locked && m.status !== 'APPROVED' ? (
        <div className="mt-2 text-xs text-amber-700">Locked — the previous milestone must be approved first.</div>
      ) : null}

      {/* Assigned reviewer votes when a POA is in review. Locked rows never vote
          (an active POA is by definition on the active milestone, not a locked one). */}
      {!isMine && !locked && m.status === 'POA_SUBMITTED' ? (
        <div className="mt-2 space-y-1">
          <MarkdownEditor value={rationale} onChange={setRationale} placeholder="feedback (required for NO)" minRows={3} />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(() => milestonesApi.vote(m.id, 'YES', rationale || undefined))} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300">YES — approve</button>
            <button disabled={busy} onClick={() => run(() => milestonesApi.vote(m.id, 'NO', rationale))} className="rounded border border-red-500 px-2 py-0.5 text-xs text-red-700 disabled:opacity-40 dark:text-red-300">NO — reject (resubmit needed)</button>
          </div>
        </div>
      ) : null}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </li>
  );
}

/**
 * §20.1 — public discussion under each proposal.
 *
 * Row tint:
 *   - reply (any author)              → yellow
 *   - submitter / team                 → grey
 *   - DAO member / DRep / board / expert → green
 *   - everyone else / [deleted]        → neutral
 *
 * Editor: MarkdownEditor everywhere — top-level "Add a public comment", per-row
 * reply box, and the inline edit on the viewer's own comment. The reply / edit
 * editors default-collapsed; the top-level "Add a comment" defaults-expanded so
 * the call to action is obvious.
 *
 * Visibility: each comment has its own per-row Hide / Show toggle. A single
 * "▾ Collapse all / ▸ Expand all" button under the section title flips every
 * row's state in one go (per-row toggling continues to work after).
 *
 * Posting: viewers (signed-out + roles=['VIEWER']) can read but cannot post;
 * the parent gates `canPost` accordingly. Edit / delete is owner-only inside
 * the 5-minute window (the backend rejects late edits with a clear message).
 */
const COMMENT_ROLES_GREEN = new Set(['Board member', 'DAO member', 'Expert']);

function commentTint(c: CommentNode): string {
  if (c.deleted) return 'border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-900/30';
  if (c.parentId) return 'border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30'; // reply → yellow
  // "This is mine" tint is for the viewer only — `isMine` is true only when the
  // signed-in viewer wrote the comment. Other viewers see the comment in its
  // author-class colour (voting-eligible purple / DRep-or-board green / etc.).
  // The Team badge (isSubmitter) still marks the submitter's posts for everyone.
  if (c.isMine) return 'border-neutral-300 bg-neutral-100/70 dark:border-neutral-700 dark:bg-neutral-900/50';
  // §8.1 — voting-eligible DReps render purple so the team can spot the
  // voters' perspective at a glance during the Debate phase.
  if (c.isVotingEligible)
    return 'border-purple-300 bg-purple-50/60 dark:border-purple-900 dark:bg-purple-950/30';
  if (c.author.role && COMMENT_ROLES_GREEN.has(c.author.role))
    return 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'; // DRep / board → green
  return 'border-neutral-200 dark:border-neutral-800';
}

function CommentsSection({ id, title, canPost }: { id: string; title: string; canPost: boolean }) {
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [allCollapsed, setAllCollapsed] = useState(false);
  // Per-comment expanded state — null = follow `allCollapsed`. Independent for
  // each row, so a Collapse-all + manual expand of one row leaves the rest closed.
  const [rowOpen, setRowOpen] = useState<Record<string, boolean>>({});
  const setOpen = (cid: string, v: boolean) => setRowOpen((m) => ({ ...m, [cid]: v }));
  const isOpen = (cid: string): boolean => (cid in rowOpen ? rowOpen[cid] : !allCollapsed);

  const load = useCallback(() => {
    commentsApi.list(id).then(setComments).catch(() => setComments([]));
  }, [id]);
  useEffect(load, [load]);

  const post = async (contentMd: string, parentId?: string) => {
    setBusy(true);
    try { await commentsApi.create(id, contentMd, parentId); setText(''); load(); } finally { setBusy(false); }
  };

  const total = comments.length + comments.reduce((s, c) => s + (c.replies?.length ?? 0), 0);

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Comments on &ldquo;{title}&rdquo;</h3>
        {comments.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              const next = !allCollapsed;
              setAllCollapsed(next);
              // Reset per-row overrides so the global state actually applies.
              setRowOpen({});
              void next;
            }}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {allCollapsed ? `▸ Expand all (${total})` : `▾ Collapse all (${total})`}
          </button>
        ) : null}
      </div>
      {canPost ? (
        <div className="mt-3">
          <MarkdownEditor
            value={text}
            onChange={setText}
            title="Add a public comment"
            placeholder="Share your view (markdown — bold, italic, bullets, links…)"
            minRows={3}
          />
          <button
            disabled={busy || !text.trim()}
            onClick={() => post(text)}
            className="mt-1 rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      ) : (
        <div className="mt-2 rounded border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60">
          Only signed-in DAO members (DReps, board, approved experts) and the proposal&apos;s team can post — viewers may read.
        </div>
      )}
      <ul className="mt-3 space-y-2">
        {comments.length === 0 ? <li className="text-sm text-neutral-500">No comments yet.</li> : null}
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            c={c}
            canPost={canPost}
            open={isOpen(c.id)}
            onToggle={() => setOpen(c.id, !isOpen(c.id))}
            replyOpen={(rid) => isOpen(rid)}
            replyOnToggle={(rid) => setOpen(rid, !isOpen(rid))}
            post={post}
            onChange={load}
          />
        ))}
      </ul>
    </section>
  );
}

const ROLE_CLS: Record<string, string> = {
  'Board member': 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  Expert: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  'DAO member': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
};
function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  return <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${ROLE_CLS[role] ?? 'bg-neutral-100 text-neutral-600'}`}>{role}</span>;
}
function TeamBadge() {
  return (
    <span className="ml-1.5 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
      Team
    </span>
  );
}
const nameOf = (a: CommentNode['author']) => a.displayName ?? (a.drepId ? `${a.drepId.slice(0, 16)}…` : 'Anonymous');

function CommentItem({
  c,
  canPost,
  open,
  onToggle,
  replyOpen,
  replyOnToggle,
  post,
  onChange,
}: {
  c: CommentNode;
  canPost: boolean;
  open: boolean;
  onToggle: () => void;
  replyOpen: (id: string) => boolean;
  replyOnToggle: (id: string) => void;
  /** §20.1 — `post(text, parentId)` so each comment can be its own reply target;
   *  nested replies attach to THEIR parent (not the top-level), arbitrary depth. */
  post: (text: string, parentId?: string) => void | Promise<void>;
  onChange: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(c.contentMd ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveEdit = async () => {
    if (!editText.trim()) { setError('Comment cannot be empty.'); return; }
    setBusy(true); setError(null);
    try { await commentsApi.edit(c.id, editText); setEditing(false); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'edit failed'); }
    finally { setBusy(false); }
  };

  const remove = () => setConfirmDelete(true);
  const doRemove = async () => {
    setConfirmDelete(false);
    setBusy(true); setError(null);
    try { await commentsApi.remove(c.id); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'delete failed'); }
    finally { setBusy(false); }
  };

  return (
    <li className={`rounded border p-2 text-sm ${commentTint(c)}`}>
      <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {nameOf(c.author)}
          {c.isSubmitter ? <TeamBadge /> : null}
          <RoleBadge role={c.author.role} />
        </span>
        <span className="flex items-center gap-2">
          <span>{fmtDateTime(c.createdAt)}</span>
          <button
            onClick={onToggle}
            className="rounded px-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            title={open ? 'Hide this comment' : 'Show this comment'}
          >
            {open ? '▾' : '▸'}
          </button>
        </span>
      </div>

      {open ? (
        <>
          {editing ? (
            <div className="mt-1">
              <MarkdownEditor value={editText} onChange={setEditText} placeholder="Edit your comment…" minRows={3} />
              <div className="mt-1 flex gap-2">
                <button disabled={busy} onClick={saveEdit} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300">{busy ? 'Saving…' : 'Save'}</button>
                <button disabled={busy} onClick={() => { setEditing(false); setEditText(c.contentMd ?? ''); setError(null); }} className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">Cancel</button>
                {error ? <span className="text-xs text-red-600">{error}</span> : null}
              </div>
            </div>
          ) : c.deleted ? (
            <div className="mt-1 italic text-neutral-400">[deleted]</div>
          ) : (
            <Markdown className="mt-1 text-sm">{c.contentMd ?? ''}</Markdown>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
            {canPost && !c.deleted ? (
              <button onClick={() => setReplying((v) => !v)} className="text-neutral-500 hover:underline">
                {replying ? 'cancel reply' : 'reply'}
              </button>
            ) : null}
            {c.isMine && !c.deleted && !editing ? (
              <>
                <button onClick={() => { setEditing(true); setEditText(c.contentMd ?? ''); }} className="text-emerald-700 hover:underline dark:text-emerald-400">edit</button>
                <button onClick={remove} className="text-red-600 hover:underline">delete</button>
              </>
            ) : null}
          </div>

          {replying ? (
            <div className="mt-1">
              <MarkdownEditor value={replyText} onChange={setReplyText} title="Reply" placeholder="Reply…" minRows={2} />
              <button
                onClick={() => { post(replyText, c.id); setReplyText(''); setReplying(false); }}
                disabled={!replyText.trim()}
                className="mt-1 rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
              >
                Send reply
              </button>
            </div>
          ) : null}

          {c.replies && c.replies.length > 0 ? (
            <ul className="mt-2 space-y-2 border-l border-neutral-200 pl-3 dark:border-neutral-800">
              {c.replies.map((r) => (
                <CommentItem
                  key={r.id}
                  c={r}
                  canPost={canPost}
                  open={replyOpen(r.id)}
                  onToggle={() => replyOnToggle(r.id)}
                  replyOpen={replyOpen}
                  replyOnToggle={replyOnToggle}
                  post={post}
                  onChange={onChange}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete comment?"
        message="The comment will show as [deleted] but stay in the thread."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={doRemove}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}
