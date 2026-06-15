'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { ROUND_SETTING_DEFAULTS, ROUND_SETTING_META, computeRewardPoolsAda } from '@drep-dao/shared';
import {
  boardRoundsApi,
  roundsApi,
  type CreateRoundInput,
  type RoundCategoryInput,
  type RoundDetail,
  type RoundScheduleEntry,
  type RoundSettingsInput,
  type RoundSummary,
} from '@/lib/api';
import { ProposalList } from './proposal-list';
import { QuickPollsPanel } from './quick-polls-panel';
import { BackButton, ProposalCounts, StatusBadge, toLocalInput } from './round-ui';
import { MarkdownEditor } from './markdown';
import { ClampedMarkdown } from './clamped-markdown';

// §8 — D&V is split into DEBATE (DReps comment + revise) → VOTE (ballots).
const STAGE_DEFS = [
  { key: 'submission', label: 'Submission' },
  { key: 'filtering', label: 'Filtering' },
  { key: 'debate', label: 'Debate' },
  { key: 'vote', label: 'Vote' },
  { key: 'funding', label: 'Funding' },
];
const CATEGORY_TYPES = ['GRANT', 'RFP'];

// §6/§12 — per-round settings shown in the round setup, grouped. The reward-split
// keys (`rewardDvSharePct`, `rewardFixedPct`) are handled separately as sliders.
// `unit` drives the input suffix.
type SettingKey = Exclude<keyof RoundSettingsInput, 'rewardFixedPct' | 'rewardDvSharePct' | 'rewardExpertSharePct'>;
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
  {
    title: 'Filtering resubmissions',
    fields: [
      { key: 'filterResubmissionsAllowed', label: 'Resubmissions allowed' },
      { key: 'filterBudgetChangesAllowed', label: 'Budget changes allowed (in-filter)' },
    ],
  },
  {
    title: 'Mandatory text fields',
    fields: [
      { key: 'mandatoryWords', label: 'Minimum words per field' },
      { key: 'mandatoryWordsMax', label: 'Maximum words per field' },
    ],
  },
];

