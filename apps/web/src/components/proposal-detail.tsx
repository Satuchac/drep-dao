'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import { useAuth } from '@/lib/auth-context';
import { useExplorer } from '@/lib/explorer';
import {
  proposalsApi,
  proposalVersionsApi,
  proposalEditApi,
  filteringApi,
  dvApi,
  milestonesApi,
  commentsApi,
  boardMilestoneApi,
  type ProposalDetail as PDetail,
  type VoteRationale,
  type ProposalVersionEntry,
  type MilestoneView,
  type CommentNode,
  type FilterResult,
  type DvResult,
} from '@/lib/api';
import { StatusBadge, PROPOSAL_STATUS_CLS, fmtDateTime } from './round-ui';
import { Markdown, MarkdownEditor } from './markdown';

const card = 'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';
const SUBCAT_LABEL: Record<string, string> = Object.fromEntries(DEFAULT_SUBCATEGORIES.map((s) => [s.id, s.label]));
const choiceCls: Record<string, string> = {
  YES: 'text-emerald-600',
  NO: 'text-red-600',
  ABSTAIN: 'text-neutral-500',
};

/** §20 — full proposal view: content, version diff, votes + public rationale, milestones, comments. */
export function ProposalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [p, setP] = useState<PDetail | null>(null);
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    proposalsApi.get(id).then(setP).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
    proposalsApi.mine().then((list) => setMine(list.some((m) => m.id === id))).catch(() => setMine(false));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <div className="space-y-2"><BackBtn onBack={onBack} /><div className="text-sm text-red-600">{error}</div></div>;
  if (!p) return <div className="space-y-2"><BackBtn onBack={onBack} /><p className="text-sm text-neutral-500">Loading…</p></div>;

  const stageReached = (s: string) => {
    const order = ['FILTERING', 'DEBATE_VOTE', 'FUNDING'];
    return p.stage ? order.indexOf(p.stage) >= order.indexOf(s) : false;
  };
  // Filtering result is relevant once filtering started; D&V once it reached D&V; milestones in funding.
  const showFiltering = !!p.stage; // any post-submission stage has filtering history
  const showDv = stageReached('DEBATE_VOTE') || ['APPROVED', 'REJECTED', 'COMPLETE', 'FAILED'].includes(p.status);
  const showMilestones = p.stage === 'FUNDING' || ['COMPLETE', 'FAILED'].includes(p.status);

  return (
    <div className="space-y-4">
      <BackBtn onBack={onBack} />
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{p.title}</h2>
          <div className="flex items-center gap-2">
            {p.stage ? <span className="text-xs text-neutral-500">{p.stage}</span> : null}
            <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} />
          </div>
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          {p.categoryName ?? 'uncategorized'} · {p.requestedAmountAda.toLocaleString()} ₳ ·{' '}
          {p.isCommercial ? 'commercial' : 'open-source'} · fee {p.submissionFeeAda.toLocaleString()} ₳
          {p.categoryAsk && (p.categoryAsk.minAda != null || p.categoryAsk.maxAda != null) ? (
            <> · category ask {p.categoryAsk.minAda != null ? `${p.categoryAsk.minAda.toLocaleString()}` : '0'}–{p.categoryAsk.maxAda != null ? `${p.categoryAsk.maxAda.toLocaleString()}` : '∞'} ₳</>
          ) : null}
        </div>
        {p.subcategoryIds && p.subcategoryIds.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {p.subcategoryIds.map((sid) => (
              <span key={sid} className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                {SUBCAT_LABEL[sid] ?? sid}
              </span>
            ))}
          </div>
        ) : null}
        <Markdown className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">{p.contentMd}</Markdown>
        {/* §3.4 — funding-specific detail, shown when present. */}
        <DetailBlock label="Cost breakdown" md={p.costBreakdownMd} />
        <DetailBlock label="Team" md={p.teamInfoMd} />
        <DetailBlock label="Revenue sharing" md={p.revenueSharingMd} />
        {p.categoryAsk?.conditions ? <DetailBlock label="Category conditions" md={p.categoryAsk.conditions} /> : null}
        {mine ? <EditSection id={id} proposal={p} onChange={load} /> : null}
      </div>

      <VersionsSection id={id} />
      {showFiltering ? <FilteringSection id={id} /> : null}
      {showDv ? <DvSection id={id} isBoard={isBoard} /> : null}
      {showMilestones ? (
        <MilestonesSection id={id} isBoard={isBoard} isMine={mine} onChange={load} />
      ) : null}
      <CommentsSection id={id} title={p.title} canPost={!!profile} />
    </div>
  );
}

