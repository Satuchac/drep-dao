'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import type { Cip30WalletEntry } from '@/lib/cip30';

const ROLE_LABEL: Record<string, string> = {
  VIEWER: 'Viewer',
  SUBMITTER: 'Submitter',
  DREP: 'DRep',
  BOARD: 'Board member',
};

/** Primary login — Cardano wallet. Recognizes the stake key and shows the role. */
export function ConnectWallet() {
  const { profile, loading, wallets, login, logout, refreshWallets } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (profile) {
    const top =
      profile.roles.includes('BOARD')
        ? 'Board member'
        : profile.roles.includes('DREP')
          ? 'DRep'
          : 'ADA holder (Viewer)';
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-emerald-600 dark:text-emerald-400">●</span>
          <span className="font-medium">Signed in — {top}</span>
        </div>
        <div className="break-all font-mono text-xs text-neutral-500">{profile.user.stakeAddress}</div>
        <div className="flex flex-wrap gap-1">
          {profile.roles.map((r) => (
            <span key={r} className="rounded bg-neutral-200 px-2 py-0.5 text-xs dark:bg-neutral-800">
              {ROLE_LABEL[r] ?? r}
            </span>
          ))}
        </div>
        <div className="text-xs text-neutral-500">
          DRep status: {profile.drep ? profile.drep.status : 'not a DRep (apply below)'}
        </div>
        <button
          onClick={() => logout()}
          className="mt-1 rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Log out
        </button>
      </div>
    );
  }

  const handleLogin = async (entry: Cip30WalletEntry) => {
    setError(null);
    setBusy(entry.key);
    try {
      await login(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">Sign in with your Cardano wallet</div>
        <div className="text-xs text-neutral-500">
          The platform reads your stake key and grants your role automatically.
          {loading ? ' Checking existing session…' : ''}
        </div>
      </div>

      {wallets.length === 0 ? (
        <div className="text-sm text-neutral-500">
          No CIP-30 wallet detected.{' '}
          <button onClick={refreshWallets} className="underline">
            Re-scan
          </button>{' '}
          after installing/enabling Eternl, Lace, etc. (set the wallet to <strong>Preprod</strong>).
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {wallets.map((w) => (
            <button
              key={w.key}
              disabled={busy !== null}
              onClick={() => handleLogin(w)}
              className="flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {w.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.icon} alt="" width={18} height={18} />
              ) : null}
              {busy === w.key ? 'Check your wallet…' : `Connect ${w.name}`}
            </button>
          ))}
        </div>
      )}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="pt-1 text-xs text-neutral-400">
        Platform operator?{' '}
        <Link href="/sysadmin/login" className="underline hover:text-neutral-600">
          Admin login
        </Link>
      </div>
    </div>
  );
}
