'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { expertApi, type MyExpert } from '@/lib/api';
import { DrepForm } from './drep-form';
import { MyDrepStatus } from './my-drep-status';
import { BoardReviewPanel } from './board-review-panel';
import { ExpertReviewPanel } from './expert-review-panel';
import { ExpertApplyForm } from './expert-apply-form';
import { RemovalPanel } from './removal-panel';
import { RemovalBanner } from './removal-banner';
import { ProposalSubmit } from './proposal-submit';
import { FilteringPanel } from './filtering-panel';
import { VotingPanel } from './voting-panel';
import { BoardActions } from './board-actions';
import { RoundStageControls } from './round-stage-controls';
import { FeeConfirmations } from './fee-confirmations';
import { BoardPayments } from './board-payments';
import { PreferencesPanel } from './preferences-panel';
import { LeaveDao } from './leave-dao';

const card = 'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';

export function MemberArea() {
  const { profile, loading } = useAuth();
  const [myExpert, setMyExpert] = useState<MyExpert | null>(null);
  const loadExpert = useCallback(() => {
    expertApi.mine().then(setMyExpert).catch(() => setMyExpert(null));
  }, []);
  useEffect(loadExpert, [loadExpert]);

  if (loading || !profile) return null;

  const isBoard = profile.roles.includes('BOARD');
  const isMember = profile.roles.includes('DAO_MEMBER');
  const isDrep = profile.roles.includes('DREP');
  const isRegisteredDRep = profile.onchainDrep.registered;
  const daoStatus = profile.daoMembership?.status ?? null;
  const daoPending = daoStatus === 'PENDING_ADMISSION';
  const expertApproved = !!myExpert?.approvedByBoard;
  const expertPending = !!myExpert && !myExpert.approvedByBoard;
  const showApply = !isBoard && !isMember && !daoPending && !expertApproved && !expertPending;

  // §2 — split My area into horizontal tabs instead of one long page.
  const tabs: { key: string; label: string; node: React.ReactNode }[] = [];

  tabs.push({
    key: 'profile',
    label: isMember ? 'Profile' : expertApproved || expertPending ? 'Expert' : 'Get started',
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
        <section className={card}><PreferencesPanel /></section>
      </div>
    ),
  });

  if (isMember || isDrep || expertApproved) {
    tabs.push({
      key: 'voting',
      label: 'Voting & reviews',
      node: (
        <div className="space-y-6">
          <p className="text-sm text-neutral-500">Everything awaiting your vote or review — filtering juries, Debate &amp; Vote, and milestone reviews.</p>
          <FilteringPanel />
          <VotingPanel />
          <EmptyHint text="Nothing is awaiting your vote right now." />
        </div>
      ),
    });
  }

  tabs.push({
    key: 'proposals',
    label: 'My proposals',
    node: (
      <div className="space-y-4">
        <ProposalSubmit />
      </div>
    ),
  });

  if (isBoard) {
    tabs.push({
      key: 'sign',
      label: 'Actions',
      node: (
        <div className="space-y-6">
          <p className="text-sm text-neutral-500">
            Board to-dos: treasury/hot-wallet approvals, submission-fee confirmations, and budget-change settlements (top-ups to collect / refunds to return).
          </p>
          <BoardActions />
          <FeeConfirmations />
          <BoardPayments />
          <EmptyHint text="Nothing to do right now." />
        </div>
      ),
    });
    tabs.push({ key: 'rounds', label: 'Round control', node: <RoundStageControls /> });
    tabs.push({
      key: 'apps',
      label: 'Applications',
      node: (
        <div className="space-y-6">
          <section className={card}><BoardReviewPanel /></section>
          <section className={card}><ExpertReviewPanel /></section>
          <section className={card}><RemovalPanel /></section>
        </div>
      ),
    });
  }

  return <MemberTabs tabs={tabs} />;
}

function MemberTabs({ tabs }: { tabs: { key: string; label: string; node: React.ReactNode }[] }) {
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
            onClick={() => setParams({ tab: t.key })}
            className={`rounded-md px-3 py-1.5 text-sm ${
              active === t.key
                ? 'bg-emerald-600 font-medium text-white'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            {t.label}
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
        <button onClick={() => setMode('choose')} className="text-xs text-neutral-500 hover:underline">← back</button>
        {registeredDRep ? (
          <>
            <h3 className="text-base font-semibold">Request to join the DAO</h3>
            <DrepForm mode="join" />
          </>
        ) : (
          <p className="text-sm text-neutral-500">
            To join as a DAO member your wallet must be a registered on-chain DRep. Register your DRep key (e.g. Eternl →
            Governance → Register as a DRep), then sign in again. Meanwhile you can apply as an Expert.
          </p>
        )}
      </div>
    );
  }
  if (mode === 'expert') {
    return (
      <div className="space-y-2">
        <button onClick={() => setMode('choose')} className="text-xs text-neutral-500 hover:underline">← back</button>
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
