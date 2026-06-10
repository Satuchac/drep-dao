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

// Per-DRep vote flag shown in the card's top-right corner.
const VOTE_FLAG: Record<string, string> = {
  YES: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  NO: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  ABSTAIN: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

export function VotingPanel({ history = false }: { history?: boolean }) {
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const isDrep = profile?.roles.includes('DREP') ?? false;
  const [items, setItems] = useState<ProposalSummary[]>([]);

  const load = useCallback(async () => {
    const rounds = await roundsApi.list().catch(() => []);
    const lists = await Promise.all(rounds.map((r) => proposalsApi.byRound(r.id).catch(() => [])));
    // Default: only proposals currently in DEBATE_VOTE AND whose round has actually
    // advanced to VOTE (the proposal stage flips to DEBATE_VOTE the moment filtering
    // passes — ballots themselves aren't accepted until the round moves to VOTE).
    // History also includes proposals that passed through D&V — APPROVED / REJECTED /
    // COMPLETE / FAILED — so the voter can recall past decisions (the row still
    // links to detail). DV is the deprecated alias for VOTE.
    const voteRoundIds = new Set(rounds.filter((r) => r.status === 'VOTE' || r.status === 'DV').map((r) => r.id));
    const all = lists.flat();
    const pred = history
      ? (p: ProposalSummary) => p.stage === 'DEBATE_VOTE' || ['APPROVED', 'REJECTED', 'COMPLETE', 'FAILED'].includes(p.status)
      : (p: ProposalSummary) => p.stage === 'DEBATE_VOTE' && !!p.roundId && voteRoundIds.has(p.roundId);
    setItems(all.filter(pred));
  }, [history]);
  useEffect(() => {
    void load();
  }, [load]);

  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">Debate &amp; Vote ({items.length}){history ? ' — with history' : ''}</h3>
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

  // Vote flag (DReps only): their own choice once cast, else PENDING while voting is open.
  const flag = isDrep ? r?.myChoice ?? (r?.open ? 'PENDING' : null) : null;

  return (
    <li className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{proposal.title}</span>
        <span className="flex items-center gap-3">
          {flag ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${VOTE_FLAG[flag]}`}
              title={flag === 'PENDING' ? "You haven't voted yet" : `You voted ${flag}`}
            >
              {flag}
            </span>
          ) : null}
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
        <div className="mt-2 text-xs text-neutral-500">
          {/* §8/§9.3 — voting auto-opens when the round enters VOTE and the tally
              auto-finalizes when the round advances to FUNDING. No manual Open /
              Finalize button — board drives both via the Round stage controls. */}
          {r?.open
            ? 'Tally finalizes automatically when the round advances to FUNDING.'
            : 'Voting opens automatically when the round enters VOTE.'}
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
