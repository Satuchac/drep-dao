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
    <div className="min-h-screen">
      {/* Top bar: title left; profile + logout (+ JOIN DAO) top-right. */}
      <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <h1 className="text-xl font-bold tracking-tight">DRep DAO</h1>
        <div className="w-72 space-y-2">
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
      </header>

      <div className="flex gap-6 px-6 py-6">
        {/* Left: menu only. */}
        <aside className="w-56 shrink-0">
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

        <main className="min-w-0 flex-1">
          {view === 'overview' ? <DaoOverview /> : null}
          {view === 'me' ? <MemberArea /> : null}
          {view === 'rounds' ? <RoundsSection /> : null}
        </main>
      </div>
    </div>
  );
}
