'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { expertApi, drepApi, treasuryApi, boardFeeApi, boardPaymentsApi, boardPledgeApi, boardRevenueApi, boardApi, boardExpertsApi, removalApi, filteringApi, internalProposalsApi, messagesApi, milestonesApi, proposalsApi, rewardAddressApi, type MyExpert, type EntryEligibility, type BoardAction } from '@/lib/api';
import { DrepForm } from './drep-form';
import { EntryRequirementsNotice } from './join-dao-button';
import { MyDrepStatus } from './my-drep-status';
import { BoardReviewPanel } from './board-review-panel';
import { ExpertReviewPanel } from './expert-review-panel';
import { ExpertApplyForm } from './expert-apply-form';
import { RemovalPanel } from './removal-panel';
import { RemovalBanner } from './removal-banner';
import { ProposalSubmit } from './proposal-submit';
import { FilteringPanel } from './filtering-panel';
import { VotingPanel } from './voting-panel';
import { MilestoneReviewsPanel } from './milestone-reviews-panel';
import { BoardActions } from './board-actions';
import { StopFundingBoardPanel } from './stop-funding-board-panel';
import { RoundStageControls } from './round-stage-controls';
import { InternalProposals } from './internal-proposals';
import { FeeConfirmations } from './fee-confirmations';
import { RevenueSharingConfirmations } from './revenue-sharing-confirmations';
import { BoardMessages, SubmitterMessages } from './proposal-messages';
import { PledgeConfirmations } from './pledge-confirmations';
import { BoardPayments } from './board-payments';
import { PreferencesPanel } from './preferences-panel';
import { RewardAddressPanel } from './reward-address-panel';
import { MeritPanel } from './merit-panel';
import { RewardsTab } from './rewards-tab';
import { MultisigSetup } from './multisig-setup';
import { HotWalletControls } from './hot-wallet-controls';
import { SendFromTreasuryPanel } from './send-from-treasury-panel';
import { TreasuryBucketsPanel } from './treasury-buckets-panel';
import { LeaveDao } from './leave-dao';
import { BackButton } from './round-ui';

const card = 'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';

export function MemberArea() {
  const { profile, loading } = useAuth();
  const [myExpert, setMyExpert] = useState<MyExpert | null>(null);
  const loadExpert = useCallback(() => {
    expertApi.mine().then(setMyExpert).catch(() => setMyExpert(null));
  }, []);
  useEffect(loadExpert, [loadExpert]);

  const isBoard = !!profile?.roles.includes('BOARD');
  const canVote = !!profile && (profile.roles.includes('DREP') || profile.roles.includes('DAO_MEMBER') || profile.roles.includes('BOARD'));
  const todo = useTodoCounts(isBoard, canVote); // red-circle counts for Actions / Applications / Voting & reviews

  if (loading || !profile) return null;

  const isMember = profile.roles.includes('DAO_MEMBER');
  const isDrep = profile.roles.includes('DREP');
  const isRegisteredDRep = profile.onchainDrep.registered;
  const daoStatus = profile.daoMembership?.status ?? null;
  const daoPending = daoStatus === 'PENDING_ADMISSION';
  const expertApproved = !!myExpert?.approvedByBoard;
  const expertPending = !!myExpert && !myExpert.approvedByBoard;
  const showApply = !isBoard && !isMember && !daoPending && !expertApproved && !expertPending;

  // §2 — split My area into horizontal tabs instead of one long page.
  const tabs: { key: string; label: string; node: React.ReactNode; badge?: number }[] = [];

  tabs.push({
    key: 'profile',
    label: isMember ? 'Profile' : expertApproved || expertPending ? 'Expert' : 'Get started',
    badge: todo.profile,
    node: (
      <div className="space-y-6">
        {isMember ? (
          <>
            <section className={card}><MyDrepStatus /></section>
            <section className={card}>
              <h3 className="text-base font-semibold">Your DRep profile</h3>
              <p className="mb-3 text-sm text-neutral-500">
                {isBoard ? 'As a board member you are a DAO member.' : 'You are a DAO member.'} Keep your details up to date.
              </p>
              <DrepForm mode="profile" />
              {/* §14 — any DAO member can voluntarily leave; a board member also steps down. */}
              <LeaveDao isBoard={isBoard} />
            </section>
          </>
        ) : daoPending ? (
          <section className={card}><MyDrepStatus /></section>
        ) : expertPending || expertApproved ? (
          <section className={card}><ExpertApplyForm onChange={loadExpert} /></section>
        ) : showApply ? (
          <section className={card}><ApplyOptions registeredDRep={isRegisteredDRep} onExpertChange={loadExpert} /></section>
        ) : null}
        {/* §15.4 — DReps + board members register a payment address here so
            they can receive rewards. Amber-nags when empty. */}
        {isMember ? <RewardAddressPanel /> : null}
        {/* §13 — merit points + ledger + avoid-period (vacancy) signalling. */}
        {isMember ? <section className={card}><MeritPanel /></section> : null}
        <section className={card}><PreferencesPanel /></section>
      </div>
    ),
  });

  if (isMember || isDrep || expertApproved) {
    tabs.push({
      key: 'voting',
      label: 'Voting & reviews',
      badge: todo.voting,
      node: <VotingReviewsTab />,
    });
    // §10 — internal proposals (DAO governance): submit + browse + vote. Same component as
    // the left-nav "Internal proposals" view; the tab adds a notification badge for items
    // awaiting THIS DRep's vote.
    tabs.push({
      key: 'internal',
      label: 'Internal proposals',
      badge: todo.internal,
      node: <InternalProposals />,
    });
  }

  tabs.push({
    key: 'proposals',
    label: 'My proposals',
    badge: todo.mine,
    node: (
      <div className="space-y-4">
        <ProposalSubmit />
      </div>
    ),
  });

  // §3.5 — submitter's Messages tab: appears once the board has messaged them about a proposal.
  if (todo.messagesTotal > 0) {
    tabs.push({ key: 'messages', label: 'Messages', badge: todo.messages, node: <SubmitterMessages /> });
  }

  if (isBoard) {
    // §15 — Treasury is its own tab. Multisig setup, hot-wallet controls,
    // approve-and-sign (BoardActions), and the board-initiated send-ADA flow
    // all live here; Actions stays for the non-treasury board to-dos.
    tabs.push({ key: 'treasury', label: 'Treasury', badge: todo.treasury, node: <TreasuryTab /> });
    tabs.push({ key: 'sign', label: 'Actions', badge: todo.actions, node: <ActionsTab /> });
    tabs.push({ key: 'rounds', label: 'Round control', node: <RoundStageControls /> });
    tabs.push({ key: 'rewards', label: 'Rewards', node: <RewardsTab /> });
    tabs.push({ key: 'apps', label: 'Applications', badge: todo.applications, node: <ApplicationsTab /> });
  }

  return <MemberTabs tabs={tabs} />;
}

