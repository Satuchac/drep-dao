'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  boardProposalsApi,
  dvApi,
  proposalsApi,
  roundsApi,
  type DvResult,
  type ProposalSummary,
} from '@/lib/api';
import { ProposalDetail } from './proposal-detail';

export function VotingPanel() {
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const isDrep = profile?.roles.includes('DREP') ?? false;
  const [items, setItems] = useState<ProposalSummary[]>([]);

  const load = useCallback(async () => {
    const rounds = await roundsApi.list().catch(() => []);
    const lists = await Promise.all(rounds.map((r) => proposalsApi.byRound(r.id).catch(() => [])));
    setItems(lists.flat().filter((p) => p.stage === 'DEBATE_VOTE'));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">Debate &amp; Vote ({items.length})</h3>
      <p className="text-xs text-neutral-500">Balanced voting power (§4); rationale ≥ 200 chars.</p>
      <ul className="mt-2 space-y-3">
        {items.map((p) => (
          <VoteCard key={p.id} proposal={p} isBoard={isBoard} isDrep={isDrep} onChange={load} />
        ))}
      </ul>
    </section>
  );
}

function VoteCard({
  proposal,
  isBoard,
  isDrep,
  onChange,
}: {
  proposal: ProposalSummary;
  isBoard: boolean;
  isDrep: boolean;
  onChange: () => void;
}) {
  const [r, setR] = useState<DvResult | null>(null);
  const [choice, setChoice] = useState<'YES' | 'NO' | 'ABSTAIN'>('YES');
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const loadResult = useCallback(() => {
    dvApi.result(proposal.id).then(setR).catch(() => setR(null));
  }, [proposal.id]);
  useEffect(loadResult, [loadResult]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      loadResult();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    return (
      <li className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
        <ProposalDetail id={proposal.id} onBack={() => setOpen(false)} />
      </li>
    );
  }

  return (
    <li className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{proposal.title}</span>
        <span className="flex items-center gap-3">
          <span className="text-xs text-neutral-500">{proposal.requestedAmountAda.toLocaleString()} ₳</span>
          <button onClick={() => setOpen(true)} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">
            View full proposal →
          </button>
        </span>
      </div>

      {r?.open ? (
        <div className="mt-1 text-xs text-neutral-500">
          {r.cast}/{r.eligible} voted · YES {r.yesPower} / denom {r.denominator} ={' '}
          <strong>{r.ratioPct}%</strong> (threshold {r.thresholdPct}%) ·{' '}
          <span className={r.approved ? 'text-emerald-600' : 'text-red-600'}>
            {r.approved ? 'passing' : 'failing'}
          </span>
        </div>
      ) : (
        <div className="mt-1 text-xs text-neutral-500">Voting not open yet.</div>
      )}

      {isBoard ? (
        <div className="mt-2 flex gap-2">
          {!r?.open ? (
            <button disabled={busy} onClick={() => act(() => boardProposalsApi.openDvVote(proposal.id))} className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              Open voting (snapshot)
            </button>
          ) : (
            <button disabled={busy} onClick={() => act(() => boardProposalsApi.finalizeDv(proposal.id))} className="rounded border border-indigo-400 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950">
              Finalize result
            </button>
          )}
        </div>
      ) : null}

      {isDrep && r?.open ? (
        <div className="mt-2 space-y-1">
          <div className="flex gap-3 text-xs">
            {(['YES', 'NO', 'ABSTAIN'] as const).map((c) => (
              <label key={c} className="flex items-center gap-1">
                <input type="radio" checked={choice === c} onChange={() => setChoice(c)} /> {c}
              </label>
            ))}
          </div>
          <textarea
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            rows={8}
            placeholder="Rationale (Markdown supported; min 200 chars). Explain your reasoning — it's published with your vote."
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
          <button
            disabled={busy || rationale.trim().length < 200}
            onClick={() => act(() => dvApi.vote(proposal.id, choice, rationale))}
            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {rationale.trim().length < 200 ? `Cast vote (${rationale.trim().length}/200)` : 'Cast vote'}
          </button>
        </div>
      ) : null}

      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </li>
  );
}
