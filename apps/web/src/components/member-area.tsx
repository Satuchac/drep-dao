'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { DrepForm } from './drep-form';
import { MyDrepStatus } from './my-drep-status';
import { BoardReviewPanel } from './board-review-panel';
import { ExpertsPanel } from './experts-panel';
import { ProposalSubmit } from './proposal-submit';
import { FilteringPanel } from './filtering-panel';
import { VotingPanel } from './voting-panel';

const card =
  'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';

/** Authenticated member area: board review, DAO membership (join or profile), participation. */
export function MemberArea() {
  const { profile, loading } = useAuth();
  if (loading || !profile) return null;

  const isBoard = profile.roles.includes('BOARD');
  const isMember = profile.roles.includes('DAO_MEMBER');
  const isRegisteredDRep = profile.onchainDrep.registered;
  const status = profile.daoMembership?.status ?? null;
  const pending = status === 'PENDING_ADMISSION';
  const canJoin = isRegisteredDRep && !isBoard && !isMember && !pending;

  return (
    <div className="mt-6 space-y-6">
      {isBoard ? (
        <section className={card}>
          <BoardReviewPanel />
        </section>
      ) : null}

      {isBoard ? <ExpertsPanel /> : null}

      {/* DAO member (board or admitted): status + editable profile — no "join" prompt. */}
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

      {/* Pending applicant: show progress (approvals + board rationales). */}
      {pending ? (
        <section className={card}>
          <MyDrepStatus />
        </section>
      ) : null}

      {/* Registered DRep, not a member yet: invite to join. */}
      {canJoin ? (
        <section className={card}>
          <JoinDao previouslyRejected={status === 'REJECTED' || status === 'REMOVED'} />
        </section>
      ) : null}

      {/* Not a registered on-chain DRep → plain ADA holder. */}
      {!isRegisteredDRep && !isBoard ? (
        <section className={card}>
          <h3 className="text-base font-semibold">ADA holder</h3>
          <p className="mt-1 text-sm text-neutral-500">
            Your wallet is not a registered on-chain DRep, so you can browse and submit proposals, but
            can&apos;t join the DAO as a voting member. To become a DRep, register your DRep key on-chain
            (e.g. Eternl → Governance → Register as a DRep), then sign in again.
          </p>
        </section>
      ) : null}

      <FilteringPanel />
      <VotingPanel />
      <ProposalSubmit />
    </div>
  );
}

/** "JOIN DAO" call to action → reveals the membership request form. */
function JoinDao({ previouslyRejected }: { previouslyRejected: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="space-y-2">
        <h3 className="text-base font-semibold">Join the DAO</h3>
        <p className="text-sm text-neutral-500">
          Your wallet is a registered on-chain DRep. Request to become a DAO member — the board reviews
          and votes (3 of 5 must approve).
          {previouslyRejected ? ' Your previous request was not approved; you may apply again.' : ''}
        </p>
        <button
          onClick={() => setOpen(true)}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          JOIN DAO
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="text-base font-semibold">Request to join the DAO</h3>
      <DrepForm mode="join" />
    </div>
  );
}
