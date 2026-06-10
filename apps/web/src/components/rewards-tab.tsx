'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { roundsApi, rewardsApi, type RoundSummary, type RewardCalcView, type ExpertRewardRow, type RewardSourceBucket } from '@/lib/api';

const KIND_LABEL: Record<string, string> = {
  FILTER: 'Filtering rewards',
  DV_FIXED: 'Debate & Vote — fixed',
  DV_BONUS: 'Debate & Vote — bonus',
  MILESTONE: 'Milestone review',
  BOARD_MONTHLY: 'Board monthly',
};
// Order the reward cards by stage: filtering → D&V fixed → D&V bonus → milestone → experts/board.
const KIND_ORDER: Record<string, number> = { FILTER: 0, DV_FIXED: 1, DV_BONUS: 2, MILESTONE: 3, EXPERT: 4, BOARD_MONTHLY: 5 };
const inputCls = 'w-24 rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900';

export function RewardsTab() {
  const [sub, setSub] = useState<'overview' | 'experts' | 'setup'>('overview');
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [roundId, setRoundId] = useState<string>('');
  useEffect(() => {
    roundsApi.list().then((rs) => { setRounds(rs); if (rs[0] && !roundId) setRoundId(rs[0].id); }).catch(() => undefined);
  }, [roundId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Rewards</h2>
        <p className="text-sm text-neutral-500">Calculate per-DRep rewards for filtering, Debate&nbsp;&amp;&nbsp;Vote and milestone review, adjust amounts, and pay them out via the multisig (default source: the Rewards bucket).</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
          {([['overview', 'Overview'], ['experts', 'Expert rewards'], ['setup', 'Setup']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSub(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${sub === k ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'border-transparent text-neutral-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      {sub !== 'setup' ? (
        <label className="flex items-center gap-2 text-sm">Round
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)} className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900">
            {rounds.map((r) => <option key={r.id} value={r.id}>#{r.number}{r.name ? ` — ${r.name}` : ''}</option>)}
          </select>
        </label>
      ) : null}

      {sub === 'overview' && roundId ? <Overview roundId={roundId} /> : null}
      {sub === 'experts' && roundId ? <Experts roundId={roundId} /> : null}
      {sub === 'setup' ? <Setup /> : null}
    </div>
  );
}

function Overview({ roundId }: { roundId: string }) {
  const [calcs, setCalcs] = useState<RewardCalcView[] | null>(null);
  const [buckets, setBuckets] = useState<RewardSourceBucket[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { rewardsApi.overview(roundId).then(setCalcs).catch(() => setCalcs([])); }, [roundId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { rewardsApi.sourceBuckets().then((r) => setBuckets(r.buckets)).catch(() => setBuckets([])); }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try { await fn(); load(); } catch (e) { setMsg(e instanceof Error ? e.message : 'failed'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => run(() => rewardsApi.computeFiltering(roundId))} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">Compute filtering rewards</button>
        <button onClick={() => run(() => rewardsApi.computeDv(roundId))} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">Compute D&V rewards</button>
        <button onClick={() => run(() => rewardsApi.computeMilestone(roundId))} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">Compute milestone rewards (monthly)</button>
      </div>
      {msg ? <div className="text-xs text-red-600">{msg}</div> : null}
      {calcs && calcs.length === 0 ? <p className="text-sm text-neutral-500">Nothing computed yet — use the buttons above.</p> : null}
      {calcs?.slice().sort((a, b) => (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99)).map((c) => <CalcCard key={c.id} calc={c} buckets={buckets} onChange={load} />)}
    </div>
  );
}

function CalcCard({ calc, buckets, onChange }: { calc: RewardCalcView; buckets: RewardSourceBucket[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const total = calc.entries.reduce((s, e) => s + e.amountAda, 0);
  const allPaid = calc.entries.length > 0 && calc.entries.every((e) => e.paid);
  // §12 — default source by stage: filtering draws from the Submission-fee bucket, everything
  // else from Rewards (fall back to the primary). The board can override before preparing.
  const defaultBucketId = useMemo(() => {
    const pick = calc.kind === 'FILTER'
      ? (b: RewardSourceBucket) => b.isDefaultSubmissionFees
      : (b: RewardSourceBucket) => b.isDefaultRewards;
    return (buckets.find(pick) ?? buckets.find((b) => b.isPrimary) ?? buckets[0])?.id ?? '';
  }, [buckets, calc.kind]);
  const [src, setSrc] = useState('');
  useEffect(() => { setSrc(defaultBucketId); }, [defaultBucketId]);
  const pay = async () => {
    setBusy(true); setMsg(null);
    try { const r = await rewardsApi.preparePayout(calc.id, src || undefined); setMsg(`Queued ${r.recipients} payouts (${r.totalAda.toLocaleString()} ₳) — review & sign it under Actions.`); onChange(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'failed'); } finally { setBusy(false); }
  };
  // Recompute this calc in place from the latest votes (so the board doesn't have to find
  // the compute buttons up top). Only offered before a payout is prepared.
  const recompute = async () => {
    setBusy(true); setMsg(null);
    try {
      const rid = calc.roundId ?? '';
      if (calc.kind === 'FILTER') await rewardsApi.computeFiltering(rid);
      else if (calc.kind === 'DV_FIXED' || calc.kind === 'DV_BONUS') await rewardsApi.computeDv(rid);
      else if (calc.kind === 'MILESTONE') await rewardsApi.computeMilestone(rid);
      else if (calc.kind === 'BOARD_MONTHLY') await rewardsApi.computeBoardMonthly();
      onChange();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'failed'); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{KIND_LABEL[calc.kind] ?? calc.kind} · pool {calc.poolAda.toLocaleString()} ₳</h3>
        <div className="flex items-center gap-2">
        {!calc.payout ? (
          <button onClick={recompute} disabled={busy} title="Recalculate this reward from the latest votes" className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700">
            {busy ? '…' : '↻ Recompute'}
          </button>
        ) : null}
        {calc.payout ? (
          calc.payout.status === 'CONFIRMED' || calc.payout.status === 'BROADCASTED' ? (
            <span className="text-xs text-emerald-600">✓ paid on-chain</span>
          ) : (
            <span className="text-xs text-amber-600">⏳ payout prepared — review &amp; sign under Actions</span>
          )
        ) : allPaid ? (
          <span className="text-xs text-emerald-600">✓ all paid</span>
        ) : !calc.payable ? (
          <span className="text-xs text-neutral-400">payable once the stage ends</span>
        ) : (
          <div className="flex items-center gap-2">
            {buckets.length > 0 ? (
              <label className="flex items-center gap-1 text-xs text-neutral-500">
                from
                <select
                  value={src}
                  onChange={(e) => setSrc(e.target.value)}
                  title="Source address the payout spends from"
                  className="max-w-[14rem] rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label} · {b.balanceAda.toLocaleString()} ₳
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button onClick={pay} disabled={busy} className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300">
              {busy ? 'Preparing…' : 'Prepare bulk payout'}
            </button>
          </div>
        )}
        </div>
      </div>
      {msg ? <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{msg}</div> : null}
      <table className="mt-2 w-full text-xs">
        <thead><tr className="text-left text-neutral-400"><th className="font-normal">Recipient</th><th className="font-normal">{calc.kind === 'MILESTONE' ? 'Checks' : 'Votes'}</th>{calc.kind === 'DV_BONUS' ? <th className="font-normal" title="Final voting power used to weight the bonus">Power</th> : null}<th className="font-normal">Computed</th><th className="font-normal">Pay</th><th></th></tr></thead>
        <tbody>
          {calc.entries.map((e) => <EntryRow key={e.id} e={e} showPower={calc.kind === 'DV_BONUS'} onChange={onChange} />)}
          {calc.entries.length === 0 ? <tr><td colSpan={4} className="py-1 text-neutral-400">No recipients.</td></tr> : null}
        </tbody>
        <tfoot><tr className="border-t border-neutral-200 font-medium dark:border-neutral-800"><td className="pt-1">Total</td><td className="pt-1 tabular-nums">{calc.entries.reduce((s, e) => s + (e.units ?? 0), 0)}</td><td></td><td className="pt-1 tabular-nums">{total.toLocaleString()} ₳</td><td></td></tr></tfoot>
      </table>
    </section>
  );
}

function EntryRow({ e, showPower = false, onChange }: { e: RewardCalcView['entries'][number]; showPower?: boolean; onChange: () => void }) {
  const [val, setVal] = useState(String(e.amountAda));
  useEffect(() => { setVal(String(e.amountAda)); }, [e.amountAda]);
  const save = async () => {
    const n = Number(val);
    if (Number.isNaN(n)) return;
    await rewardsApi.setOverride(e.id, n === e.computedAda ? null : n).catch(() => undefined);
    onChange();
  };
  return (
    <tr className="border-t border-neutral-100 dark:border-neutral-900">
      <td className="py-1">{e.recipient.name} <span className="text-neutral-400">{e.recipient.type}</span>{!e.recipient.address ? <span className="text-amber-600"> · no reward address</span> : null}</td>
      <td className="py-1 tabular-nums text-neutral-600 dark:text-neutral-300">{e.units ?? '—'}</td>
      {showPower ? <td className="py-1 tabular-nums text-neutral-500">{e.power != null ? e.power.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</td> : null}
      <td className="py-1 tabular-nums text-neutral-500">{e.computedAda.toLocaleString()} ₳</td>
      <td className="py-1">
        {e.paid ? <span className="text-emerald-600">paid</span> : (
          <input value={val} onChange={(ev) => setVal(ev.target.value)} onBlur={save} className={inputCls} />
        )}
        {e.overridden && !e.paid ? <span className="ml-1 text-[10px] text-amber-600">edited</span> : null}
      </td>
      <td></td>
    </tr>
  );
}

function Experts({ roundId }: { roundId: string }) {
  const [rows, setRows] = useState<ExpertRewardRow[] | null>(null);
  const load = useCallback(() => { rewardsApi.listExpertRewards(roundId).then(setRows).catch(() => setRows([])); }, [roundId]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return null;
  if (rows.length === 0) return <p className="text-sm text-neutral-500">No board-approved experts.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500">Set each expert&apos;s ADA reward for this round per stage. The milestone switch: ON = the expert also earns the per-check DRep reward (extra) on top; OFF = they get only the milestone amount.</p>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-neutral-400"><th className="font-normal">Expert</th><th className="font-normal">Filtering ₳</th><th className="font-normal">D&V ₳</th><th className="font-normal">Milestone ₳</th><th className="font-normal">Like DRep</th></tr></thead>
        <tbody>{rows.map((r) => <ExpertRow key={r.expertId} roundId={roundId} row={r} onChange={load} />)}</tbody>
      </table>
    </div>
  );
}

function ExpertRow({ roundId, row, onChange }: { roundId: string; row: ExpertRewardRow; onChange: () => void }) {
  const [f, setF] = useState(String(row.filteringAda));
  const [d, setD] = useState(String(row.dvAda));
  const [m, setM] = useState(String(row.milestoneAda));
  const save = (dto: Partial<ExpertRewardRow>) => rewardsApi.setExpertReward(roundId, row.expertId, dto).then(onChange).catch(() => undefined);
  return (
    <tr className="border-t border-neutral-100 dark:border-neutral-900">
      <td className="py-1">{row.name}</td>
      <td className="py-1"><input value={f} onChange={(e) => setF(e.target.value)} onBlur={() => save({ filteringAda: Number(f) || 0 })} className={inputCls} /></td>
      <td className="py-1"><input value={d} onChange={(e) => setD(e.target.value)} onBlur={() => save({ dvAda: Number(d) || 0 })} className={inputCls} /></td>
      <td className="py-1"><input value={m} onChange={(e) => setM(e.target.value)} onBlur={() => save({ milestoneAda: Number(m) || 0 })} className={inputCls} /></td>
      <td className="py-1"><input type="checkbox" checked={row.milestoneLikeDrep} onChange={(e) => save({ milestoneLikeDrep: e.target.checked })} /></td>
    </tr>
  );
}

function Setup() {
  const [yearly, setYearly] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { rewardsApi.getBoardYearly().then((r) => setYearly(String(r.yearlyAda))).catch(() => undefined); }, []);
  const save = async () => { setMsg(null); try { await rewardsApi.setBoardYearly(Number(yearly) || 0); setMsg('Saved.'); } catch (e) { setMsg(e instanceof Error ? e.message : 'failed'); } };
  const compute = async () => { setMsg(null); try { const c = await rewardsApi.computeBoardMonthly(); setMsg(`Computed board pay for ${c.entries.length} members (${c.poolAda.toLocaleString()} ₳ this month).`); } catch (e) { setMsg(e instanceof Error ? e.message : 'failed'); } };
  return (
    <div className="max-w-md space-y-3">
      <div>
        <label className="text-sm font-medium">Yearly board reward (₳)</label>
        <p className="text-xs text-neutral-500">Total paid to the whole board per year. Monthly per-member = this ÷ 12 ÷ board seats.</p>
        <div className="mt-1 flex gap-2">
          <input value={yearly} onChange={(e) => setYearly(e.target.value)} className="w-40 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
          <button onClick={save} className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700">Save</button>
        </div>
      </div>
      <button onClick={compute} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">Compute this month&apos;s board pay</button>
      {msg ? <div className="text-xs text-neutral-600 dark:text-neutral-400">{msg}</div> : null}
      <p className="text-xs text-neutral-400">Board pay appears in Overview (no round selected → board monthly) — pay it out with the same bulk-payout flow.</p>
    </div>
  );
}