export function RoundsSection() {
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const { get, setParams } = useUrlNav();
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [creating, setCreating] = useState(false);
  // Round-detail sub-tab: the proposals list vs the read-only round setup.
  const [roundTab, setRoundTab] = useState<'proposals' | 'categories' | 'setup'>('proposals');
  // The drilled-into round lives in the URL (?round=) so it's shareable + survives opening a proposal.
  const open = rounds.find((r) => r.id === get('round')) ?? null;

  const load = useCallback(() => {
    roundsApi.list().then(setRounds).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  // §10 — drilling into a round shows its proposals.
  if (open) {
    return (
      <section className="space-y-3">
        <BackButton onBack={() => setParams({ round: null })} label="all rounds" />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">
            Round #{open.number}
            {open.name ? ` — ${open.name}` : ''}
          </h2>
          <span className="text-xs text-neutral-500">Round stage:</span>
          <StatusBadge status={open.status} />
          <ProposalCounts counts={open.proposalCounts} activeStage={open.activeStageCounts} />
        </div>

        {/* Horizontal menu: Proposals (the list) | Round setup (read-only settings). */}
        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
          {([['proposals', 'Proposals'], ['categories', 'Categories'], ['setup', 'Schedule and Round Setup']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRoundTab(key)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
                roundTab === key
                  ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {roundTab === 'setup' ? <RoundSettingsView roundId={open.id} />
          : roundTab === 'categories' ? <RoundCategoriesView roundId={open.id} />
          : (
          <div className="space-y-4">
            {/* §9.2 — tie-break polls at the budget cliff (self-hides when none). */}
            <QuickPollsPanel roundId={open.id} />
            <ProposalList roundId={open.id} />
          </div>
        )}
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
                onClick={() => setParams({ round: r.id })}
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
                    <span className="text-xs text-neutral-500">Round stage:</span>
                    <StatusBadge status={r.status} />
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  budget {r.budgetAda.toLocaleString()} ₳ · rewards {r.rewardsPoolAda.toLocaleString()} ₳ ·{' '}
                  {r.categoryCount} categories · {r.eligibleCount} eligible DReps
                </div>
                <div className="mt-1.5">
                  <ProposalCounts counts={r.proposalCounts} activeStage={r.activeStageCounts} />
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

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Human duration between two timestamps (min → hours → days → weeks → months). */
function durationLabel(ms: number): string {
  if (ms <= 0) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Month-NAME date + time picker. Emits a "YYYY-MM-DDTHH:mm" (datetime-local) string,
 * or '' while incomplete — so the surrounding form logic is unchanged.
 */
function DateTimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
  // Local parts so a partial selection isn't lost before the whole value is valid.
  const [year, setYear] = useState(m ? m[1] : '');
  const [month, setMonth] = useState(m ? m[2] : '');
  const [day, setDay] = useState(m ? m[3] : '');
  // Default the time to midnight — DReps usually just pick a date (and may change it).
  const [time, setTime] = useState(m ? `${m[4]}:${m[5]}` : '00:00');

  // Sync the selects when the parent sets a complete value externally (the
  // "expected days" helper / overlap-cascade computes dates programmatically).
  // A blank value (mid-selection) is left alone so partial picks aren't wiped.
  useEffect(() => {
    const mm = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
    if (mm) { setYear(mm[1]); setMonth(mm[2]); setDay(mm[3]); setTime(`${mm[4]}:${mm[5]}`); }
  }, [value]);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => String(thisYear + i));

  const emit = (y: string, mo: string, d: string, t: string) => {
    onChange(y && mo && d && t ? `${y}-${mo}-${d}T${t}` : '');
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select className={field} value={month} onChange={(e) => { setMonth(e.target.value); emit(year, e.target.value, day, time); }}>
        <option value="">Month</option>
        {MONTHS.map((name, i) => <option key={name} value={pad(i + 1)}>{name}</option>)}
      </select>
      <select className={field} value={day} onChange={(e) => { setDay(e.target.value); emit(year, month, e.target.value, time); }}>
        <option value="">Day</option>
        {Array.from({ length: 31 }, (_, i) => pad(i + 1)).map((d) => <option key={d} value={d}>{Number(d)}</option>)}
      </select>
      <select className={field} value={year} onChange={(e) => { setYear(e.target.value); emit(e.target.value, month, day, time); }}>
        <option value="">Year</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <input type="time" className={field} value={time} onChange={(e) => { setTime(e.target.value); emit(year, month, day, e.target.value); }} />
    </span>
  );
}

export function CreateRoundForm({ onDone, initial, roundId }: { onDone: () => void; initial?: RoundDetail; roundId?: string }) {
  // Edit mode when `roundId` is set: prefill from `initial`, keep category ids (update in place),
  // and don't touch the schedule (the round is mid-schedule; the stage-confirm flow handles dates).
  const editing = !!roundId;
  const s0 = initial?.settings;
  const sval = (k: keyof NonNullable<typeof s0>) => (s0 && s0[k] != null ? Number(s0[k]) : undefined);
  const [name, setName] = useState(initial?.name ?? '');
  const [budget, setBudget] = useState(initial?.budgetAda ?? 4_000_000);
  const [rewards, setRewards] = useState(initial?.rewardsPoolAda ?? 200_000);
  const [cats, setCats] = useState<RoundCategoryInput[]>(
    initial?.categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      allocatedAda: c.allocatedAda,
      minAda: c.minAda ?? undefined,
      maxAda: c.maxAda ?? undefined,
      conditions: c.conditions ?? '',
      description: c.description ?? '',
    })) ?? [{ name: '', type: 'GRANT', allocatedAda: 0, description: '' }],
  );
  // New round: default the Submission stage's start to today (00:00 local) — the
  // round usually opens now, and the "expected days" helper chains the rest off it.
  const [sched, setSched] = useState<Record<string, { startsAt: string; endsAt: string }>>(() => {
    if (editing) return {};
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return { [STAGE_DEFS[0].key]: { startsAt: toLocalInput(d.toISOString()), endsAt: '' } };
  });
  // §6 — per-stage "expected days" helper: set N days → compute start (from the
  // previous stage's end if this stage has no start yet) + end = start + N days.
  const [days, setDays] = useState<Record<string, string>>({});
  // §6/§12 — per-round settings (blank = use the default). Reward splits are sliders.
  const [settings, setSettings] = useState<Record<string, string>>(() =>
    s0 ? Object.fromEntries(Object.entries(s0).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) : {},
  );
  const [rewardExpert, setRewardExpert] = useState<number>(sval('rewardExpertSharePct') ?? ROUND_SETTING_DEFAULTS.rewardExpertSharePct);
  const [rewardDvShare, setRewardDvShare] = useState<number>(sval('rewardDvSharePct') ?? ROUND_SETTING_DEFAULTS.rewardDvSharePct);
  const [rewardFixed, setRewardFixed] = useState<number>(sval('rewardFixedPct') ?? ROUND_SETTING_DEFAULTS.rewardFixedPct);
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

  // Item 2 — the Create button is enabled only once everything required is filled in.
  const nameOk = name.trim().length > 0;
  const catsOk = cats.every((c) => c.name.trim() && (c.description ?? '').trim() && Number(c.allocatedAda) > 0);
  const scheduleComplete = STAGE_DEFS.every((s) => !!sched[s.key]?.startsAt && !!sched[s.key]?.endsAt);
  const schedErr = scheduleError();
  const missing: string[] = [];
  if (!nameOk) missing.push('round name');
  if (!catsOk) missing.push('a name, description & allocation for every category');
  if (!budgetMatches) missing.push('the full budget allocated');
  if (!editing && !scheduleComplete) missing.push('all schedule dates');
  if (!editing && schedErr) missing.push(schedErr);
  const canCreate = missing.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!budgetMatches) {
      setError(`Categories must allocate the full budget (allocated ${allocated.toLocaleString()} ₳ of ${Number(budget).toLocaleString()} ₳).`);
      return;
    }
    if (!editing) {
      const schedErr = scheduleError();
      if (schedErr) {
        setError(schedErr);
        return;
      }
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
    // §5.2 — a category's min ask must not exceed its max ask.
    for (const c of cats) {
      const mn = c.minAda != null && String(c.minAda) !== '' ? Number(c.minAda) : null;
      const mx = c.maxAda != null && String(c.maxAda) !== '' ? Number(c.maxAda) : null;
      if (mn != null && mx != null && mn > mx) {
        setError(`Category "${c.name || '(unnamed)'}": min ask (${mn.toLocaleString()} ₳) can't exceed max ask (${mx.toLocaleString()} ₳).`);
        return;
      }
    }
    setBusy(true);
    try {
      const schedule = STAGE_DEFS.flatMap((s) => {
        const v = sched[s.key];
        if (!v?.startsAt || !v?.endsAt) return [];
        return [{ stageKey: s.key, startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString() }];
      });
      // §6/§12 — collect every supplied per-round setting; reward splits always sent.
      const settingsInput: RoundSettingsInput = {
        rewardExpertSharePct: rewardExpert,
        rewardDvSharePct: rewardDvShare,
        rewardFixedPct: rewardFixed,
      };
      for (const g of SETTING_GROUPS)
        for (const f of g.fields) {
          const v = num(f.key);
          if (v !== undefined) (settingsInput as Record<string, number>)[f.key] = v;
        }
      const categories: RoundCategoryInput[] = cats.map((c) => ({
        ...(c.id ? { id: c.id } : {}),
        name: c.name,
        type: c.type ?? 'GRANT',
        allocatedAda: Number(c.allocatedAda),
        minAda: c.minAda != null && String(c.minAda) !== '' ? Number(c.minAda) : undefined,
        maxAda: c.maxAda != null && String(c.maxAda) !== '' ? Number(c.maxAda) : undefined,
        conditions: c.conditions?.trim() || undefined,
        description: c.description?.trim() || undefined,
      }));
      if (editing && roundId) {
        // Edit: don't touch the schedule (the round is mid-schedule; stages are confirmed separately).
        await boardRoundsApi.update(roundId, { name: name.trim() || undefined, budgetAda: Number(budget), rewardsPoolAda: Number(rewards), categories, ...settingsInput });
      } else {
        await boardRoundsApi.create({ name: name.trim() || undefined, budgetAda: Number(budget), rewardsPoolAda: Number(rewards), categories, schedule, ...settingsInput });
      }
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
        <input className={field} placeholder="Round name" value={name} onChange={(e) => setName(e.target.value)} required />
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
              {/* §5.2 — per-proposal funding-request bounds (blank = no bound). */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <label>min ask ₳ <input type="number" min={0} className={`${field} ml-1 w-28`} placeholder="no min" value={c.minAda ?? ''} onChange={(e) => setCat(i, { minAda: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                <label>max ask ₳ <input type="number" min={0} className={`${field} ml-1 w-28`} placeholder="no max" value={c.maxAda ?? ''} onChange={(e) => setCat(i, { maxAda: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                <span className="text-neutral-400">a proposal&apos;s requested amount must fit this range</span>
              </div>
              <MarkdownEditor
                value={c.description ?? ''}
                onChange={(val) => setCat(i, { description: val })}
                title="Description"
                subtitle="What this category funds. Supports bold, italics, headers, lists."
                placeholder="description — what this category funds"
                minRows={6}
                required
              />
              <MarkdownEditor
                value={c.conditions ?? ''}
                onChange={(val) => setCat(i, { conditions: val })}
                title="Conditions / restrictions"
                hint="optional"
                subtitle="Eligibility rules, who can apply, etc. Supports bold, italics, headers, lists."
                placeholder="conditions / restrictions — eligibility rules, who can apply, etc."
                minRows={4}
              />
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setCats((cs) => [...cs, { name: '', type: 'GRANT', allocatedAda: 0, description: '' }])} className="mt-1 text-xs underline">+ add category</button>
      </div>

      {/* §12.2 — reward distribution: three sliders + a live visual of how the pool splits. */}
      <div className="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="text-sm font-medium">Reward distribution</div>

        {/* Slider 1 — carve out the experts' direct cut first: DReps (left) vs Experts (right). */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">DReps {100 - rewardExpert}%</span>
            <span className="font-medium text-purple-700 dark:text-purple-400">Experts {rewardExpert}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={rewardExpert}
            onChange={(e) => setRewardExpert(Number(e.target.value))}
            className="w-full accent-purple-600"
          />
          <p className="mt-0.5 text-[11px] text-neutral-500">{ROUND_SETTING_META.rewardExpertSharePct}</p>
        </div>

        {/* Slider 2 — split the DReps' pool: Debate & Vote (left) vs Milestone review (right). */}
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

        {/* Slider 3 — within the Debate & Vote slice: Fixed (left) vs Bonus (right). */}
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

        <RewardBar pool={Number(rewards) || 0} expertPct={rewardExpert} dvShare={rewardDvShare} fixed={rewardFixed} />
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

      {editing ? (
        <p className="text-xs text-neutral-500">Schedule is managed via the per-stage confirm/launch controls above, so it isn&apos;t edited here.</p>
      ) : (
      <div>
        <div className="mb-1 text-sm font-medium">Schedule (all stages, in order)</div>
        {STAGE_DEFS.map((s, idx) => {
          const v = sched[s.key];
          const startMs = v?.startsAt ? new Date(v.startsAt).getTime() : null;
          const endMs = v?.endsAt ? new Date(v.endsAt).getTime() : null;
          // Nearest earlier stage with an end set — for the "in order" check.
          let prevEnd: number | null = null;
          let prevLabel = '';
          for (let j = idx - 1; j >= 0; j--) {
            const pv = sched[STAGE_DEFS[j].key];
            if (pv?.endsAt) { prevEnd = new Date(pv.endsAt).getTime(); prevLabel = STAGE_DEFS[j].label; break; }
          }
          let warn: string | null = null;
          if (startMs != null && endMs != null && endMs <= startMs) warn = 'End must be after the start.';
          else if (startMs != null && prevEnd != null && startMs < prevEnd) warn = `Must start after the ${prevLabel} stage ends.`;
          const dur = startMs != null && endMs != null && endMs > startMs ? durationLabel(endMs - startMs) : null;
          // §6 — when the user moves a stage so that it would overlap the next
          // one, cascade the shift forward (every later stage moves by the same
          // delta) so the schedule stays consecutive without manual fix-up.
          const setPart = (part: 'startsAt' | 'endsAt', val: string) =>
            setSched((p) => {
              const next: Record<string, { startsAt: string; endsAt: string }> = { ...p };
              const cur = { ...(next[s.key] ?? { startsAt: '', endsAt: '' }), [part]: val };
              next[s.key] = cur;
              const myEndMs = cur.endsAt ? new Date(cur.endsAt).getTime() : null;
              if (myEndMs == null) return next;
              for (let j = idx + 1; j < STAGE_DEFS.length; j++) {
                const k = STAGE_DEFS[j].key;
                const ent = next[k];
                if (!ent?.startsAt || !ent?.endsAt) continue;
                const startMs = new Date(ent.startsAt).getTime();
                const endMs = new Date(ent.endsAt).getTime();
                if (startMs >= myEndMs) break; // no further collision possible (already in order)
                const delta = myEndMs - startMs;
                next[k] = {
                  startsAt: new Date(startMs + delta).toISOString(),
                  endsAt: new Date(endMs + delta).toISOString(),
                };
              }
              return next;
            });
          // §6 — "expected days" → compute this stage's dates. Start = this
          // stage's start if already set (so editing the start then re-clicking
          // Set only recomputes the end), else the previous stage's end, else
          // today at 00:00. End = start + N days. Only this stage is changed.
          const applyDays = () => {
            const n = Math.floor(Number(days[s.key]));
            if (!Number.isFinite(n) || n <= 0) return;
            setSched((p) => {
              const next = { ...p };
              let startStr = next[s.key]?.startsAt ?? '';
              if (!startStr) {
                for (let j = idx - 1; j >= 0; j--) {
                  const pv = next[STAGE_DEFS[j].key];
                  if (pv?.endsAt) { startStr = pv.endsAt; break; }
                }
              }
              if (!startStr) { const d = new Date(); d.setHours(0, 0, 0, 0); startStr = toLocalInput(d.toISOString()); }
              const startMs = new Date(startStr).getTime();
              const endMs = startMs + n * 86_400_000;
              next[s.key] = {
                startsAt: toLocalInput(new Date(startMs).toISOString()),
                endsAt: toLocalInput(new Date(endMs).toISOString()),
              };
              return next;
            });
          };
          // Prefill the days box from the current dates so it reflects what's set.
          const daysFromDates = startMs != null && endMs != null && endMs > startMs ? String(Math.round((endMs - startMs) / 86_400_000)) : '';
          return (
            <div key={s.key} className={`py-2.5 text-sm ${idx > 0 ? 'border-t border-neutral-200 dark:border-neutral-800' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 shrink-0 font-medium text-neutral-600 dark:text-neutral-300">{s.label}</span>
                <DateTimeField value={v?.startsAt ?? ''} onChange={(val) => setPart('startsAt', val)} />
                <span className="text-neutral-400">→</span>
                <DateTimeField value={v?.endsAt ?? ''} onChange={(val) => setPart('endsAt', val)} />
                {dur ? <span className="text-xs font-medium text-emerald-600">· {dur}</span> : null}
              </div>
              {/* §6 — expected-days quick-set. */}
              <div className="ml-28 mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span>Expected days</span>
                <input
                  type="number"
                  min={1}
                  value={days[s.key] ?? daysFromDates}
                  onChange={(e) => setDays((d) => ({ ...d, [s.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyDays(); } }}
                  className="w-20 rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
                  placeholder="days"
                />
                <button type="button" onClick={applyDays} className="rounded border border-emerald-500 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950">
                  Set
                </button>
                <span className="text-neutral-400">start = this stage&apos;s start (or the previous stage&apos;s end), end = start + days</span>
              </div>
              {warn ? <div className="ml-28 mt-0.5 text-xs font-medium text-red-600">{warn}</div> : null}
            </div>
          );
        })}
      </div>
      )}

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {!canCreate ? (
        <p className="text-xs text-amber-600">Still needed: {missing.join('; ')}.</p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !canCreate}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : 'Create round'}
      </button>
    </form>
  );
}

/** §12.2 — live visual of how the reward pool splits across the three sliders. */
function RewardBar({ pool, expertPct, dvShare, fixed }: { pool: number; expertPct: number; dvShare: number; fixed: number }) {
  // Single source of truth: the same computeRewardPoolsAda the backend's §12 computation
  // uses (experts carved out first → D&V fixed/bonus → milestone).
  const pools = computeRewardPoolsAda(pool, expertPct, dvShare, fixed);
  const segs = [
    { label: 'Experts', ada: pools.expertAda, cls: 'bg-purple-500' },
    { label: 'D&V fixed', ada: pools.dvFixedAda, cls: 'bg-emerald-500' },
    { label: 'D&V bonus', ada: pools.dvBonusAda, cls: 'bg-amber-400' },
    { label: 'Milestone review', ada: pools.milestoneAda, cls: 'bg-sky-500' },
  ].map((s) => ({ ...s, pct: pool > 0 ? (s.ada / pool) * 100 : 0 }));
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
        Distribution of the {pool.toLocaleString()} ₳ reward pool. Experts are paid directly (subtracted first);
        milestone-review rewards are always fixed; the bonus applies only within Debate &amp; Vote.
      </p>
    </div>
  );
}

/** §4 — the round's setup, read-only, shown on the round page (resolved values; null ⇒ default). */
// §6 — map the round's status to the stage it currently sits in (−1 = PREPARATION,
// before any stage started; STAGE_DEFS.length = CLOSED, all stages done).
const STATUS_STAGE_IDX: Record<string, number> = {
  PREPARATION: -1, SUBMISSION: 0, FILTERING: 1, DEBATE: 2, VOTE: 3, DV: 3, FUNDING: 4, CLOSED: STAGE_DEFS.length,
};
const fmtShort = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** "1 day and 5 hours" / "5 hours and 12 minutes" / "8 minutes" from a ms delta. */
function untilLabel(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const u = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (days > 0) return `${u(days, 'day')} and ${u(hours, 'hour')}`;
  if (hours > 0) return `${u(hours, 'hour')} and ${u(mins, 'minute')}`;
  return u(mins, 'minute');
}

/** §6 — horizontal bar of every stage + its dates, with the current stage marked.
 *  A stage whose planned START has passed but which hasn't been started yet is
 *  OVERDUE — its date turns red and a banner tells the board to start it. */
function StagesBar({ round }: { round: RoundDetail }) {
  const curIdx = STATUS_STAGE_IDX[round.status] ?? -1;
  const byKey = new Map(round.schedule.map((e) => [e.stageKey, e]));
  // Live clock so the countdown ticks (minute granularity is enough for days/hours).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const isOverdue = (i: number, e?: RoundScheduleEntry) =>
    // not started (upcoming) AND its planned start is in the past
    (curIdx === -1 || i > curIdx) && !!e?.startsAt && new Date(e.startsAt).getTime() < now;
  const overdueLabels = STAGE_DEFS.filter((s, i) => isOverdue(i, byKey.get(s.key))).map((s) => s.label);
  // §6 — the next stage to begin (Submission while in Preparation, else the one
  // after the current stage) + its planned start, for the countdown header.
  const nextIdx = curIdx < 0 ? 0 : curIdx + 1;
  const nextStage = nextIdx < STAGE_DEFS.length ? STAGE_DEFS[nextIdx] : null;
  const nextEntry = nextStage ? byKey.get(nextStage.key) : undefined;
  const nextStartMs = nextEntry?.startsAt ? new Date(nextEntry.startsAt).getTime() : null;
  return (
    <div>
      {/* §6 — countdown to the next stage. */}
      {nextStage && nextStartMs != null ? (
        <div className="mb-1.5 text-sm">
          <span className="font-medium text-neutral-700 dark:text-neutral-200">Next stage: {nextStage.label.toUpperCase()}</span>
          {nextStartMs > now ? (
            <span className="text-neutral-500"> · Starts in: <span className="font-semibold text-emerald-700 dark:text-emerald-400">{untilLabel(nextStartMs - now)}</span> <span className="text-xs">({fmtShort(nextEntry?.startsAt)})</span></span>
          ) : (
            <span className="font-medium text-red-600 dark:text-red-400"> · was due {fmtShort(nextEntry?.startsAt)} — overdue, start it now or move the date</span>
          )}
        </div>
      ) : null}
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">
        <span>Stages</span>
        {curIdx === -1 ? (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${overdueLabels.length ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200'}`}>Preparation — not started yet</span>
        ) : curIdx >= STAGE_DEFS.length ? (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Closed</span>
        ) : null}
      </div>
      {/* §6 — board alert: a stage is past its planned start but hasn't begun. */}
      {overdueLabels.length ? (
        <div className="mb-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          ⚠ {overdueLabels.join(', ')} {overdueLabels.length === 1 ? 'was' : 'were'} due to start by the planned date but {overdueLabels.length === 1 ? 'hasn\'t' : 'haven\'t'} begun — the board should start {overdueLabels.length === 1 ? 'it' : 'them'} in Round control.
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {STAGE_DEFS.map((s, i) => {
          const e = byKey.get(s.key);
          const state = curIdx === -1 ? 'upcoming' : i < curIdx ? 'done' : i === curIdx ? 'current' : 'upcoming';
          const overdue = state === 'upcoming' && isOverdue(i, e);
          const cls =
            overdue
              ? 'border-red-300 bg-red-50/60 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300'
              : state === 'current'
                ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-400 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                : state === 'done'
                  ? 'border-emerald-200 bg-emerald-50/50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300'
                  : 'border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400';
          return (
            <div key={s.key} className={`min-w-[8.5rem] flex-1 rounded-md border px-2 py-1.5 ${cls}`}>
              <div className="flex items-center gap-1 text-xs font-semibold">
                {state === 'current' ? <span className="text-emerald-600">●</span> : state === 'done' ? <span className="text-emerald-500">✓</span> : overdue ? <span className="text-red-600">⚠</span> : null}
                {s.label}
              </div>
              {/* §6 — the date is red when the stage is overdue (should have started). */}
              <div className={`mt-0.5 text-[10px] leading-tight ${overdue ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{fmtShort(e?.startsAt)} → {fmtShort(e?.endsAt)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type CategoryStats = RoundDetail['categories'][number]['stats'];
const ada = (n: number) => `${n.toLocaleString()} ₳`;

/**
 * §6 — per-category proposal activity, shown as one labelled row per stage the round
 * has reached. SUBMISSION is always shown; FILTERING / DEBATE & VOTE / FUNDING appear
 * (and switch from "in progress" to final) as the round advances through its stages.
 */
function CategoryStatsBar({ stats, roundStatus, allocatedAda }: { stats: CategoryStats; roundStatus: string; allocatedAda: number }) {
  // Round stage order → which proposal stages have been reached, and whether each has ended.
  const order = ['PREPARATION', 'SUBMISSION', 'FILTERING', 'DEBATE', 'VOTE', 'FUNDING', 'CLOSED'];
  const idx = order.indexOf(roundStatus === 'DV' ? 'VOTE' : roundStatus);
  const reached = (stage: string) => idx >= order.indexOf(stage);
  // A stage's results are final once the round has moved past it.
  const filteringDone = idx > order.indexOf('FILTERING');
  const voteDone = idx > order.indexOf('VOTE');

  const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div className="rounded-md border border-neutral-200 px-2 py-1 dark:border-neutral-800">
      <div className={`text-sm font-semibold tabular-nums ${tone ?? 'text-neutral-800 dark:text-neutral-200'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  );
  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{label}</span>
        {hint ? <span className="text-[10px] text-neutral-400">{hint}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">{children}</div>
    </div>
  );

  const reachedFiltering = reached('FILTERING');
  const reachedVote = reached('DEBATE'); // proposals "reach voting" when Debate & Vote opens (Debate first)
  const reachedFunding = reached('FUNDING');
  const unallocated = Math.max(0, allocatedAda - stats.fundedAllocatedAda);

  return (
    <div className="mt-2 space-y-2">
      {/* SUBMISSION — always shown (zeros before anything is submitted). */}
      <Row label="Submission">
        <Stat label="Submitted" value={stats.submitted.toLocaleString()} />
        <Stat label="Budget asked" value={ada(stats.totalRequestedAda)} />
        <Stat label="Submitters" value={stats.submitters.toLocaleString()} />
        <Stat label="Fees collected" value={ada(stats.feesCollectedAda)} />
      </Row>

      {reachedFiltering ? (
        <Row label="Filtering" hint={filteringDone ? 'final' : 'in progress'}>
          {!filteringDone ? <Stat label="Under review" value={stats.inFiltering.toLocaleString()} tone="text-amber-600 dark:text-amber-400" /> : null}
          <Stat label={filteringDone ? 'Passed' : 'Passing'} value={stats.passedFiltering.toLocaleString()} tone="text-emerald-600 dark:text-emerald-400" />
          <Stat label="Rejected" value={stats.rejectedFiltering.toLocaleString()} tone="text-red-600 dark:text-red-400" />
        </Row>
      ) : null}

      {reachedVote ? (
        <Row label="Debate & Vote" hint={voteDone ? 'final' : 'in progress'}>
          <Stat label="To voting" value={stats.passedFiltering.toLocaleString()} />
          {!voteDone ? <Stat label="In voting" value={stats.inVoting.toLocaleString()} tone="text-amber-600 dark:text-amber-400" /> : null}
          <Stat label="Approved" value={stats.approved.toLocaleString()} tone="text-emerald-600 dark:text-emerald-400" />
          <Stat label="Rejected" value={stats.rejectedVote.toLocaleString()} tone="text-red-600 dark:text-red-400" />
        </Row>
      ) : null}

      {reachedFunding ? (
        <Row label="Funding">
          <Stat label="Funded" value={stats.approved.toLocaleString()} tone="text-emerald-600 dark:text-emerald-400" />
          <Stat label="Allocated" value={ada(stats.fundedAllocatedAda)} />
          <Stat label="Unallocated" value={ada(unallocated)} />
          <Stat label="Milestones ✓" value={`${stats.milestonesApproved.toLocaleString()} / ${stats.milestonesTotal.toLocaleString()}`} />
          <Stat label="Paid" value={stats.milestonesPaid.toLocaleString()} />
        </Row>
      ) : null}
    </div>
  );
}

/** §6 — read-only Categories tab: allocation, min/max ask, and description. */
function RoundCategoriesView({ roundId }: { roundId: string }) {
  const [round, setRound] = useState<RoundDetail | null>(null);
  useEffect(() => {
    roundsApi.get(roundId).then(setRound).catch(() => setRound(null));
  }, [roundId]);
  if (!round) return null;
  if (round.categories.length === 0) return <p className="text-sm text-neutral-500">No categories defined for this round.</p>;
  const totalAlloc = round.categories.reduce((s, c) => s + c.allocatedAda, 0);
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        {round.categories.length} categor{round.categories.length === 1 ? 'y' : 'ies'} · allocated{' '}
        {totalAlloc.toLocaleString()} ₳ of {round.budgetAda.toLocaleString()} ₳ budget.
      </p>
      {round.categories.map((c) => (
        <section key={c.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="font-medium">{c.name}</span>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{c.type}</span>
            </span>
            <span className="text-sm tabular-nums text-neutral-600 dark:text-neutral-300">{c.allocatedAda.toLocaleString()} ₳ allocated</span>
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Ask range:{' '}
            {c.minAda != null || c.maxAda != null
              ? `${c.minAda != null ? `${c.minAda.toLocaleString()} ₳` : 'no min'} – ${c.maxAda != null ? `${c.maxAda.toLocaleString()} ₳` : 'no max'}`
              : 'any amount'}
          </div>
          <CategoryStatsBar stats={c.stats} roundStatus={round.status} allocatedAda={c.allocatedAda} />
          {/* — description / conditions follow — */}
          <div className="mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Description</div>
            <ClampedMarkdown className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-300" empty="—" maxLines={15}>{c.description ?? ''}</ClampedMarkdown>
          </div>
          {c.conditions ? (
            <div className="mt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Conditions</div>
              <ClampedMarkdown className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-300" maxLines={15}>{c.conditions}</ClampedMarkdown>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

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
      {/* §6 — stages bar on top: where the round currently is. */}
      <StagesBar round={round} />
      <div className="border-t border-neutral-200 pt-3 text-sm font-medium dark:border-neutral-800">Round setup</div>
      <div className="text-xs text-neutral-500">
        budget {round.budgetAda.toLocaleString()} ₳ · rewards {round.rewardsPoolAda.toLocaleString()} ₳ ·{' '}
        {round.categories.length} categories · {round.eligibleCount} eligible DReps
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">Reward distribution</div>
        <RewardBar pool={round.rewardsPoolAda} expertPct={resolved('rewardExpertSharePct')} dvShare={resolved('rewardDvSharePct')} fixed={resolved('rewardFixedPct')} />
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