/**
 * "Voting & reviews" tab for DReps / DAO members / experts — filtering juries, D&V,
 * milestone reviews. Mirrors the Actions/Applications pattern with a "Show history"
 * switch that also reveals decided assignments (passed → APPROVED/REJECTED rounds).
 */
function VotingReviewsTab() {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">Everything awaiting your vote or review — filtering juries, Debate &amp; Vote, and milestone reviews.</p>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Show history
        </label>
      </div>
      <FilteringPanel history={showHistory} />
      <VotingPanel history={showHistory} />
      <MilestoneReviewsPanel history={showHistory} />
      <EmptyHint text={showHistory ? 'No votes — past or present.' : 'Nothing is awaiting your vote right now.'} />
    </div>
  );
}

/** Board "Treasury" tab: everything that touches the multisig — setup, hot
 *  wallet controls, the board-initiated send-ADA form, and the Approve&sign
 *  queue. Separated from Actions so the latter stays focused on review/audit
 *  to-dos (fees, pledges, stop-funding, budget settlements). */
function TreasuryTab() {
  const [showHistory, setShowHistory] = useState(false);
  // Bump on any treasury-affecting action (queue transfer, top-up, sweep) so
  // BoardActions immediately refetches and the new pending row appears
  // without a page reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((n) => n + 1);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">
          Treasury operations: multisig setup, hot-wallet top-ups/sweeps, board-initiated transfers, and the
          Approve&nbsp;&amp;&nbsp;sign queue for every multisig action.
        </p>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Show history
        </label>
      </div>
      <MultisigSetup />
      <TreasuryBucketsPanel onChange={bumpRefresh} />
      <HotWalletControls onChange={bumpRefresh} />
      <SendFromTreasuryPanel onChange={bumpRefresh} />
      <BoardActions history={showHistory} refreshKey={refreshKey} onChange={bumpRefresh} filter="non-rewards" />
    </div>
  );
}

/** Board "Actions" tab: review/audit to-dos that aren't treasury moves —
 *  submission-fee confirmations, pledge confirmations, stop-funding votes,
 *  budget-change settlements. */
function ActionsTab() {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">
          Board to-dos: reward payouts to review &amp; sign, submission-fee confirmations, pledge
          confirmations, revenue-sharing verification, stop-funding votes, and budget-change
          settlements. Other multisig signing and hot-wallet ops live in <strong>Treasury</strong>.
        </p>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Show history
        </label>
      </div>
      <BoardActions history={showHistory} filter="rewards" />
      <BoardMessages />
      <RevenueSharingConfirmations />
      <StopFundingBoardPanel />
      <FeeConfirmations history={showHistory} />
      <PledgeConfirmations />
      <BoardPayments history={showHistory} />
      <EmptyHint text={showHistory ? 'No actions — past or present.' : 'Nothing to do right now.'} />
    </div>
  );
}

