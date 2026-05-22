'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ConnectWallet } from './connect-wallet';
import { MemberArea } from './member-area';
import { RoundsSection } from './rounds-section';
import { DaoOverview } from './dao-overview';
import { HealthBadge } from '@/app/health-badge';

type View = 'overview' | 'me' | 'rounds';
const NAV: { key: View; label: string }[] = [
  { key: 'overview', label: 'DAO Member overview' },
  { key: 'me', label: 'My area' },
  { key: 'rounds', label: 'Rounds' },
];

export function HomeShell() {
  const { profile, loading } = useAuth();
  const [view, setView] = useState<View>('overview');

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

  const canJoin =
    profile.onchainDrep.registered &&
    !profile.roles.includes('BOARD') &&
    !profile.roles.includes('DAO_MEMBER') &&
    profile.daoMembership?.status !== 'PENDING_ADMISSION';

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:flex-row">
      {/* Left: title + menu only. */}
      <aside className="lg:w-56 lg:shrink-0">
        <h1 className="mb-4 text-xl font-bold tracking-tight">DRep DAO</h1>
        <nav className="space-y-1">
          {NAV.map((n) => (
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

      {/* Center: content starts at the top. */}
      <main className="order-last min-w-0 flex-1 lg:order-none">
        {view === 'overview' ? <DaoOverview /> : null}
        {view === 'me' ? <MemberArea /> : null}
        {view === 'rounds' ? <RoundsSection /> : null}
      </main>

      {/* Right: login box (+ JOIN DAO). */}
      <div className="space-y-2 lg:w-72 lg:shrink-0">
        <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <ConnectWallet />
          <button
            onClick={() => setView('me')}
            className="mt-2 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            View profile →
          </button>
        </div>
        {canJoin ? (
          <button
            onClick={() => setView('me')}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            JOIN DAO
          </button>
        ) : null}
      </div>
    </div>
  );
}
