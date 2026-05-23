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
import { ProposalList } from './proposal-list';
import { ProposalCounts, StatusBadge } from './round-ui';

const STAGE_DEFS = [
  { key: 'submission', label: 'Submission' },
  { key: 'filtering', label: 'Filtering' },
  { key: 'debate_vote', label: 'Debate & Vote' },
  { key: 'funding', label: 'Funding' },
];
const CATEGORY_TYPES = ['GRANT', 'RFP'];

export function RoundsSection() {
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<RoundSummary | null>(null);

  const load = useCallback(() => {
    roundsApi.list().then(setRounds).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  // §10 — drilling into a round shows its proposals.
  if (open) {
    return (
      <section className="space-y-3">
        <button onClick={() => setOpen(null)} className="text-xs text-neutral-500 hover:underline">
          ← all rounds
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">
            Round #{open.number}
            {open.name ? ` — ${open.name}` : ''}
          </h2>
          <StatusBadge status={open.status} />
        </div>
        <ProposalList roundId={open.id} />
      </section>
    );
  }

  return (
    <section className="space-y-3">
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

      {creating ? <CreateRoundForm onDone={() => { setCreating(false); load(); }} /> : null}

      <ul className="space-y-2">
        {rounds.length === 0 ? (
          <li className="text-sm text-neutral-500">No rounds yet.</li>
        ) : (
          rounds.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setOpen(r)}
                className="block w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:border-emerald-400 dark:border-neutral-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    Round #{r.number}
                    {r.name ? ` — ${r.name}` : ''}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${r.active ? 'text-emerald-600' : 'text-neutral-400'}`}>
                      {r.status === 'CLOSED' ? 'complete' : r.active ? 'active' : 'preparing'}
                    </span>
                    <StatusBadge status={r.status} />
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  budget {r.budgetAda.toLocaleString()} ₳ · rewards {r.rewardsPoolAda.toLocaleString()} ₳ ·{' '}
                  {r.categoryCount} categories · {r.eligibleCount} eligible DReps
                </div>
                <div className="mt-1.5">
                  <ProposalCounts counts={r.proposalCounts} />
                </div>
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

const field =
  'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

function CreateRoundForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState(4_000_000);
  const [rewards, setRewards] = useState(200_000);
  const [cats, setCats] = useState<RoundCategoryInput[]>([
    { name: 'Ecosystem', type: 'GRANT', allocatedAda: 4_000_000, description: '' },
  ]);
  const [sched, setSched] = useState<Record<string, { startsAt: string; endsAt: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCat = (i: number, patch: Partial<RoundCategoryInput>) =>
    setCats((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  // P4 — categories must allocate the full budget before the round can be created.
  const allocated = cats.reduce((s, c) => s + (Number(c.allocatedAda) || 0), 0);
  const budgetMatches = Math.round(allocated) === Math.round(Number(budget));

  // P7 — validate that the scheduled stages run in order and each ends after it starts.
  const scheduleError = (): string | null => {
    let prevEnd: number | null = null;
    let prevLabel = '';
    for (const s of STAGE_DEFS) {
      const v = sched[s.key];
      if (!v?.startsAt || !v?.endsAt) continue;
      const start = new Date(v.startsAt).getTime();
      const end = new Date(v.endsAt).getTime();
      if (end <= start) return `${s.label}: end must be after start.`;
      if (prevEnd != null && start < prevEnd) return `${s.label} must start after the ${prevLabel} stage ends.`;
      prevEnd = end;
      prevLabel = s.label;
    }
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!budgetMatches) {
      setError(`Categories must allocate the full budget (allocated ${allocated.toLocaleString()} ₳ of ${Number(budget).toLocaleString()} ₳).`);
      return;
    }
    const schedErr = scheduleError();
    if (schedErr) {
      setError(schedErr);
      return;
    }
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
        categories: cats.map((c) => ({
          name: c.name,
          type: c.type ?? 'GRANT',
          allocatedAda: Number(c.allocatedAda),
          description: c.description?.trim() || undefined,
        })),
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
    <form onSubmit={submit} className="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-end gap-2">
        <input className={field} placeholder="Round name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="text-sm">Budget ₳ <input type="number" className={`${field} w-32`} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></label>
        <label className="text-sm">Rewards ₳ <input type="number" className={`${field} w-28`} value={rewards} onChange={(e) => setRewards(Number(e.target.value))} /></label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-sm font-medium">
          <span>Categories</span>
          <span className={`text-xs ${budgetMatches ? 'text-emerald-600' : 'text-amber-600'}`}>
            allocated {allocated.toLocaleString()} / {Number(budget).toLocaleString()} ₳
            {budgetMatches ? ' ✓' : ` (${(Number(budget) - allocated).toLocaleString()} ₳ unplanned)`}
          </span>
        </div>
        <div className="space-y-2">
          {cats.map((c, i) => (
            <div key={i} className="space-y-1 rounded border border-neutral-200 p-2 dark:border-neutral-800">
              <div className="flex flex-wrap items-center gap-2">
                <input className={field} placeholder="category name" value={c.name} onChange={(e) => setCat(i, { name: e.target.value })} required />
                <select className={field} value={c.type ?? 'GRANT'} onChange={(e) => setCat(i, { type: e.target.value })}>
                  {CATEGORY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <label className="text-sm">alloc ₳ <input type="number" className={`${field} w-32`} value={c.allocatedAda} onChange={(e) => setCat(i, { allocatedAda: Number(e.target.value) })} /></label>
                {cats.length > 1 ? (
                  <button type="button" onClick={() => setCats((cs) => cs.filter((_, j) => j !== i))} className="text-xs text-red-600">remove</button>
                ) : null}
              </div>
              <textarea
                className={`${field} w-full`}
                rows={2}
                placeholder="description — what this category funds, conditions, etc."
                value={c.description ?? ''}
                onChange={(e) => setCat(i, { description: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setCats((cs) => [...cs, { name: '', type: 'GRANT', allocatedAda: 0, description: '' }])} className="mt-1 text-xs underline">+ add category</button>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">Schedule (optional — stages must run in order)</div>
        {STAGE_DEFS.map((s) => (
          <div key={s.key} className="mb-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="w-28 text-neutral-500">{s.label}</span>
            <input type="datetime-local" className={field} value={sched[s.key]?.startsAt ?? ''} onChange={(e) => setSched((p) => ({ ...p, [s.key]: { ...p[s.key], startsAt: e.target.value } }))} />
            <input type="datetime-local" className={field} value={sched[s.key]?.endsAt ?? ''} onChange={(e) => setSched((p) => ({ ...p, [s.key]: { ...p[s.key], endsAt: e.target.value } }))} />
          </div>
        ))}
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <button
        type="submit"
        disabled={busy || !budgetMatches}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create round'}
      </button>
    </form>
  );
}