/** Board "Applications" tab: DRep & Expert applications + member removals, with the same
 *  "Show history" switch as Actions — resolved items appear marked as done. */
function ApplicationsTab() {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">Review DRep &amp; Expert applications and member-removal votes.</p>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Show history
        </label>
      </div>
      <section className={card}><BoardReviewPanel history={showHistory} /></section>
      <section className={card}><ExpertReviewPanel history={showHistory} /></section>
      <section className={card}><RemovalPanel history={showHistory} /></section>
    </div>
  );
}

/**
 * Red-circle counts for the My-area tabs = items still awaiting THIS member: the board's
 * Actions (treasury/fees/payments) + Applications (DRep/Expert apps + removals not yet voted),
 * the voter's "Voting & reviews" tasks (filtering + D&V + milestone), and the §10 "Internal
 * proposals" awaiting this DRep's vote. Light polling.
 */
function useTodoCounts(isBoard: boolean, canVote: boolean) {
  const [counts, setCounts] = useState({ treasury: 0, actions: 0, applications: 0, voting: 0, internal: 0, mine: 0, profile: 0, messages: 0, messagesTotal: 0 });
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const next = { treasury: 0, actions: 0, applications: 0, voting: 0, internal: 0, mine: 0, profile: 0, messages: 0, messagesTotal: 0 };
      // §3.5 — submitter's board messages: total (drives the Messages tab) + unread (board spoke
      // last on an OPEN thread → the submitter still has to respond). Runs for everyone.
      try {
        const mineMsgs = await messagesApi.mine();
        next.messagesTotal = mineMsgs.length;
        next.messages = mineMsgs.filter((t) => t.status === 'OPEN' && t.lastFromBoard).length;
      } catch { /* leave at 0 */ }
      if (isBoard) {
        const [a, f, p, dapps, eapps, rem, stop, pl, rev, msg] = await Promise.allSettled([
          treasuryApi.boardActions(),
          boardFeeApi.pending(),
          boardPaymentsApi.pending(),
          boardApi.listApplications(),
          boardExpertsApi.applications(),
          removalApi.list(),
          milestonesApi.pendingStopFunding(), // §11 — stop-funding awaiting THIS board member's 1p1v vote
          boardPledgeApi.pending(), // §3 — pledge payments to confirm
          boardRevenueApi.pending(), // §3.4 — revenue-sharing to verify (gates milestone POAs)
          messagesApi.boardPending(), // §3.5 — submitter replies awaiting the board
        ]);
        // §15 — multisig sign queue (boardActions) is the Treasury tab; the
        // remaining review/audit items (fees, pledges, payouts, stop-funding)
        // stay in Actions.
        // §12 — reward payouts are signed under Actions, other multisig actions under Treasury.
        const acts = a.status === 'fulfilled' ? a.value.actions : [];
        // Only badge an action the current board member still has to act on — once they've
        // authorized (phase 1) or signed (phase 2), it's waiting on others, not their to-do.
        const needsMe = (x: BoardAction) => (x.phase === 'AUTHORIZE' ? !x.mineCommitted : !x.mineApproved);
        next.treasury = acts.filter((x) => x.kind !== 'REWARD_PAYOUT' && needsMe(x)).length;
        next.actions =
          acts.filter((x) => x.kind === 'REWARD_PAYOUT' && needsMe(x)).length +
          (f.status === 'fulfilled' ? f.value.length : 0) +
          (p.status === 'fulfilled' ? p.value.length : 0) +
          (stop.status === 'fulfilled' ? stop.value.count : 0) +
          (pl.status === 'fulfilled' ? pl.value.length : 0) +
          (rev.status === 'fulfilled' ? rev.value.length : 0) +
          (msg.status === 'fulfilled' ? msg.value.length : 0);
        next.applications =
          (dapps.status === 'fulfilled' ? dapps.value.filter((x) => !x.myVote).length : 0) +
          (eapps.status === 'fulfilled' ? eapps.value.length : 0) +
          (rem.status === 'fulfilled' ? rem.value.filter((x) => !x.myVote).length : 0);
      }
      if (canVote) {
        try { next.voting = (await filteringApi.votingTasks()).total; } catch { /* leave 0 */ }
        try { next.internal = (await internalProposalsApi.pendingCount()).count; } catch { /* 0 */ }
        // §15.4 — reward earners need a reward payment address; nag on the Profile
        // tab until one is set. Submitters/viewers don't earn rewards → no nag.
        try { const r = await rewardAddressApi.get(); if (!r.rewardPaymentAddress) next.profile += 1; } catch { /* 0 */ }
      }
      // §11.2 — count submitter to-dos: any of my proposals with a REJECTED
      // milestone needing a fresh POA. Backend tags those rows red with a
      // "POA rejected" label in the enrichment, so we just count them.
      try {
        const mine = await proposalsApi.mine();
        next.mine = mine.filter((p) => p.progress?.tone === 'red' && p.progress.label.includes('POA rejected')).length;
      } catch { /* 0 */ }
      if (alive) setCounts(next);
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [isBoard, canVote]);
  return counts;
}

