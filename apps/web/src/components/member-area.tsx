'use client';

import { useAuth } from '@/lib/auth-context';
import { DrepApplicationForm } from './drep-application-form';
import { MyDrepStatus } from './my-drep-status';
import { BoardReviewPanel } from './board-review-panel';
import { ExpertsPanel } from './experts-panel';
import { ProposalSubmit } from './proposal-submit';
import { FilteringPanel } from './filtering-panel';
import { VotingPanel } from './voting-panel';

const card =
  'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';

/** Authenticated member area: board review + the user's own DRep application/status. */
export function MemberArea() {
  const { profile, loading } = useAuth();
  if (loading || !profile) return null;

  const isBoard = profile.roles.includes('BOARD');
  const isRegisteredDRep = profile.onchainDrep.registered;
  const status = profile.daoMembership?.status ?? null;
  // Only a registered on-chain DRep can request to join the DAO. ADA holders
  // (not registered) can still view and submit proposals, but cannot join.
  const showForm =
    isRegisteredDRep && (status === null || status === 'REJECTED' || status === 'REMOVED');

  return (
    <div className="mt-6 space-y-6">
      {isBoard ? (
        <section className={card}>
          <BoardReviewPanel />
        </section>
      ) : null}

      {isBoard ? <ExpertsPanel /> : null}

      {status !== null ? (
        <section className={card}>
          <MyDrepStatus />
        </section>
      ) : null}

      {showForm ? (
        <section className={card}>
          <DrepApplicationForm />
        </section>
      ) : null}

      {!isRegisteredDRep ? (
        <section className={card}>
          <h3 className="text-base font-semibold">ADA holder</h3>
          <p className="mt-1 text-sm text-neutral-500">
            Your wallet is not a registered on-chain DRep, so you can browse rounds and submit
            proposals, but you can&apos;t join the DAO as a voting member. To become a DRep, register
            your DRep key on-chain (e.g. Eternl → Governance → Register as a DRep), then sign in again.
          </p>
        </section>
      ) : null}

      <FilteringPanel />

      <VotingPanel />

      <ProposalSubmit />
    </div>
  );
}
