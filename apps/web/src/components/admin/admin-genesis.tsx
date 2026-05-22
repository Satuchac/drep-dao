'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type GenesisState } from '@/lib/admin-api';

export function AdminGenesis() {
  const [state, setState] = useState<GenesisState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi.genesis.state().then(setState).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  const onFile = async (file: File) => {
    setError(null);
    setMsg(null);
    try {
      const genesis = JSON.parse(await file.text());
      const res = await adminApi.genesis.upload(genesis);
      setMsg(`Verified ✓ — ${res.proposedBoard.length} member(s) are registered DReps on-chain.`);
      load();
    } catch (e) {
      // includes "file invalid — not registered DReps on-chain: drep1…"
      setError(e instanceof Error ? e.message : 'invalid genesis file');
    }
  };

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.genesis.approve();
      setMsg(`Installed ${res.seated} board member(s) — board now ${res.boardCount}/${res.maxBoard}.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'approve failed');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    await adminApi.genesis.reject().catch(() => undefined);
    setMsg(null);
    load();
  };

  if (!state) return <Section title="Genesis">…</Section>;

  return (
    <Section title={`Genesis — founding board (${state.boardCount}/${state.maxBoard})`}>
      {state.board.length > 0 ? (
        <ul className="mb-3 space-y-1 text-xs">
          {state.board.map((b) => (
            <li key={b.drepId} className="rounded border border-slate-700 p-2">
              <span className="font-medium">{b.displayName}</span>
              <span className="ml-2 break-all font-mono text-slate-400">{b.drepId}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">No board configured.</p>
      )}

      {state.canAddMore ? (
        <>
          <p className="mt-1 text-sm text-slate-400">
            Upload a genesis file — JSON array of <code>{'{ name, drep_id }'}</code> (each must be a
            registered on-chain DRep). You can add up to {state.maxBoard} board members across files.
          </p>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="mt-2 text-sm"
          />
          {state.proposedBoard ? (
            <div className="mt-3 space-y-1">
              <div className="text-sm font-medium">Verified — ready to install ({state.proposedBoard.length}):</div>
              <ul className="space-y-1 text-xs">
                {state.proposedBoard.map((m) => (
                  <li key={m.drep_id} className="rounded border border-slate-700 p-2">
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-2 break-all font-mono text-slate-400">{m.drep_id}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button onClick={approve} disabled={busy} className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                  {busy ? 'Installing…' : 'Approve & install'}
                </button>
                <button onClick={reject} className="mt-2 rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800">
                  Discard
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-emerald-400">✓ Board is full ({state.maxBoard}/{state.maxBoard}).</p>
      )}

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
