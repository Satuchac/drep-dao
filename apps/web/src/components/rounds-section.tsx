'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  boardRoundsApi,
  roundsApi,
  type CreateRoundInput,
  type RoundCategoryInput,
  type RoundSummary,
} from '@/lib/api';

const STAGE_DEFS = [
  { key: 'submission', label: 'Submission' },
  { key: 'filtering', label: 'Filtering' },
  { key: 'debate_vote', label: 'Debate & Vote' },
  { key: 'funding', label: 'Funding' },
];
// Stage transitions a board member can trigger, with friendly labels.
const STAGE_BUTTONS: { status: string; label: string }[] = [
  { status: 'SUBMISSION', label: 'Open submission' },
  { status: 'FILTERING', label: 'Start filtering' },
  { status: 'DV', label: 'Debate & Vote' },
  { status: 'FUNDING', label: 'Funding' },
  { status: 'CLOSED', label: 'Close' },
];
const STATUS_CLS: Record<string, string> = {
  PREPARATION: 'bg-neutral-200 dark:bg-neutral-700',
  SUBMISSION: 'bg-amber-200 text-amber-900',
  FILTERING: 'bg-blue-200 text-blue-900',
  DV: 'bg-indigo-200 text-indigo-900',
  FUNDING: 'bg-emerald-200 text-emerald-900',
  CLOSED: 'bg-neutral-300 text-neutral-700',
};

export function RoundsSection() {
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    roundsApi.list().then(setRounds).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const startStage = async (id: string, stage: string) => {
    setError(null);
    try {
      await boardRoundsApi.startStage(id, stage);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'transition failed');
    }
  };

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Funding rounds (§5/§6)</h2>
        {isBoard ? (
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {creating ? 'Cancel' : '+ Create round'}
          </button>
        ) : null}
      </div>

      {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}

      {creating ? <CreateRoundForm onDone={() => { setCreating(false); load(); }} /> : null}

      <ul className="mt-3 space-y-2">
        {rounds.length === 0 ? (
          <li className="text-sm text-neutral-500">No rounds yet.</li>
        ) : (
          rounds.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  Round #{r.number}
                  {r.name ? ` — ${r.name}` : ''}
                </span>
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLS[r.status] ?? ''}`}>
                  {r.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                budget {r.budgetAda.toLocaleString()} ₳ · rewards {r.rewardsPoolAda.toLocaleString()} ₳ ·{' '}
                {r.categoryCount} categories · {r.eligibleCount} eligible DReps · {r.proposalCount} proposals
              </div>
              {isBoard ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {STAGE_BUTTONS.map((s) => (
                    <button
                      key={s.status}
                      onClick={() => startStage(r.id, s.status)}
                      disabled={r.status === s.status}
                      className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function CreateRoundForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState(4_000_000);
  const [rewards, setRewards] = useState(200_000);
  const [cats, setCats] = useState<RoundCategoryInput[]>([{ name: 'Ecosystem', allocatedAda: 1_000_000 }]);
  const [sched, setSched] = useState<Record<string, { startsAt: string; endsAt: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field =
    'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  const setCat = (i: number, patch: Partial<RoundCategoryInput>) =>
    setCats((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const schedule = STAGE_DEFS.flatMap((s) => {
        const v = sched[s.key];
        if (!v?.startsAt || !v?.endsAt) return [];
        return [{ stageKey: s.key, startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString() }];
      });
      const input: CreateRoundInput = {
        name: name.trim() || undefined,
        budgetAda: Number(budget),
        rewardsPoolAda: Number(rewards),
        categories: cats.map((c) => ({ ...c, allocatedAda: Number(c.allocatedAda) })),
        schedule,
      };
      await boardRoundsApi.create(input);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap gap-2">
        <input className={field} placeholder="Round name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="text-sm">Budget ₳ <input type="number" className={`${field} w-32`} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></label>
        <label className="text-sm">Rewards ₳ <input type="number" className={`${field} w-28`} value={rewards} onChange={(e) => setRewards(Number(e.target.value))} /></label>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">Categories (GRANT)</div>
        {cats.map((c, i) => (
          <div key={i} className="mb-1 flex flex-wrap items-center gap-2">
            <input className={field} placeholder="name" value={c.name} onChange={(e) => setCat(i, { name: e.target.value })} required />
            <label className="text-sm">alloc ₳ <input type="number" className={`${field} w-32`} value={c.allocatedAda} onChange={(e) => setCat(i, { allocatedAda: Number(e.target.value) })} /></label>
            {cats.length > 1 ? (
              <button type="button" onClick={() => setCats((cs) => cs.filter((_, j) => j !== i))} className="text-xs text-red-600">remove</button>
            ) : null}
          </div>
        ))}
        <button type="button" onClick={() => setCats((cs) => [...cs, { name: '', allocatedAda: 0 }])} className="text-xs underline">+ add category</button>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">Schedule (optional)</div>
        {STAGE_DEFS.map((s) => (
          <div key={s.key} className="mb-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="w-28 text-neutral-500">{s.label}</span>
            <input type="datetime-local" className={field} onChange={(e) => setSched((p) => ({ ...p, [s.key]: { ...p[s.key], startsAt: e.target.value } }))} />
            <input type="datetime-local" className={field} onChange={(e) => setSched((p) => ({ ...p, [s.key]: { ...p[s.key], endsAt: e.target.value } }))} />
          </div>
        ))}
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <button type="submit" disabled={busy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
        {busy ? 'Creating…' : 'Create round'}
      </button>
    </form>
  );
}
