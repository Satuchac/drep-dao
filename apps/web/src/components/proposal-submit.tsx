'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import {
  proposalsApi,
  roundsApi,
  type ProposalMilestoneInput,
  type ProposalSummary,
  type RoundSummary,
} from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { ProposalDetail } from './proposal-detail';

type Cat = { id: string; name: string; minAda: number | null; maxAda: number | null; conditions: string | null };

export function ProposalSubmit() {
  const { cfg } = useExplorer();
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [mine, setMine] = useState<ProposalSummary[]>([]);
  const [roundId, setRoundId] = useState('');
  const [cats, setCats] = useState<Cat[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [amount, setAmount] = useState(50000);
  const [commercial, setCommercial] = useState(false);
  const [ms, setMs] = useState<ProposalMilestoneInput[]>([{ description: '', amountAda: 50000 }]);
  const [costBreakdown, setCostBreakdown] = useState('');
  const [teamInfo, setTeamInfo] = useState('');
  const [revenueSharing, setRevenueSharing] = useState('');
  const [subcatIds, setSubcatIds] = useState<string[]>([]);
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadMine = () => proposalsApi.mine().then(setMine).catch(() => undefined);
  useEffect(() => {
    // §3/§19 — proposals can only be created while a round's Submission stage is open.
    roundsApi.list().then((r) => setRounds(r.filter((x) => x.status === 'SUBMISSION'))).catch(() => undefined);
    loadMine();
  }, []);

  useEffect(() => {
    if (!roundId) return;
    roundsApi.get(roundId).then((r) => {
      setCats(r.categories.map((c) => ({ id: c.id, name: c.name, minAda: c.minAda, maxAda: c.maxAda, conditions: c.conditions })));
      setCategoryId(r.categories[0]?.id ?? '');
    });
  }, [roundId]);

  const selectedCat = cats.find((c) => c.id === categoryId);

  const field = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  const buildInput = () => ({
    roundId,
    categoryId,
    title: title.trim(),
    contentMd: content,
    isCommercial: commercial,
    requestedAmountAda: Number(amount),
    subcategoryIds: subcatIds.length ? subcatIds : undefined,
    costBreakdownMd: costBreakdown.trim() || undefined,
    teamInfoMd: teamInfo.trim() || undefined,
    revenueSharingMd: revenueSharing.trim() || undefined,
    milestones: ms.map((m) => ({ description: m.description, amountAda: Number(m.amountAda) })),
  });

  // §5.2 milestones must sum to the request, and the request must fit the category's ask range.
  const inputsOk = () => {
    const sum = ms.reduce((a, m) => a + Number(m.amountAda), 0);
    if (sum !== Number(amount)) {
      setError(`milestones (${sum}) must sum to requested amount (${amount})`);
      return false;
    }
    if (selectedCat?.minAda != null && Number(amount) < selectedCat.minAda) {
      setError(`requested ${Number(amount).toLocaleString()} ₳ is below "${selectedCat.name}" minimum ask of ${selectedCat.minAda.toLocaleString()} ₳`);
      return false;
    }
    if (selectedCat?.maxAda != null && Number(amount) > selectedCat.maxAda) {
      setError(`requested ${Number(amount).toLocaleString()} ₳ exceeds "${selectedCat.name}" maximum ask of ${selectedCat.maxAda.toLocaleString()} ₳`);
      return false;
    }
    return true;
  };

  const reset = () => {
    setTitle('');
    setContent('');
    setFee('');
    setCostBreakdown('');
    setTeamInfo('');
    setRevenueSharing('');
    setSubcatIds([]);
    setMs([{ description: '', amountAda: Number(amount) }]);
  };

  // §3 — save privately as a DRAFT (no fee needed); submit it later.
  const saveDraft = async () => {
    setError(null);
    setMsg(null);
    if (!inputsOk()) return;
    setBusy(true);
    try {
      const d = await proposalsApi.create(buildInput());
      setMsg(`Saved draft "${d.title}" — it stays private until you submit and a board member confirms your fee.`);
      setOpen(false);
      reset();
      loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  // §3.3 — submit with the on-chain fee tx; goes to PENDING (still private) until the board confirms.
  const submitNow = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (!inputsOk()) return;
    if (!fee.trim()) {
      setError('Paste the submission-fee transaction hash to submit (or use Save Draft).');
      return;
    }
    setBusy(true);
    try {
      const draft = await proposalsApi.create(buildInput());
      const submitted = await proposalsApi.submit(draft.id, fee.trim());
      setMsg(`Submitted "${submitted.title}" — fee ${submitted.submissionFeeAda} ₳. A board member verifies your payment on-chain; it becomes public once confirmed.`);
      setOpen(false);
      reset();
      loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submission failed');
    } finally {
      setBusy(false);
    }
  };

  // §8 — open one of my proposals to read it, edit it (when the stage allows), and submit milestone POAs.
  if (openId) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <ProposalDetail id={openId} onBack={() => { setOpenId(null); loadMine(); }} />
      </section>
    );
  }

  const feeEstimate = Math.round(Math.min((amount * (commercial ? 3 : 1)) / 100, commercial ? 5000 : 1000));

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Funding proposals</h3>
        <button onClick={() => setOpen((v) => !v)} className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
          {open ? 'Cancel' : '+ New proposal'}
        </button>
      </div>

      {msg ? <div className="mt-2 text-sm text-emerald-600">{msg}</div> : null}

      {open && rounds.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          No round is currently open for submissions. Proposals can only be submitted while a board
          member has a round in the <strong>Submission</strong> stage.
        </p>
      ) : null}

      {open && rounds.length > 0 ? (
        <form onSubmit={submitNow} className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select className={field} value={roundId} onChange={(e) => setRoundId(e.target.value)} required>
              <option value="">Select round…</option>
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>#{r.number} {r.name ?? ''} ({r.status})</option>
              ))}
            </select>
            <select className={field} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <input className={`${field} w-full`} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <textarea className={`${field} w-full`} rows={3} placeholder="Pitch (markdown)" value={content} onChange={(e) => setContent(e.target.value)} required />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label>Requested ₳ <input type="number" className={`${field} w-32`} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} /> commercial</label>
          </div>
          {/* §5.2 — the selected category's per-proposal ask range + conditions. */}
          {selectedCat && (selectedCat.minAda != null || selectedCat.maxAda != null || selectedCat.conditions) ? (
            <div className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              {selectedCat.minAda != null || selectedCat.maxAda != null ? (
                <div className={(selectedCat.minAda != null && Number(amount) < selectedCat.minAda) || (selectedCat.maxAda != null && Number(amount) > selectedCat.maxAda) ? 'font-medium text-red-600' : 'text-neutral-600 dark:text-neutral-400'}>
                  Allowed ask for “{selectedCat.name}”: {selectedCat.minAda != null ? `min ${selectedCat.minAda.toLocaleString()} ₳` : 'no min'} · {selectedCat.maxAda != null ? `max ${selectedCat.maxAda.toLocaleString()} ₳` : 'no max'}
                </div>
              ) : null}
              {selectedCat.conditions ? <div className="mt-0.5 whitespace-pre-wrap text-neutral-500">Conditions: {selectedCat.conditions}</div> : null}
            </div>
          ) : null}
          <div>
            <div className="text-sm font-medium">Milestones (must sum to requested)</div>
            {ms.map((m, i) => (
              <div key={i} className="mt-1 flex flex-wrap items-center gap-2">
                <input className={`${field} flex-1`} placeholder="description" value={m.description} onChange={(e) => setMs((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} required />
                <input type="number" className={`${field} w-28`} value={m.amountAda} onChange={(e) => setMs((p) => p.map((x, j) => (j === i ? { ...x, amountAda: Number(e.target.value) } : x)))} />
                {ms.length > 1 ? <button type="button" className="text-xs text-red-600" onClick={() => setMs((p) => p.filter((_, j) => j !== i))}>remove</button> : null}
              </div>
            ))}
            <button type="button" className="mt-1 text-xs underline" onClick={() => setMs((p) => [...p, { description: '', amountAda: 0 }])}>+ add milestone</button>
          </div>
          {/* §3.4 — funding-specific detail (all optional). */}
          <textarea className={`${field} w-full`} rows={2} placeholder="Cost breakdown (optional, markdown) — how the budget is spent" value={costBreakdown} onChange={(e) => setCostBreakdown(e.target.value)} />
          <textarea className={`${field} w-full`} rows={2} placeholder="Team info (optional, markdown) — who is delivering this" value={teamInfo} onChange={(e) => setTeamInfo(e.target.value)} />
          <textarea className={`${field} w-full`} rows={2} placeholder="Revenue sharing (optional, markdown) — for commercial projects: how the DAO shares in returns" value={revenueSharing} onChange={(e) => setRevenueSharing(e.target.value)} />
          {/* §5.3/§7.1 — expertise tags drive which DReps are drawn to filter this proposal. */}
          <div>
            <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Expertise areas (helps match filtering reviewers)</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DEFAULT_SUBCATEGORIES.map((s) => {
                const on = subcatIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSubcatIds((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border-neutral-300 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700'}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* §12/§16 — the team pays the submission fee on-chain to the dedicated address. */}
          <div className="rounded border border-neutral-200 p-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            <div>
              Submission fee: <strong>{commercial ? '3% (commercial)' : '1% (open-source)'}</strong> of the requested
              amount ≈ <strong>{feeEstimate.toLocaleString()} ₳</strong>. To <strong>submit</strong>, pay it to the
              address below and paste the transaction hash; the platform verifies it on-chain and a board member confirms.
            </div>
            {cfg?.submissionFeeAddress ? (
              <div className="mt-1 break-all font-mono text-[11px] text-neutral-500">{cfg.submissionFeeAddress}</div>
            ) : null}
          </div>
          <input className={`${field} w-full`} placeholder="Submission fee TX hash (needed only to submit)" value={fee} onChange={(e) => setFee(e.target.value)} />
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {/* §3 — privacy + the two ways out of the form. */}
          <p className="text-xs text-neutral-500">
            <strong>Drafts are private</strong> — visible only to you, not to DReps or the board. A proposal becomes
            public only after you submit and a board member confirms the fee.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || !roundId || !fee.trim()} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'Working…' : 'Submit'}
            </button>
            <button type="button" onClick={saveDraft} disabled={busy || !roundId} className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
              Save Draft
            </button>
          </div>
        </form>
      ) : null}

      {mine.length > 0 ? (
        <div className="mt-3">
          <div className="text-sm font-medium">My proposals</div>
          <p className="text-xs text-neutral-500">Drafts are private. Open one to read/edit it; submit a draft when you&apos;re ready (pay the fee + paste the tx).</p>
          <ul className="mt-1 space-y-1 text-sm">
            {mine.map((p) => (
              <MineRow key={p.id} p={p} feeAddress={cfg?.submissionFeeAddress ?? undefined} onOpen={() => setOpenId(p.id)} onSubmitted={loadMine} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** A row in "My proposals": open it, plus an inline Submit for DRAFTs (submit later). */
function MineRow({
  p,
  feeAddress,
  onOpen,
  onSubmitted,
}: {
  p: ProposalSummary;
  feeAddress?: string;
  onOpen: () => void;
  onSubmitted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  const isDraft = p.status === 'DRAFT';

  const submit = async () => {
    setError(null);
    if (!fee.trim()) { setError('Paste your submission-fee tx hash.'); return; }
    setBusy(true);
    try {
      await proposalsApi.submit(p.id, fee.trim());
      setSubmitting(false);
      setFee('');
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'submit failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button onClick={onOpen} className="flex-1 text-left hover:underline">
          <span>{p.title} <span className="text-neutral-500">· {p.requestedAmountAda.toLocaleString()} ₳</span></span>
        </button>
        <span className="flex items-center gap-2">
          <span className={`text-xs ${isDraft ? 'text-amber-600' : 'text-neutral-500'}`}>
            {p.status}{p.stage ? ` · ${p.stage}` : ''}{isDraft ? ' · private' : ''}
          </span>
          {isDraft ? (
            <button onClick={() => setSubmitting((v) => !v)} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950">
              {submitting ? 'Close' : 'Submit'}
            </button>
          ) : null}
        </span>
      </div>
      {isDraft && submitting ? (
        <div className="space-y-1 border-t border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
          <div className="text-neutral-500">
            Pay the submission fee on-chain, then paste the tx hash. The platform verifies it and a board member confirms.
          </div>
          {feeAddress ? <div className="break-all font-mono text-[11px] text-neutral-500">{feeAddress}</div> : null}
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${field} flex-1`} placeholder="Submission fee TX hash" value={fee} onChange={(e) => setFee(e.target.value)} />
            <button onClick={submit} disabled={busy} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'Submitting…' : 'Submit'}
            </button>
          </div>
          {error ? <div className="text-red-600">{error}</div> : null}
        </div>
      ) : null}
    </li>
  );
}
