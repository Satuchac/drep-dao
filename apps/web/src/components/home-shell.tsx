'use client';

import { useAuth } from '@/lib/auth-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { ConnectWallet } from './connect-wallet';
import { MemberArea } from './member-area';
import { RoundsSection } from './rounds-section';
import { DaoOverview } from './dao-overview';
import { GovernanceSetup } from './governance-setup';
import { OnChainProofs } from './on-chain-proofs';
import { TreasuryOverview } from './treasury-overview';
import { ActiveProposals } from './active-proposals';
import { ProposalDetail } from './proposal-detail';
import { JoinDaoButton } from './join-dao-button';
import { NotificationBadge } from './notification-badge';
import { HealthBadge } from '@/app/health-badge';

type View = 'overview' | 'me' | 'rounds' | 'proposals' | 'proofs' | 'treasury' | 'setup';
const NAV: { key: View; label: string; boardOnly?: boolean }[] = [
  { key: 'overview', label: 'DAO Member overview' },
  { key: 'me', label: 'My area' },
  { key: 'rounds', label: 'Rounds' },
  { key: 'proposals', label: 'Proposals' },
  { key: 'proofs', label: 'On-chain proofs' },
  { key: 'treasury', label: 'Treasury' },
  { key: 'setup', label: 'Platform setup', boardOnly: true },
];

export function HomeShell() {
  const { profile, loading } = useAuth();
  const { get, setParams } = useUrlNav();
  // The active menu view + an optionally-open proposal come from the URL, so every screen
  // (and any open proposal) has its own shareable link. Switching the menu clears submenu state.
  const view = (NAV.some((n) => n.key === get('view')) ? get('view') : 'overview') as View;
  const openProposal = get('proposal');
  const setView = (v: View) => setParams({ view: v, tab: null, round: null, proposal: null });

  // Logged out (or restoring): centered landing with the wallet login.
  if (loading || !profile) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">DRep DAO</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Cardano governance platform (Preprod).
        </p>
        <div className="mt-6 rounded-xl border border-neutral-300 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <ConnectWallet />
        </div>
        <div className="mt-8 border-t border-neutral-200 pt-3 text-xs text-neutral-400 dark:border-neutral-800">
          <HealthBadge />
        </div>
      </main>
    );
  }

  const isBoard = profile.roles.includes('BOARD');
  const nav = NAV.filter((n) => !n.boardOnly || isBoard);
  const canJoin =
    profile.onchainDrep.registered &&
    !isBoard &&
    !profile.roles.includes('DAO_MEMBER') &&
    profile.daoMembership?.status !== 'PENDING_ADMISSION';

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:flex-row">
      {/* Left: title + menu only. */}
      <aside className="lg:w-56 lg:shrink-0">
        <h1 className="mb-4 text-xl font-bold tracking-tight">DRep DAO</h1>
        <nav className="space-y-1">
          {nav.map((n) => (
            <button
              key={n.key}
              onClick={() => setView(n.key)}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                view === n.key
                  ? 'bg-emerald-600 font-medium text-white'
                  : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-400 dark:border-neutral-800">
          <HealthBadge />
        </div>
      </aside>

      {/* Center: content starts at the top. A ?proposal=<id> link shows that proposal on
          top of whatever view is selected, so proposal URLs are shareable from anywhere. */}
      <main className="order-last min-w-0 flex-1 lg:order-none">
        {openProposal ? (
          <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <ProposalDetail id={openProposal} onBack={() => setParams({ proposal: null })} />
          </section>
        ) : view === 'overview' ? (
          <DaoOverview />
        ) : view === 'me' ? (
          <MemberArea />
        ) : view === 'rounds' ? (
          <RoundsSection />
        ) : view === 'proposals' ? (
          <ActiveProposals />
        ) : view === 'proofs' ? (
          <OnChainProofs />
        ) : view === 'treasury' ? (
          <TreasuryOverview />
        ) : view === 'setup' && isBoard ? (
          <GovernanceSetup />
        ) : null}
      </main>

      {/* Right: login box (+ JOIN DAO). */}
      <div className="space-y-2 lg:w-72 lg:shrink-0">
        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <ConnectWallet />
          {/* Jump straight to My area → Actions (not the default Profile tab). */}
          <NotificationBadge onClick={() => setParams({ view: 'me', tab: 'sign', round: null, proposal: null })} />
          <button
            onClick={() => setView('me')}
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            View profile →
          </button>
        </div>
        {canJoin ? <JoinDaoButton onJoin={() => setView('me')} /> : null}
      </div>
    </div>
  );
}
