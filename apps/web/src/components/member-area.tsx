'use client';

import { useAuth } from '@/lib/auth-context';
import { DrepApplicationForm } from './drep-application-form';
import { MyDrepStatus } from './my-drep-status';
import { BoardReviewPanel } from './board-review-panel';
import { ProposalSubmit } from './proposal-submit';

const card =
  'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';

/** Authenticated member area: board review + the user's own DRep application/status. */
export function MemberArea() {
  const { profile, loading } = useAuth();
  if (loading || !profile) return null;

  const isBoard = profile.roles.includes('BOARD');
  const status = profile.drep?.status ?? null;
  const showForm = status === null || status === 'REJECTED' || status === 'REMOVED';

  return (
    <div className="mt-6 space-y-6">
      {isBoard ? (
        <section className={card}>
          <BoardReviewPanel />
        </section>
      ) : null}

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

      <ProposalSubmit />
    </div>
  );
}
