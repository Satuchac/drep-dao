'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type GenesisState } from '@/lib/admin-api';

export function AdminGenesis() {
  const [state, setState] = useState<GenesisState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi.genesis
      .state()
      .then(setState)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  const onFile = async (file: File) => {
    setError(null);
    setMsg(null);
    try {
      const genesis = JSON.parse(await file.text());
      const res = await adminApi.genesis.upload(genesis);
      setMsg(`Uploaded — ${res.proposedBoard.length} proposed board members.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'invalid genesis.json');
    }
  };

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.genesis.approve();
      setMsg(`Installed ${res.installed} members (board now ${res.boardCount}).`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'approve failed');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <Section title="Genesis">…</Section>;

  if (state.genesisApproved) {
    return (
      <Section title="Genesis">
        <div className="text-emerald-400">✓ Founding board installed</div>
        <div className="text-xs text-slate-400">
          approved {state.genesisApprovedAt ? new Date(state.genesisApprovedAt).toLocaleString() : ''}
        </div>
      </Section>
    );
  }

  return (
    <Section title="Genesis — install founding board">
      <p className="text-sm text-slate-400">No board configured. Upload and approve a genesis.json.</p>
      <input
        type="file"
        accept="application/json,.json"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="mt-2 text-sm"
      />
      {state.proposedBoard ? (
        <div className="mt-3 space-y-1">
          <div className="text-sm font-medium">Proposed board ({state.proposedBoard.length}):</div>
          <ul className="space-y-1 text-xs">
            {state.proposedBoard.map((m) => (
              <li key={m.stake_address} className="rounded border border-slate-700 p-2">
                <div className="font-medium">{m.display_name}</div>
                <div className="break-all font-mono text-slate-400">{m.drep_id}</div>
              </li>
            ))}
          </ul>
          <button
            onClick={approve}
            disabled={busy}
            className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? 'Installing…' : 'Approve and install'}
          </button>
        </div>
      ) : null}
      {msg ? <div className="mt-2 text-sm text-emerald-400">{msg}</div> : null}
      {error ? <div className="mt-2 text-sm text-red-400">{error}</div> : null}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </section>
  );
}
