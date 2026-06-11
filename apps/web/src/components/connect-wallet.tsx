'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import type { Cip30WalletEntry } from '@/lib/cip30';

/** Primary login — Cardano wallet. Recognizes the wallet and shows the role. */
export function ConnectWallet() {
  const { profile, loading, wallets, login, logout, refreshWallets } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (profile) {
    // §2 — show a single status. A registered on-chain DRep who hasn't joined the DAO is a
    // "Registered DRep" (eligible to request membership), distinct from a plain ADA-holder Viewer.
    const base = profile.roles.includes('BOARD')
      ? 'Board member'
      : profile.roles.includes('DAO_MEMBER')
        ? 'DAO member'
        : profile.onchainDrep.registered
          ? 'Registered DRep'
          : 'Viewer';
    // §2.1 — an approved submitter shows "<base> | submitter".
    const status = profile.roles.includes('SUBMITTER') ? `${base} | submitter` : base;
    return (
      <div className="space-y-1.5 text-sm">
        {/* §2 — name on top, role/status beneath. */}
        <div className="flex items-center gap-2">
          <span className="text-emerald-600 dark:text-emerald-400">●</span>
          <span className="font-medium">{profile.user.displayName ?? 'Signed in'}</span>
        </div>
        <div className="text-xs text-neutral-500">{status}</div>
        {/* Show the DRep ID only when the wallet is actually a registered on-chain DRep. A
            derivable DRep key on an unregistered wallet (a plain ADA holder) is NOT a DRep
            identity — showing it here made Viewers look like DReps. */}
        {profile.onchainDrep.registered && profile.onchainDrep.drepId ? (
          <div className="break-all font-mono text-xs text-neutral-500">{profile.onchainDrep.drepId}</div>
        ) : null}
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
        <Link href="/admin/login" className="underline hover:text-neutral-600">
          Admin login
        </Link>
      </div>
    </div>
  );
}
