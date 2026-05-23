'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
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

const card =
  'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';

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
  const isRegisteredDRep = profile.onchainDrep.registered;
  const daoStatus = profile.daoMembership?.status ?? null;
  const daoPending = daoStatus === 'PENDING_ADMISSION';
  const expertApproved = !!myExpert?.approvedByBoard;
  const expertPending = !!myExpert && !myExpert.approvedByBoard;

  // §14 — once accepted (DAO member or approved expert) or pending, no apply options.
  const showApply = !isBoard && !isMember && !daoPending && !expertApproved && !expertPending;

  return (
    <div className="space-y-6">
      {/* Removal vote against me (self-hides if none). */}
      <RemovalBanner />

      {/* DAO member: status + DRep ID first, then editable profile. */}
      {isMember ? (
        <>
          <section className={card}>
            <MyDrepStatus />
          </section>
          <section className={card}>
            <h3 className="text-base font-semibold">Your DRep profile</h3>
            <p className="mb-3 text-sm text-neutral-500">
              {isBoard ? 'As a board member you are a DAO member.' : 'You are a DAO member.'} Keep your
              details up to date.
            </p>
            <DrepForm mode="profile" />
          </section>
        </>
      ) : null}

      {/* Pending DAO applicant: progress + board rationales. */}
      {daoPending ? (
        <section className={card}>
          <MyDrepStatus />
        </section>
      ) : null}

      {/* Expert (pending or approved): self-managed status/form. */}
      {(expertPending || expertApproved) && !isMember ? (
        <section className={card}>
          <ExpertApplyForm onChange={loadExpert} />
        </section>
      ) : null}

      {/* Not yet anything → choose how to participate. */}
      {showApply ? (
        <section className={card}>
          <ApplyOptions registeredDRep={isRegisteredDRep} onExpertChange={loadExpert} />
        </section>
      ) : null}

      {/* Board pending requests — below the personal info. */}
      {isBoard ? (
        <>
          {/* Treasury/hot-wallet actions the platform prepared, awaiting 3-of-5 (self-hides if none). */}
          <BoardActions />
          <section className={card}>
            <BoardReviewPanel />
          </section>
          <section className={card}>
            <ExpertReviewPanel />
          </section>
          <section className={card}>
            <RemovalPanel />
          </section>
        </>
      ) : null}

      <FilteringPanel />
      <VotingPanel />
      <ProposalSubmit />
    </div>
  );
}

/** §14 — both participation routes; pick one (until accepted). */
function ApplyOptions({
  registeredDRep,
  onExpertChange,
}: {
  registeredDRep: boolean;
  onExpertChange: () => void;
}) {
  const [mode, setMode] = useState<'choose' | 'dao' | 'expert'>('choose');

  if (mode === 'dao') {
    return (
      <div className="space-y-2">
        <button onClick={() => setMode('choose')} className="text-xs text-neutral-500 hover:underline">
          ← back
        </button>
        {registeredDRep ? (
          <>
            <h3 className="text-base font-semibold">Request to join the DAO</h3>
            <DrepForm mode="join" />
          </>
        ) : (
          <p className="text-sm text-neutral-500">
            To join as a DAO member your wallet must be a registered on-chain DRep. Register your DRep key
            (e.g. Eternl → Governance → Register as a DRep), then sign in again. Meanwhile you can apply as an
            Expert.
          </p>
        )}
      </div>
    );
  }
  if (mode === 'expert') {
    return (
      <div className="space-y-2">
        <button onClick={() => setMode('choose')} className="text-xs text-neutral-500 hover:underline">
          ← back
        </button>
        <ExpertApplyForm onChange={onExpertChange} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">How do you want to participate?</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => setMode('dao')}
          className="rounded-lg border border-neutral-200 p-3 text-left hover:border-emerald-400 dark:border-neutral-700"
        >
          <div className="font-medium">Join as a DAO member</div>
          <div className="text-xs text-neutral-500">
            For registered on-chain DReps. Board votes 3-of-5 to admit. You then vote on proposals.
          </div>
        </button>
        <button
          onClick={() => setMode('expert')}
          className="rounded-lg border border-neutral-200 p-3 text-left hover:border-emerald-400 dark:border-neutral-700"
        >
          <div className="font-medium">Apply as an Expert</div>
          <div className="text-xs text-neutral-500">
            For ADA holders with subject-matter knowledge. Board approves; you provide your expertise.
          </div>
        </button>
      </div>
    </div>
  );
}
