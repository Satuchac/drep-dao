'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ROUND_SETTING_DEFAULTS, ROUND_SETTING_META } from '@drep-dao/shared';
import {
  boardRoundsApi,
  roundsApi,
  type CreateRoundInput,
  type RoundCategoryInput,
  type RoundDetail,
  type RoundSettingsInput,
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

// §6/§12 — per-round settings shown in the round setup, grouped. The reward-split
// keys (`rewardDvSharePct`, `rewardFixedPct`) are handled separately as sliders.
// `unit` drives the input suffix.
type SettingKey = Exclude<keyof RoundSettingsInput, 'rewardFixedPct' | 'rewardDvSharePct'>;
const SETTING_GROUPS: { title: string; fields: { key: SettingKey; label: string; unit?: '%' | '₳' }[] }[] = [
  {
    // Ordered to match the proposal flow: Filtering → Debate & Vote → Milestones.
    title: 'Review & approval',
    fields: [
      { key: 'filterReviewerCount', label: 'Filtering reviewers' },
      { key: 'filterApprovalVotes', label: 'Filtering approvals' },
      { key: 'dvApprovalThresholdPct', label: 'D&V threshold', unit: '%' },
      { key: 'milestoneReviewerCount', label: 'Milestone reviewers' },
      { key: 'milestoneApprovalVotes', label: 'Milestone approvals' },
    ],
  },
  {
    title: 'Submission fees',
    fields: [
      { key: 'feeCommercialPct', label: 'Commercial fee', unit: '%' },
      { key: 'feeCommercialCapAda', label: 'Commercial cap', unit: '₳' },
      { key: 'feeOssPct', label: 'Open-source fee', unit: '%' },
      { key: 'feeOssCapAda', label: 'Open-source cap', unit: '₳' },
      { key: 'feeCapPerRoundAda', label: 'Filtering reward cap', unit: '₳' },
    ],
  },
  {
    title: 'Quick poll',
    fields: [
      { key: 'quickPollParticipationPct', label: 'Min participation', unit: '%' },
      { key: 'quickPollDurationHours', label: 'Duration (hours)' },
      { key: 'quickPollMaxExtensions', label: 'Max extensions' },
    ],
  },
  {
    title: 'Milestone timing (days)',
    fields: [
      { key: 'milestoneNotificationDaysBeforeEnd', label: 'Notify before end' },
      { key: 'milestoneAutoExtensionDays', label: 'Auto extension' },
      { key: 'milestoneCheckPeriodDays', label: 'Check period' },
      { key: 'milestoneBoardExtraExtensionDays', label: 'Board extra extension' },
    ],
  },
  {
    title: 'Proposer pledge',
    fields: [
      { key: 'pledgeThresholdAda', label: 'Pledge threshold', unit: '₳' },
      { key: 'pledgeGraceDays', label: 'Grace (days)' },
    ],
  },
];

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
        <RoundSettingsView roundId={open.id} />
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
  // §6/§12 — per-round settings (blank = use the default). Reward splits are sliders.
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [rewardDvShare, setRewardDvShare] = useState<number>(ROUND_SETTING_DEFAULTS.rewardDvSharePct);
  const [rewardFixed, setRewardFixed] = useState<number>(ROUND_SETTING_DEFAULTS.rewardFixedPct);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSetting = (k: string, v: string) => setSettings((s) => ({ ...s, [k]: v }));
  const num = (k: string) => (settings[k]?.trim() ? Number(settings[k]) : undefined);
  // Approval votes can't exceed their reviewer count; the inputs cap to the effective value.
  const filterReviewers = num('filterReviewerCount') ?? ROUND_SETTING_DEFAULTS.filterReviewerCount;
  const milestoneReviewers = num('milestoneReviewerCount') ?? ROUND_SETTING_DEFAULTS.milestoneReviewerCount;
  const approvalMax = (k: SettingKey): number | undefined =>
    k === 'filterApprovalVotes' ? filterReviewers : k === 'milestoneApprovalVotes' ? milestoneReviewers : undefined;

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
    const fa = num('filterApprovalVotes');
    if (fa !== undefined && fa > filterReviewers) {
      setError(`Filtering approvals (${fa}) can't exceed filtering reviewers (${filterReviewers}).`);
      return;
    }
    const ma = num('milestoneApprovalVotes');
    if (ma !== undefined && ma > milestoneReviewers) {
      setError(`Milestone approvals (${ma}) can't exceed milestone reviewers (${milestoneReviewers}).`);
      return;
    }
    setBusy(true);
    try {
      const schedule = STAGE_DEFS.flatMap((s) => {
        const v = sched[s.key];
        if (!v?.startsAt || !v?.endsAt) return [];
        return [{ stageKey: s.key, startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString() }];
      });
      // §6/§12 — collect every supplied per-round setting; reward splits always sent.
      const settingsInput: RoundSettingsInput = { rewardDvSharePct: rewardDvShare, rewardFixedPct: rewardFixed };
      for (const g of SETTING_GROUPS)
        for (const f of g.fields) {
          const v = num(f.key);
          if (v !== undefined) (settingsInput as Record<string, number>)[f.key] = v;
        }
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
        ...settingsInput,
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

      {/* §12.2 — reward distribution: two sliders + a live visual of how the pool splits. */}
      <div className="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="text-sm font-medium">Reward distribution</div>

        {/* Slider 1 — split the reward pool: Debate & Vote (left) vs Milestone review (right). */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">Debate &amp; Vote {rewardDvShare}%</span>
            <span className="font-medium text-sky-700 dark:text-sky-400">Milestone review {100 - rewardDvShare}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={rewardDvShare}
            onChange={(e) => setRewardDvShare(Number(e.target.value))}
            className="w-full accent-emerald-600"
          />
          <p className="mt-0.5 text-[11px] text-neutral-500">{ROUND_SETTING_META.rewardDvSharePct}</p>
        </div>

        {/* Slider 2 — within the Debate & Vote slice: Fixed (left) vs Bonus (right). */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">Fixed {rewardFixed}%</span>
            <span className="text-neutral-500">of the Debate &amp; Vote slice</span>
            <span className="font-medium text-amber-700 dark:text-amber-400">Bonus {100 - rewardFixed}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={rewardFixed}
            onChange={(e) => setRewardFixed(Number(e.target.value))}
            className="w-full accent-emerald-600"
          />
          <p className="mt-0.5 text-[11px] text-neutral-500">{ROUND_SETTING_META.rewardFixedPct}</p>
        </div>

        <RewardBar pool={Number(rewards) || 0} dvShare={rewardDvShare} fixed={rewardFixed} />
      </div>

      {/* §6/§12 — the rest of the per-round parameters, with an explanation under each. */}
      <div className="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="text-sm font-medium">Round parameters</div>
        <p className="text-xs text-neutral-500">Leave a field blank to use the default (shown in each box).</p>
        {SETTING_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">{g.title}</div>
            <div className="space-y-2">
              {g.fields.map((f) => {
                const max = approvalMax(f.key);
                return (
                  <div key={f.key} className="flex items-start gap-2">
                    <label className="w-44 shrink-0 pt-1 text-xs text-neutral-600 dark:text-neutral-300" htmlFor={`rs-${f.key}`}>
                      {f.label}{f.unit ? ` (${f.unit})` : ''}
                    </label>
                    <div className="min-w-0">
                      <span className="flex items-center gap-1">
                        <input
                          id={`rs-${f.key}`}
                          type="number"
                          min={0}
                          max={max ?? (f.unit === '%' ? 100 : undefined)}
                          value={settings[f.key] ?? ''}
                          onChange={(e) => setSetting(f.key, e.target.value)}
                          placeholder={String(ROUND_SETTING_DEFAULTS[f.key])}
                          className={`${field} w-24`}
                        />
                        {max !== undefined ? <span className="text-[10px] text-neutral-400">max {max}</span> : null}
                      </span>
                      <p className="mt-0.5 max-w-xl text-[11px] text-neutral-500">{ROUND_SETTING_META[f.key]}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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

/** §12.2 — live visual of how the reward pool splits across the two sliders. */
function RewardBar({ pool, dvShare, fixed }: { pool: number; dvShare: number; fixed: number }) {
  // Pool → D&V slice (dvShare%) + Milestone slice (rest). Within D&V: fixed + bonus.
  const segs = [
    { label: 'D&V fixed', pct: (dvShare * fixed) / 100, cls: 'bg-emerald-500' },
    { label: 'D&V bonus', pct: (dvShare * (100 - fixed)) / 100, cls: 'bg-amber-400' },
    { label: 'Milestone review', pct: 100 - dvShare, cls: 'bg-sky-500' },
  ];
  const ada = (pct: number) => Math.round((pool * pct) / 100);
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
        {segs.map((s) =>
          s.pct > 0 ? <div key={s.label} className={s.cls} style={{ width: `${s.pct}%` }} title={`${s.label} ${s.pct.toFixed(0)}%`} /> : null,
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
        {segs.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${s.cls}`} />
            {s.label} {s.pct.toFixed(0)}% · {ada(s.pct).toLocaleString()} ₳
          </span>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-neutral-500">
        Distribution of the {pool.toLocaleString()} ₳ reward pool. Milestone-review rewards are always fixed; the bonus
        applies only within Debate &amp; Vote.
      </p>
    </div>
  );
}

/** §4 — the round's setup, read-only, shown on the round page (resolved values; null ⇒ default). */
function RoundSettingsView({ roundId }: { roundId: string }) {
  const [round, setRound] = useState<RoundDetail | null>(null);
  useEffect(() => {
    roundsApi.get(roundId).then(setRound).catch(() => setRound(null));
  }, [roundId]);
  if (!round) return null;
  const s = round.settings;
  const resolved = (k: keyof typeof ROUND_SETTING_DEFAULTS): number =>
    s[k] == null ? ROUND_SETTING_DEFAULTS[k] : (s[k] as number);

  return (
    <div className="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-sm font-medium">Round setup</div>
      <div className="text-xs text-neutral-500">
        budget {round.budgetAda.toLocaleString()} ₳ · rewards {round.rewardsPoolAda.toLocaleString()} ₳ ·{' '}
        {round.categories.length} categories · {round.eligibleCount} eligible DReps
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">Reward distribution</div>
        <RewardBar pool={round.rewardsPoolAda} dvShare={resolved('rewardDvSharePct')} fixed={resolved('rewardFixedPct')} />
      </div>

      {SETTING_GROUPS.map((g) => (
        <div key={g.title}>
          <div className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">{g.title}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {g.fields.map((f) => (
              <span key={f.key} className="text-neutral-600 dark:text-neutral-300" title={ROUND_SETTING_META[f.key]}>
                {f.label}:{' '}
                <span className="font-medium">
                  {resolved(f.key).toLocaleString()}
                  {f.unit === '%' ? '%' : f.unit === '₳' ? ' ₳' : ''}
                </span>
                {s[f.key] == null ? <span className="ml-0.5 text-[10px] text-neutral-400">(default)</span> : null}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
