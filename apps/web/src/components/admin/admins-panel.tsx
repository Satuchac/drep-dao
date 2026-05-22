'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminRow } from '@/lib/admin-api';

export function AdminsPanel({ currentAdminId }: { currentAdminId: string }) {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminApi.admins().then(setAdmins).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token } = await adminApi.accounts.invite(username.trim(), email.trim());
      setInviteUrl(`${window.location.origin}/admin/accept-invite?token=${token}`);
      setUsername('');
      setEmail('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'invite failed');
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, kind: 'remove' | 'disable') => {
    if (!window.confirm(`${kind} this admin?`)) return;
    setError(null);
    try {
      await adminApi.accounts[kind](id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${kind} failed`);
    }
  };

  const field =
    'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-amber-500';

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Admins ({admins.filter((a) => a.status === 'ACTIVE').length} active)
        </h2>
        <button
          onClick={() => setInviteOpen((v) => !v)}
          className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
        >
          {inviteOpen ? 'Cancel' : 'Invite admin'}
        </button>
      </div>

      {inviteOpen ? (
        <form onSubmit={invite} className="mb-3 space-y-2 rounded border border-slate-800 p-3">
          <input className={field} placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input className={field} placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-500 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create invitation'}
          </button>
        </form>
      ) : null}

      {inviteUrl ? (
        <div className="mb-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs">
          <div className="mb-1 font-medium text-amber-300">Share this one-time link (24h):</div>
          <code className="block break-all text-amber-200">{inviteUrl}</code>
        </div>
      ) : null}

      <ul className="space-y-1 text-sm">
        {admins.map((a) => (
          <li key={a.id} className="flex items-center justify-between rounded border border-slate-800 px-3 py-1.5">
            <span>
              {a.username} <span className="text-slate-500">· {a.email}</span>
              {a.id === currentAdminId ? <span className="ml-1 text-xs text-amber-400">(you)</span> : null}
            </span>
            <span className="flex items-center gap-2">
              <span className={a.status === 'ACTIVE' ? 'text-emerald-400' : 'text-slate-500'}>{a.status}</span>
              {a.status === 'ACTIVE' ? (
                <>
                  <button onClick={() => act(a.id, 'disable')} className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800">
                    Disable
                  </button>
                  <button onClick={() => act(a.id, 'remove')} className="rounded border border-red-700 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950">
                    Remove
                  </button>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {error ? <div className="mt-2 text-sm text-red-400">{error}</div> : null}
    </section>
  );
}