function BackBtn({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="text-xs text-neutral-500 hover:underline">
      ← back to proposals
    </button>
  );
}

/** §3.4 — a labelled markdown detail section, rendered only when content is present. */
function DetailBlock({ label, md }: { label: string; md?: string | null }) {
  if (!md || !md.trim()) return null;
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</div>
      <Markdown className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-300">{md}</Markdown>
    </div>
  );
}

/** Public rationale list (filtering / D&V / milestone), with optional balanced weight. */
function Votes({ votes }: { votes: VoteRationale[] }) {
  if (!votes || votes.length === 0) return <p className="text-xs text-neutral-400">No votes yet.</p>;
  return (
    <ul className="space-y-1.5">
      {votes.map((v, i) => (
        <li key={i} className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="font-medium">{v.displayName ?? (v.drep ? `${v.drep.slice(0, 16)}…` : 'DRep')}</span>
            <span className={`font-semibold ${choiceCls[v.choice] ?? ''}`}>
              {v.choice}
              {v.weight != null ? ` · ${v.weight.toLocaleString()} power` : ''}
            </span>
          </div>
          {v.rationale ? <div className="mt-1 whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">{v.rationale}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function AnchorLink({ txHash }: { txHash: string | null | undefined }) {
  const { txUrl } = useExplorer();
  if (!txHash) return <span className="text-xs text-neutral-400">recorded (anchor pending submission)</span>;
  return (
    <a href={txUrl(txHash)} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline dark:text-emerald-400">
      on-chain proof ↗
    </a>
  );
}

function FilteringSection({ id }: { id: string }) {
  const [r, setR] = useState<FilterResult | null>(null);
  useEffect(() => {
    filteringApi.result(id).then(setR).catch(() => setR(null));
  }, [id]);
  if (!r) return null;
  // §7 — rationale belongs to the reviewer who wrote it; fold it into that reviewer's row
  // (keyed by on-chain DRep id) so we render exactly the assigned jury, never a duplicate list.
  const rationaleByDrep = new Map((r.votes ?? []).filter((v) => v.rationale).map((v) => [v.drep, v.rationale]));
  const open = r.status === 'ACTIVE' && r.stage === 'FILTERING';
  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Filtering — 1 member · 1 vote</h3>
        <AnchorLink txHash={r.anchorTxHash} />
      </div>
      {/* §7.1 — a fixed jury (FILTER_REVIEWER_COUNT) decides; no abstain in filtering. */}
      <div className="mt-1 text-xs text-neutral-500">
        {r.reviewers} reviewers · {r.yes} YES / {r.no} NO · need {r.threshold} to decide
      </div>
      {r.assigned && r.assigned.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {r.assigned.map((a, i) => {
            const rationale = a.drep ? rationaleByDrep.get(a.drep) : null;
            return (
              <li key={i} className="rounded border border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-800">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">{a.displayName ?? (a.drep ? `${a.drep.slice(0, 16)}…` : 'DRep')}</span>
                    {a.expertiseMatch ? (
                      <span className="rounded bg-emerald-100 px-1 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" title="matched the proposal's expertise areas">expertise</span>
                    ) : null}
                  </span>
                  {a.voted ? (
                    <span className={`font-semibold ${choiceCls[a.choice ?? ''] ?? ''}`}>{a.choice}</span>
                  ) : (
                    // §5 — "pending" only while filtering is open; otherwise the reviewer simply didn't vote.
                    <span className="text-amber-600">{open ? 'pending' : 'not voted'}</span>
                  )}
                </div>
                {rationale ? <div className="mt-1 whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">{rationale}</div> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-2 text-xs text-neutral-400">No reviewers drawn yet.</div>
      )}
    </section>
  );
}

function DvSection({ id, isBoard }: { id: string; isBoard: boolean }) {
  const [r, setR] = useState<DvResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => dvApi.result(id).then(setR).catch(() => setR(null)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!r || !r.open) return null;

  const total = r.totalPower ?? 0;
  const yes = r.yesPower ?? 0;
  const abstain = r.abstainPower ?? 0;
  const no = Math.max(0, total - yes - abstain); // explicit + implicit NO
  const denom = r.denominator ?? total - abstain;
  // Threshold is a % of the denominator (total − abstain); place it on the total-power scale.
  const thresholdPosPct = total > 0 ? ((((r.thresholdPct ?? 0) / 100) * denom) / total) * 100 : 0;

  const optIn = async () => {
    setBusy(true); setMsg(null);
    try { await dvApi.optIn(id); setMsg('You opted in — you can now vote in My area.'); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'opt-in failed'); }
    finally { setBusy(false); }
  };

  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Debate &amp; Vote — balanced voting power</h3>
        <AnchorLink txHash={r.anchorTxHash} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {r.cast}/{r.eligible} eligible DReps voted · {r.approved ? 'passing' : 'not passing'} at {r.ratioPct}% (need {r.thresholdPct}% of participating power)
      </div>
      <PowerBar yes={yes} no={no} abstain={abstain} total={total} thresholdPosPct={thresholdPosPct} thresholdPct={r.thresholdPct ?? 0} />
      {isBoard ? (
        <div className="mt-2 text-xs">
          <button onClick={optIn} disabled={busy} className="rounded border border-neutral-400 px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800">
            {busy ? 'Opting in…' : 'Opt in to vote on this funding proposal'}
          </button>
          <span className="ml-2 text-neutral-500">Board members only vote on funding proposals after opting in.</span>
          {msg ? <div className="mt-1 text-emerald-600">{msg}</div> : null}
        </div>
      ) : null}
      <div className="mt-3"><Votes votes={r.votes ?? []} /></div>
    </section>
  );
}

/** §4.4 — YES / NO / abstain as balanced voting power, scaled to total power, with a threshold marker. */
function PowerBar({ yes, no, abstain, total, thresholdPosPct, thresholdPct }: { yes: number; no: number; abstain: number; total: number; thresholdPosPct: number; thresholdPct: number }) {
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const tpos = Math.min(100, Math.max(0, thresholdPosPct));
  return (
    <div className="mt-6">
      <div className="relative h-5 w-full rounded bg-neutral-200 dark:bg-neutral-800">
        <div className="absolute inset-0 overflow-hidden rounded">
          <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${pct(yes)}%` }} />
          <div className="absolute inset-y-0 bg-red-400" style={{ left: `${pct(yes)}%`, width: `${pct(no)}%` }} />
          <div className="absolute inset-y-0 bg-neutral-400" style={{ left: `${pct(yes + no)}%`, width: `${pct(abstain)}%` }} />
        </div>
        {/* §6 — threshold marker with a labelled percentage above the line. */}
        <div className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-neutral-700 dark:text-neutral-300" style={{ left: `${tpos}%` }}>
          threshold {thresholdPct}%
        </div>
        <div className="absolute -top-1.5 bottom-0 w-0.5 bg-neutral-900 dark:bg-white" style={{ left: `${tpos}%` }} title={`threshold ${thresholdPct}%`} />
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />YES {fmt(yes)}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-400" />NO {fmt(no)}</span>
        {abstain > 0 ? <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-neutral-400" />abstain {fmt(abstain)}</span> : null}
        <span className="tabular-nums">total power {fmt(total)} · threshold {thresholdPct}%</span>
      </div>
    </div>
  );
}

/** §7/§8 — content version history with a simple line diff (original vs selected). */
function VersionsSection({ id }: { id: string }) {
  const [versions, setVersions] = useState<ProposalVersionEntry[]>([]);
  useEffect(() => {
    proposalVersionsApi.list(id).then(setVersions).catch(() => setVersions([]));
  }, [id]);
  const [sel, setSel] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [showFull, setShowFull] = useState(false);
  if (versions.length < 2) return null; // nothing was edited → no history to show
  const current = versions[versions.length - 1];
  const prev = versions.find((v) => v.version === (sel ?? versions[versions.length - 2].version)) ?? versions[versions.length - 2];

  if (!open) {
    return (
      <section className={card}>
        <button onClick={() => setOpen(true)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-semibold">Edit history</span>
          <span className="text-xs text-neutral-500">{versions.length} versions · view changes ▸</span>
        </button>
      </section>
    );
  }
  return (
    <section className={card}>
      <button onClick={() => setOpen(false)} className="flex w-full items-center justify-between text-left">
        <span className="text-base font-semibold">Edit history</span>
        <span className="text-xs text-neutral-500">hide ▾</span>
      </button>
      {/* Pick any earlier version; compare it to (or view it next to) the current one. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        version
        <select
          className="rounded border border-neutral-300 px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
          value={prev.version}
          onChange={(e) => setSel(Number(e.target.value))}
        >
          {versions.filter((v) => !v.current).map((v) => (
            <option key={v.version} value={v.version}>v{v.version} ({fmtDateTime(v.editedAt)}{v.editor ? ` · ${v.editor}` : ''})</option>
          ))}
        </select>
        → current (v{current.version})
        <button onClick={() => setShowFull((s) => !s)} className="ml-2 underline">{showFull ? 'show diff' : 'show full versions'}</button>
      </div>
      {showFull ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-500">v{prev.version} (selected)</div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">{prev.contentMd}</pre>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-500">v{current.version} (latest)</div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">{current.contentMd}</pre>
          </div>
        </div>
      ) : (
        <Diff oldText={prev.contentMd} newText={current.contentMd} />
      )}
    </section>
  );
}

/** Minimal LCS line diff → red (removed) / green (added) / unchanged. */
function Diff({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(() => diffLines(oldText.split('\n'), newText.split('\n')), [oldText, newText]);
  return (
    <pre className="mt-2 overflow-x-auto rounded border border-neutral-200 p-2 text-xs leading-relaxed dark:border-neutral-800">
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            r.op === 'add'
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : r.op === 'del'
                ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
                : 'text-neutral-600 dark:text-neutral-400'
          }
        >
          {r.op === 'add' ? '+ ' : r.op === 'del' ? '- ' : '  '}
          {r.line || ' '}
        </div>
      ))}
    </pre>
  );
}

function diffLines(a: string[], b: string[]): { op: 'eq' | 'add' | 'del'; line: string }[] {
  const n = a.length, m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: { op: 'eq' | 'add' | 'del'; line: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: 'eq', line: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ op: 'del', line: a[i] }); i++; }
    else { out.push({ op: 'add', line: b[j] }); j++; }
  }
  while (i < n) out.push({ op: 'del', line: a[i++] });
  while (j < m) out.push({ op: 'add', line: b[j++] });
  return out;
}

function EditSection({ id, proposal, onChange }: { id: string; proposal: PDetail; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(proposal.title);
  const [content, setContent] = useState(proposal.contentMd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editable during Filtering or the Debate & Vote editing sub-phase (backend enforces precisely).
  const editable = proposal.stage === 'FILTERING' || proposal.stage === 'DEBATE_VOTE';
  if (!editable) return null;

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await proposalEditApi.update(id, { title, contentMd: content });
      setOpen(false);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'edit failed');
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-3 rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
        Edit proposal
      </button>
    );
  return (
    <div className="mt-3 space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <input className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" value={title} onChange={(e) => setTitle(e.target.value)} />
      <MarkdownEditor value={content} onChange={setContent} placeholder="Proposal pitch (markdown)" minRows={6} />
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
      <div className="flex gap-2">
        <button disabled={busy} onClick={save} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save (creates a new version)'}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-neutral-500 hover:underline">cancel</button>
      </div>
    </div>
  );
}

function MilestonesSection({ id, isBoard, isMine, onChange }: { id: string; isBoard: boolean; isMine: boolean; onChange: () => void }) {
  const [ms, setMs] = useState<MilestoneView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    milestonesApi.forProposal(id).then(setMs).catch(() => setMs([]));
  }, [id]);
  useEffect(load, [load]);
  if (!ms) return null;
  const noReviewers = ms.every((m) => m.reviewers.length === 0);

  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Funding — milestones (§11)</h3>
        {isBoard && noReviewers ? (
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); try { await boardMilestoneApi.drawReviewers(id); load(); } finally { setBusy(false); } }}
            className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            {busy ? 'Drawing…' : 'Draw + confirm reviewers'}
          </button>
        ) : null}
      </div>
      <ul className="mt-2 space-y-2">
        {ms.map((m) => (
          <MilestoneRow key={m.id} m={m} isMine={isMine} onChange={() => { load(); onChange(); }} />
        ))}
      </ul>
    </section>
  );
}

function MilestoneRow({ m, isMine, onChange }: { m: MilestoneView; isMine: boolean; onChange: () => void }) {
  const [poa, setPoa] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null); setBusy(true);
    try { await fn(); onChange(); } catch (e) { setError(e instanceof Error ? e.message : 'failed'); } finally { setBusy(false); }
  };
  return (
    <li className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">Milestone #{m.idx + 1} — {m.amountAda.toLocaleString()} ₳</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">{m.yes} YES / {m.no} NO (need {m.threshold})</span>
          <StatusBadge status={m.status} cls={PROPOSAL_STATUS_CLS} />
          <AnchorLink txHash={m.anchorTxHash} />
        </div>
      </div>
      {m.description ? <div className="mt-0.5 text-xs text-neutral-500">{m.description}</div> : null}
      {m.latestPoa ? (
        <div className="mt-1 rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-800/50">
          <div className="font-medium">Proof of Achievement (attempt {m.latestPoa.attempt})</div>
          <div className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">{m.latestPoa.contentMd}</div>
        </div>
      ) : null}
      {m.votes.length > 0 ? <div className="mt-1"><Votes votes={m.votes} /></div> : null}

      {/* Submitter posts/updates the POA while not yet approved. */}
      {isMine && m.status !== 'APPROVED' ? (
        <div className="mt-2 space-y-1">
          <textarea className="w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" rows={2} placeholder="Proof of Achievement (markdown + links)" value={poa} onChange={(e) => setPoa(e.target.value)} />
          <button disabled={busy || !poa.trim()} onClick={() => run(() => milestonesApi.submitPoa(m.id, poa))} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
            Submit POA
          </button>
        </div>
      ) : null}

      {/* Assigned reviewer votes when a POA is in review. */}
      {!isMine && m.status === 'POA_SUBMITTED' ? (
        <div className="mt-2 space-y-1">
          <input className="w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" placeholder="feedback (required for NO)" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(() => milestonesApi.vote(m.id, 'YES', rationale || undefined))} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300">YES</button>
            <button disabled={busy} onClick={() => run(() => milestonesApi.vote(m.id, 'NO', rationale))} className="rounded border border-red-500 px-2 py-0.5 text-xs text-red-700 disabled:opacity-40 dark:text-red-300">NO</button>
          </div>
        </div>
      ) : null}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </li>
  );
}

function CommentsSection({ id, title, canPost }: { id: string; title: string; canPost: boolean }) {
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    commentsApi.list(id).then(setComments).catch(() => setComments([]));
  }, [id]);
  useEffect(load, [load]);

  const post = async (contentMd: string, parentId?: string) => {
    setBusy(true);
    try { await commentsApi.create(id, contentMd, parentId); setText(''); load(); } finally { setBusy(false); }
  };

  return (
    <section className={card}>
      <h3 className="text-base font-semibold">Comments on “{title}”</h3>
      {canPost ? (
        <div className="mt-2 flex gap-2">
          <input className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" placeholder="Add a public comment…" value={text} onChange={(e) => setText(e.target.value)} />
          <button disabled={busy || !text.trim()} onClick={() => post(text)} className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Post</button>
        </div>
      ) : null}
      <ul className="mt-3 space-y-2">
        {comments.length === 0 ? <li className="text-sm text-neutral-500">No comments yet.</li> : null}
        {comments.map((c) => (
          <CommentItem key={c.id} c={c} canPost={canPost} onReply={(t) => post(t, c.id)} />
        ))}
      </ul>
    </section>
  );
}

const ROLE_CLS: Record<string, string> = {
  'Board member': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  Expert: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  'DAO member': 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
};
function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  return <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${ROLE_CLS[role] ?? 'bg-neutral-100 text-neutral-600'}`}>{role}</span>;
}
const nameOf = (a: CommentNode['author']) => a.displayName ?? (a.drepId ? `${a.drepId.slice(0, 16)}…` : 'Anonymous');

function CommentItem({ c, canPost, onReply }: { c: CommentNode; canPost: boolean; onReply: (t: string) => void }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  // §4 — expert feedback is visually differentiated.
  const expert = c.author.role === 'Expert';
  return (
    <li className={`rounded border p-2 text-sm ${expert ? 'border-amber-300 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30' : 'border-neutral-200 dark:border-neutral-800'}`}>
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">{nameOf(c.author)}<RoleBadge role={c.author.role} /></span>
        <span>{fmtDateTime(c.createdAt)}</span>
      </div>
      <div className={`mt-1 whitespace-pre-wrap ${c.deleted ? 'italic text-neutral-400' : ''}`}>{c.deleted ? '[deleted]' : c.contentMd}</div>
      {canPost && !c.deleted ? (
        <button onClick={() => setReplying((v) => !v)} className="mt-1 text-xs text-neutral-500 hover:underline">reply</button>
      ) : null}
      {replying ? (
        <div className="mt-1 flex gap-2">
          <input className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" value={text} onChange={(e) => setText(e.target.value)} />
          <button onClick={() => { onReply(text); setText(''); setReplying(false); }} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">send</button>
        </div>
      ) : null}
      {c.replies && c.replies.length > 0 ? (
        <ul className="mt-2 space-y-2 border-l border-neutral-200 pl-3 dark:border-neutral-800">
          {c.replies.map((r) => {
            const rExpert = r.author.role === 'Expert';
            return (
              <li key={r.id} className={`rounded text-sm ${rExpert ? 'bg-amber-50/50 p-1.5 dark:bg-amber-950/30' : ''}`}>
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">{nameOf(r.author)}<RoleBadge role={r.author.role} /></span>
                  <span>{fmtDateTime(r.createdAt)}</span>
                </div>
                <div className={`mt-0.5 whitespace-pre-wrap ${r.deleted ? 'italic text-neutral-400' : ''}`}>{r.deleted ? '[deleted]' : r.contentMd}</div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