function MemberTabs({ tabs }: { tabs: { key: string; label: string; node: React.ReactNode; badge?: number }[] }) {
  // The active tab lives in the URL (?tab=) so My-area submenu links are shareable.
  const { get, setParams } = useUrlNav();
  const fromUrl = get('tab');
  const active = tabs.some((t) => t.key === fromUrl) ? fromUrl : tabs[0]?.key;
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div className="space-y-4">
      <RemovalBanner />
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            // Clear per-tab sub-navigation (e.g. an opened internal proposal `ip`) so clicking
            // a tab always reliably lands on its top-level list, not a stale detail view.
            onClick={() => setParams({ tab: t.key, ip: null })}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
              active === t.key
                ? 'bg-emerald-600 font-medium text-white'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            {t.label}
            {/* Red count of new items to process (Actions / Applications). */}
            {t.badge ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white tabular-nums">
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div>{current?.node}</div>
    </div>
  );
}

/** A muted fallback shown beneath self-hiding panels so an empty tab isn't blank. */
function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-neutral-400">{text}</p>;
}

/** §14 — both participation routes; pick one (until accepted). */
function ApplyOptions({ registeredDRep, onExpertChange }: { registeredDRep: boolean; onExpertChange: () => void }) {
  const [mode, setMode] = useState<'choose' | 'dao' | 'expert'>('choose');

  if (mode === 'dao') {
    return (
      <div className="space-y-2">
        <BackButton onBack={() => setMode('choose')} />
        <DaoJoinBody registeredDRep={registeredDRep} />
      </div>
    );
  }
  if (mode === 'expert') {
    return (
      <div className="space-y-2">
        <BackButton onBack={() => setMode('choose')} />
        <ExpertApplyForm onChange={onExpertChange} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">How do you want to participate?</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <button onClick={() => setMode('dao')} className="rounded-lg border border-neutral-200 p-3 text-left hover:border-emerald-400 dark:border-neutral-700">
          <div className="font-medium">Join as a DAO member</div>
          <div className="text-xs text-neutral-500">For registered on-chain DReps. Board votes 3-of-5 to admit. You then vote on proposals.</div>
        </button>
        <button onClick={() => setMode('expert')} className="rounded-lg border border-neutral-200 p-3 text-left hover:border-emerald-400 dark:border-neutral-700">
          <div className="font-medium">Apply as an Expert</div>
          <div className="text-xs text-neutral-500">For ADA holders with subject-matter knowledge. Board approves; you provide your expertise.</div>
        </button>
      </div>
    </div>
  );
}

/**
 * §14.1/§14.3 — the "request to join the DAO" body. A registered on-chain DRep gets the
 * application form, but only once they meet the configured entry gates (voting power /
 * delegators / activity); if a gate is enabled and unmet, the specific shortfalls are shown
 * in place of the form. An unregistered wallet is told to register its DRep key first.
 */
function DaoJoinBody({ registeredDRep }: { registeredDRep: boolean }) {
  const [elig, setElig] = useState<EntryEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!registeredDRep) { setLoading(false); return; }
    drepApi.entryEligibility().then(setElig).catch(() => setElig(null)).finally(() => setLoading(false));
  }, [registeredDRep]);

  if (!registeredDRep) {
    return (
      <p className="text-sm text-neutral-500">
        To join as a DAO member your wallet must be a registered on-chain DRep. Register your DRep key (e.g. Eternl →
        Governance → Register as a DRep), then sign in again. Meanwhile you can apply as an Expert.
      </p>
    );
  }
  if (loading) return <p className="text-sm text-neutral-500">Checking your entry eligibility…</p>;

  const blocked = !!elig && elig.gatingEnabled && !elig.eligible;
  if (blocked) {
    return (
      <div className="space-y-2">
        <h3 className="text-base font-semibold">Request to join the DAO</h3>
        <p className="text-sm text-neutral-500">
          The DAO currently enforces minimum entry requirements. You can apply once you meet them:
        </p>
        <EntryRequirementsNotice requirements={elig!.requirements} />
      </div>
    );
  }
  return (
    <>
      <h3 className="text-base font-semibold">Request to join the DAO</h3>
      <DrepForm mode="join" />
    </>
  );
}
