'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUBCATEGORIES, ROUND_SETTING_DEFAULTS } from '@drep-dao/shared';
import {
  proposalsApi,
  roundsApi,
  type FeeVerification,
  type ProposalMilestoneInput,
  type ProposalSummary,
  type RoundDetail,
  type RoundSummary,
} from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { ProposalDetail } from './proposal-detail';
import { MarkdownEditor } from './markdown';
import { CopyButton } from './copy-button';

type Cat = { id: string; name: string; minAda: number | null; maxAda: number | null; conditions: string | null };

export function ProposalSubmit() {
  const { cfg } = useExplorer();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [editingFeedback, setEditingFeedback] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [mine, setMine] = useState<ProposalSummary[]>([]);
  const [roundId, setRoundId] = useState('');
  const [cats, setCats] = useState<Cat[]>([]);
  const [roundSettings, setRoundSettings] = useState<RoundDetail['settings'] | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [amount, setAmount] = useState(50000);
  const [commercial, setCommercial] = useState(false);
  const [ms, setMs] = useState<ProposalMilestoneInput[]>([{ title: '', description: '', acceptanceCriteria: '', amountAda: 50000 }]);
  const [costBreakdown, setCostBreakdown] = useState('');
  const [teamInfo, setTeamInfo] = useState('');
  const [revenueSharing, setRevenueSharing] = useState('');
  // §3.4 — Expected ecosystem impact + Success metrics / KPIs.
  const [ecosystemImpact, setEcosystemImpact] = useState('');
  const [successMetrics, setSuccessMetrics] = useState('');
  const [payoutAddress, setPayoutAddress] = useState('');
  const [subcatIds, setSubcatIds] = useState<string[]>([]);
  const [fee, setFee] = useState('');
  // §3 — optional refundable pledge. Off by default; the team opts in via a checkbox
  // that appears only when the round's `pledgeThresholdAda > 0`. Amount must be ≥
  // the threshold; the return-method description (collapsible MarkdownEditor) is
  // required when the pledge is on.
  const [pledgeEnabled, setPledgeEnabled] = useState(false);
  const [pledgeAmount, setPledgeAmount] = useState<number>(0);
  const [pledgeReturnMethod, setPledgeReturnMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // §12 — on-chain submission-fee verification result. Set when the submitter
  // clicks Verify next to the fee tx input; cumulative across all saved hashes.
  const [verifying, setVerifying] = useState(false);
  const [feeVerification, setFeeVerification] = useState<FeeVerification | null>(null);

  const loadMine = () => proposalsApi.mine().then(setMine).catch(() => undefined);
  useEffect(() => {
    // §3/§19 — proposals can only be created while a round's Submission stage is open.
    roundsApi
      .list()
      .then((r) => {
        const open = r.filter((x) => x.status === 'SUBMISSION');
        setRounds(open);
        // If exactly one round is open for submission (the common case), preselect it.
        if (open.length === 1) setRoundId(open[0].id);
      })
      .catch(() => undefined);
    loadMine();
  }, []);

  useEffect(() => {
    if (!roundId) return;
    roundsApi.get(roundId).then((r) => {
      const cs = r.categories.map((c) => ({ id: c.id, name: c.name, minAda: c.minAda, maxAda: c.maxAda, conditions: c.conditions }));
      setCats(cs);
      setRoundSettings(r.settings);
      // Keep the currently-selected category if it belongs to this round (preserves the draft's
      // category when editing); otherwise default to the first.
      setCategoryId((cur) => (cs.some((c) => c.id === cur) ? cur : cs[0]?.id ?? ''));
    });
  }, [roundId]);

  const selectedCat = cats.find((c) => c.id === categoryId);

  const field = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  // §5.2 — live readiness: what's still missing before this can be saved/submitted.
  const msSum = ms.reduce((a, m) => a + Number(m.amountAda || 0), 0);
  const milestonesMatch = msSum === Number(amount);
  const belowMin = selectedCat?.minAda != null && Number(amount) < selectedCat.minAda;
  const aboveMax = selectedCat?.maxAda != null && Number(amount) > selectedCat.maxAda;
  const draftMissing: string[] = [];
  if (!roundId) draftMissing.push('select a round');
  if (!categoryId) draftMissing.push('select a category');
  if (!title.trim()) draftMissing.push('add a title');
  if (!content.trim()) draftMissing.push('write the pitch');
  if (!(Number(amount) > 0)) draftMissing.push('set a requested amount');
  if (belowMin) draftMissing.push(`requested amount is below the category minimum (${selectedCat!.minAda!.toLocaleString()} ₳)`);
  if (aboveMax) draftMissing.push(`requested amount is above the category maximum (${selectedCat!.maxAda!.toLocaleString()} ₳)`);
  if (ms.some((m) => !(m.title ?? '').trim())) draftMissing.push('give every milestone a title');
  if (ms.some((m) => !m.description.trim())) draftMissing.push('describe every milestone');
  if (!milestonesMatch) draftMissing.push(`milestones must sum to the requested amount (now ${msSum.toLocaleString()} of ${Number(amount).toLocaleString()} ₳)`);
  // §3 — when the team opts in to a pledge, the amount must clear the round's
  // threshold and a return-method description is required.
  if (pledgeEnabled) {
    const minPledge = roundSettings?.pledgeThresholdAda ?? ROUND_SETTING_DEFAULTS.pledgeThresholdAda;
    if (!(pledgeAmount > 0)) draftMissing.push('set the pledge amount');
    else if (minPledge > 0 && pledgeAmount < minPledge) draftMissing.push(`pledge must be ≥ ${minPledge.toLocaleString()} ₳ (round minimum)`);
    if (!pledgeReturnMethod.trim()) draftMissing.push('describe how the pledge will be returned');
  }
  const draftReady = draftMissing.length === 0;

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
    ecosystemImpactMd: ecosystemImpact.trim() || undefined,
    successMetricsMd: successMetrics.trim() || undefined,
    payoutAddress: payoutAddress.trim() || undefined,
    // Persist the fee tx hash with the draft so it survives a save (verified on-chain at submission).
    submissionFeeTxHash: fee.trim() || undefined,
    // §3 — pledge promise (0 / undefined means "no pledge").
    pledgeAmountAda: pledgeEnabled && pledgeAmount > 0 ? pledgeAmount : undefined,
    pledgeReturnMethod: pledgeEnabled ? (pledgeReturnMethod.trim() || undefined) : undefined,
    milestones: ms.map((m) => ({
      title: m.title?.trim() || undefined,
      description: m.description,
      acceptanceCriteria: m.acceptanceCriteria?.trim() || undefined,
      amountAda: Number(m.amountAda),
    })),
  });

  // PATCH payload: the round is immutable once the draft exists, so drop it (the API
  // rejects unknown fields); the category may still change within the same round.
  const updatePayload = () => {
    const { roundId: _omitRound, ...patch } = buildInput();
    return patch;
  };

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
    setEditingId(null);
    setEditingStatus(null);
    setEditingFeedback(null);
    setTitle('');
    setContent('');
    setFee('');
    setCostBreakdown('');
    setTeamInfo('');
    setRevenueSharing('');
    setEcosystemImpact('');
    setSuccessMetrics('');
    setPayoutAddress('');
    setSubcatIds([]);
    setPledgeEnabled(false);
    setPledgeAmount(0);
    setPledgeReturnMethod('');
    setMs([{ title: '', description: '', acceptanceCriteria: '', amountAda: Number(amount) }]);
  };

  // Load an existing DRAFT into the form for editing (all fields, incl. milestones).
  const startEdit = async (id: string) => {
    setError(null);
    setMsg(null);
    setOpenId(null);
    try {
      const p = await proposalsApi.get(id);
      setEditingId(p.id);
      setEditingStatus(p.status);
      setEditingFeedback(p.feeReviewFeedback ?? null);
      setRoundId(p.roundId ?? '');
      setCategoryId(p.categoryId);
      setTitle(p.title);
      setContent(p.contentMd);
      setAmount(p.requestedAmountAda);
      setCommercial(!!p.isCommercial);
      setCostBreakdown(p.costBreakdownMd ?? '');
      setTeamInfo(p.teamInfoMd ?? '');
      setRevenueSharing(p.revenueSharingMd ?? '');
      setEcosystemImpact(p.ecosystemImpactMd ?? '');
      setSuccessMetrics(p.successMetricsMd ?? '');
      setPayoutAddress(p.payoutAddress ?? '');
      setSubcatIds(p.subcategoryIds ?? []);
      setMs(
        p.milestones.length
          ? p.milestones.map((m) => ({ title: m.title ?? '', description: m.description ?? '', acceptanceCriteria: m.acceptanceCriteria ?? '', amountAda: m.amountAda }))
          : [{ title: '', description: '', acceptanceCriteria: '', amountAda: p.requestedAmountAda }],
      );
      // Restore the fee tx hash saved with the draft (so it persists across edits).
      setFee(p.submissionFeeTxHash ?? '');
      // §3 — restore the pledge promise so it survives an edit.
      setPledgeEnabled((p.pledgeAmountAda ?? 0) > 0);
      setPledgeAmount(p.pledgeAmountAda ?? 0);
      setPledgeReturnMethod(p.pledgeReturnMethod ?? '');
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not load draft');
    }
  };

  // §3 — save privately as a DRAFT (no fee needed); submit it later. Reuses the row when editing.
  const saveDraft = async () => {
    setError(null);
    setMsg(null);
    if (!inputsOk()) return;
    setBusy(true);
    try {
      const d = editingId ? await proposalsApi.update(editingId, updatePayload()) : await proposalsApi.create(buildInput());
      setMsg(
        editingStatus && editingStatus !== 'DRAFT'
          ? `Saved your changes to "${d.title}".`
          : `Saved draft "${d.title}" — it stays private until you submit and a board member confirms your fee.`,
      );
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
    // A PENDING proposal is already submitted — Enter just saves the edits, never re-submits.
    if (editingStatus === 'PENDING') return saveDraft();
    setError(null);
    setMsg(null);
    if (!inputsOk()) return;
    if (feeRequired && !fee.trim()) {
      setError('Paste the submission-fee transaction hash to submit (or use Save Draft).');
      return;
    }
    setBusy(true);
    try {
      const draft = editingId ? await proposalsApi.update(editingId, updatePayload()) : await proposalsApi.create(buildInput());
      const submitted = await proposalsApi.submit(draft.id, fee.trim());
      setMsg(
        feeRequired
          ? `Submitted "${submitted.title}" — fee ${submitted.submissionFeeAda} ₳. A board member verifies your payment on-chain; it becomes public once confirmed.`
          : `Submitted "${submitted.title}" — no submission fee for this proposal type, so it's now live and public.`,
      );
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
    const detailId = openId;
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <ProposalDetail
          id={detailId}
          onBack={() => { setOpenId(null); loadMine(); }}
          onEditFull={() => { setOpenId(null); startEdit(detailId); }}
        />
      </section>
    );
  }

  // §12 — the fee for THIS proposal type comes from the round's settings (fall back to defaults).
  // If that fee is 0%, no payment is needed and the proposal goes live immediately on submit.
  const feePct = commercial
    ? roundSettings?.feeCommercialPct ?? ROUND_SETTING_DEFAULTS.feeCommercialPct
    : roundSettings?.feeOssPct ?? ROUND_SETTING_DEFAULTS.feeOssPct;
  const feeCap = commercial
    ? roundSettings?.feeCommercialCapAda ?? ROUND_SETTING_DEFAULTS.feeCommercialCapAda
    : roundSettings?.feeOssCapAda ?? ROUND_SETTING_DEFAULTS.feeOssCapAda;
  const feeRequired = feePct > 0;
  const feeEstimate = feeRequired ? Math.round(Math.min((amount * feePct) / 100, feeCap)) : 0;
  // §12 — once submitted (PENDING), the budget + commercial flag are locked (they set the fee);
  // a budget change then goes through the active proposal's "Request a budget change".
  const amountLocked = editingStatus === 'PENDING';

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Funding proposals</h3>
        <button
          onClick={() => { if (open) { setOpen(false); reset(); } else { reset(); setOpen(true); } }}
          className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {open ? 'Cancel' : '+ New proposal'}
        </button>
      </div>

      {msg ? <div className="mt-2 text-sm text-emerald-600">{msg}</div> : null}
      {open && editingId && editingStatus === 'REJECTED' ? (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
          <div className="text-sm font-bold uppercase tracking-wide text-red-700 dark:text-red-400">Rejected</div>
          <div className="text-xs text-red-800 dark:text-red-300">
            Fix the proposal — including the fee tx — then <strong>Re-submit</strong> to send it back for review.
          </div>
          {editingFeedback ? (
            <div className="mt-1 border-t border-red-200 pt-1 dark:border-red-900">
              <span className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-400">Feedback from the reviewer:</span>
              <div className="whitespace-pre-wrap text-xs text-red-800 dark:text-red-300">{editingFeedback}</div>
            </div>
          ) : null}
        </div>
      ) : open && editingId ? (
        <div className="mt-2 text-sm font-medium text-neutral-600 dark:text-neutral-400">
          {editingStatus === 'PENDING'
            ? 'Editing a submitted proposal (awaiting fee confirmation) — change any field, then Save changes.'
            : 'Editing your draft — save your changes below.'}
        </div>
      ) : null}

      {open && rounds.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          No round is currently open for submissions. Proposals can only be submitted while a board
          member has a round in the <strong>Submission</strong> stage.
        </p>
      ) : null}

      {open && rounds.length > 0 ? (
        <form onSubmit={submitNow} className="mt-3 space-y-2">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-0.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Round{editingId ? <span className="font-normal text-neutral-400"> (fixed once created)</span> : null}
              <select className={field} value={roundId} onChange={(e) => setRoundId(e.target.value)} required disabled={!!editingId}>
                <option value="">Select round…</option>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>#{r.number} {r.name ?? ''} ({r.status})</option>
                ))}
              </select>
            </label>
            {/* §5.2 — category picker appears only after a round is chosen (its categories are known then). */}
            {roundId ? (
              <label className="flex flex-col gap-0.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                Category
                <select className={field} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                  <option value="">Select category…</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Title</span>
            <input className={`${field} mt-0.5 w-full`} placeholder="Proposal title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          {/* Requested amount + commercial flag sit right under the title (they set the
              fee + cap the proposal's category fit) so the submitter sees the cost of
              the ask before writing the pitch. */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label>Requested ₳ <input type="number" className={`${field} w-32 disabled:opacity-60`} value={amount} onChange={(e) => setAmount(Number(e.target.value))} disabled={amountLocked} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} disabled={amountLocked} /> Commercial / for profit</label>
            {/* §12 — live submission-fee preview: updates as the user toggles commercial or
                changes the requested amount, so the fee is never a surprise at submit time. */}
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${feeRequired
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}
              title={feeRequired
                ? `${feePct}% of the requested amount (capped at ${feeCap.toLocaleString()} ₳).`
                : 'No fee for this proposal type — it goes live immediately on submit.'}
            >
              {feeRequired
                ? `Submission fee: ${feeEstimate.toLocaleString()} ₳ (${feePct}%${amount * feePct / 100 > feeCap ? ', capped' : ''})`
                : 'No submission fee'}
            </span>
          </div>
          {amountLocked ? (
            <div className="text-xs text-neutral-500">
              The requested amount + commercial flag are <strong>locked after submission</strong> (they set the fee). To change
              the budget, use <strong>Request a budget change</strong> on the proposal once it&apos;s active.
            </div>
          ) : null}
          <MarkdownEditor
            value={content}
            onChange={setContent}
            title="Pitch / summary"
            subtitle="What are you proposing to build, and why? Who is it for, what does it solve, and what makes it the right project at the right time?"
            placeholder="What you'll build and why (markdown)"
            minRows={5}
            required
          />
          {/* §3.4 — additional optional context, collapsed by default to keep the form short. */}
          <MarkdownEditor
            value={ecosystemImpact}
            onChange={setEcosystemImpact}
            title="Expected ecosystem impact"
            subtitle="What specific benefit will the project have for the ecosystem? Who will the result serve, what problem does it solve and why should it be funded from community funds?"
            placeholder="Who benefits, what changes — short-term and longer-term."
            minRows={3}
            defaultCollapsed={!ecosystemImpact.trim()}
          />
          <MarkdownEditor
            value={successMetrics}
            onChange={setSuccessMetrics}
            title="Success metrics / KPIs"
            subtitle="What measurable indicators will you use to evaluate the success of the project? Specify the target values, time frame and method of verification."
            placeholder="e.g. number of users, txs, integrations, on-chain volume — with targets where you can."
            minRows={3}
            defaultCollapsed={!successMetrics.trim()}
          />
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
            <div className="text-sm font-medium">Milestones (budgets must sum to requested)</div>
            <div className="mt-1 space-y-2">
              {ms.map((m, i) => {
                const set = (patch: Partial<ProposalMilestoneInput>) =>
                  setMs((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-500">Milestone {i + 1}</span>
                      {ms.length > 1 ? (
                        <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setMs((p) => p.filter((_, j) => j !== i))}>remove</button>
                      ) : null}
                    </div>
                    {/* 1. Title · 2. Requested budget (right below the title) · 3. Description · 4. Acceptance criteria */}
                    <div className="mt-1 flex flex-wrap items-end gap-2">
                      <label className="flex-1">
                        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Title</span>
                        <input className={`${field} mt-0.5 w-full`} placeholder="Milestone title" value={m.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
                      </label>
                      <label>
                        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Requested budget (₳)</span>
                        <input type="number" className={`${field} mt-0.5 w-32`} value={m.amountAda} onChange={(e) => set({ amountAda: Number(e.target.value) })} />
                      </label>
                    </div>
                    <div className="mt-2">
                      <MarkdownEditor value={m.description} onChange={(v) => set({ description: v })} title="Description" placeholder="What is delivered in this milestone" minRows={3} required />
                    </div>
                    <div className="mt-2">
                      <MarkdownEditor value={m.acceptanceCriteria ?? ''} onChange={(v) => set({ acceptanceCriteria: v })} title="Acceptance criteria" hint="how completion is judged" placeholder="How completion will be verified" minRows={3} defaultCollapsed={!(m.acceptanceCriteria ?? '').trim()} />
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" className="mt-1 text-xs underline" onClick={() => setMs((p) => [...p, { title: '', description: '', acceptanceCriteria: '', amountAda: 0 }])}>+ add milestone</button>
            {/* Live milestone-budget check — must equal the requested amount. */}
            <div className={`mt-1 text-xs ${milestonesMatch ? 'text-emerald-600' : 'font-medium text-red-600'}`}>
              {milestonesMatch
                ? `✓ Milestones sum to ${msSum.toLocaleString()} ₳ (matches requested).`
                : `⚠ Milestones sum to ${msSum.toLocaleString()} ₳ but the requested amount is ${Number(amount).toLocaleString()} ₳ — they must be equal (off by ${Math.abs(msSum - Number(amount)).toLocaleString()} ₳).`}
            </div>
          </div>
          {/* §3.4 — funding-specific detail (all optional, collapsed by default to keep the form short). */}
          <MarkdownEditor value={costBreakdown} onChange={setCostBreakdown} title="Cost breakdown" hint="optional — how the budget is spent" placeholder="How the budget is spent" minRows={3} defaultCollapsed={!costBreakdown.trim()} />
          <MarkdownEditor value={teamInfo} onChange={setTeamInfo} title="Team info" hint="optional — who is delivering this" placeholder="Who is delivering this, and why you're best suited" minRows={3} defaultCollapsed={!teamInfo.trim()} />
          <MarkdownEditor value={revenueSharing} onChange={setRevenueSharing} title="Revenue sharing" hint="optional — for commercial projects" placeholder="For commercial projects: how the DAO shares in returns" minRows={3} defaultCollapsed={!revenueSharing.trim()} />
          {/* §3 — optional refundable pledge. Only shown when the round's threshold > 0.
              Team opts in; amount must be ≥ threshold; return-method description is required.
              The actual on-chain payment happens later in FUNDING (after approval). */}
          {(roundSettings?.pledgeThresholdAda ?? ROUND_SETTING_DEFAULTS.pledgeThresholdAda) > 0 ? (
            <PledgeSection
              minAda={roundSettings?.pledgeThresholdAda ?? ROUND_SETTING_DEFAULTS.pledgeThresholdAda}
              enabled={pledgeEnabled}
              amount={pledgeAmount}
              returnMethod={pledgeReturnMethod}
              onEnabled={(v) => {
                setPledgeEnabled(v);
                if (v && !pledgeAmount) setPledgeAmount(roundSettings?.pledgeThresholdAda ?? ROUND_SETTING_DEFAULTS.pledgeThresholdAda);
              }}
              onAmount={setPledgeAmount}
              onReturnMethod={setPledgeReturnMethod}
            />
          ) : null}
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
          {/* Cardano address the submitter receives funds at — fee refunds + the budget payout if funded. */}
          <label className="block">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Payout / refund address (Cardano)</span>
            <input className={`${field} mt-0.5 w-full font-mono text-xs`} placeholder="addr_test1… — where the DAO sends refunds and the funded budget" value={payoutAddress} onChange={(e) => setPayoutAddress(e.target.value)} />
          </label>
          {/* §12/§16 — the fee + tx field appear only when the round charges a fee for this
              proposal type. When it's 0% (e.g. open-source), no payment is needed at all. */}
          {feeRequired ? (
            <>
              <div className="rounded border border-neutral-200 p-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                <div>
                  Submission fee: <strong>{feePct}% ({commercial ? 'commercial' : 'open-source'})</strong> of the requested
                  amount ≈ <strong>{feeEstimate.toLocaleString()} ₳</strong>. To <strong>submit</strong>, pay it to the
                  address below and paste the transaction hash; the platform verifies it on-chain and a board member confirms.
                </div>
                {cfg?.submissionFeeAddress ? (
                  <div className="mt-1 flex items-start gap-2">
                    <div className="flex-1 break-all font-mono text-[11px] text-neutral-500">{cfg.submissionFeeAddress}</div>
                    <CopyButton text={cfg.submissionFeeAddress} label="Copy address" />
                  </div>
                ) : null}
              </div>
              {/* TX hash input + Verify button. Cardano tx hashes are 32-byte
                  blake2b → 64 hex chars; we validate the format inline (whitespace
                  / wrong length / non-hex chars get a clear message) before the
                  button is enabled. Verify auto-saves the draft first if needed
                  (so the hash is persisted + added to the cumulative tally) and
                  re-fires automatically when the user pastes a fresh valid-looking
                  hash. The input locks once the on-chain total covers the fee. */}
              <FeeTxInput
                fee={fee}
                onChange={(v) => { setFee(v); setFeeVerification(null); }}
                locked={feeVerification?.fullyPaid === true}
                verifying={verifying}
                hasResult={feeVerification !== null}
                onVerify={async () => {
                  const trimmed = fee.trim();
                  if (!/^[0-9a-f]{64}$/i.test(trimmed)) return; // safety; button disabled anyway
                  setVerifying(true); setError(null);
                  try {
                    // Auto-save the draft if we don't have one yet — Verify is most
                    // useful BEFORE the team submits, so the cost of an extra
                    // create+update is fine for the UX win.
                    let id = editingId;
                    if (!id) {
                      if (!draftReady) {
                        setError('Fill in the proposal fields above first — the hash is recorded with the saved draft.');
                        return;
                      }
                      const created = await proposalsApi.create({ ...buildInput(), submissionFeeTxHash: trimmed });
                      id = created.id;
                      setEditingId(id);
                      setEditingStatus(created.status);
                    } else {
                      await proposalsApi.update(id, { submissionFeeTxHash: trimmed });
                    }
                    const v = await proposalsApi.verifyFee(id);
                    setFeeVerification(v);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'verification failed');
                  } finally {
                    setVerifying(false);
                  }
                }}
              />
              {feeVerification ? (
                <div
                  className={`rounded border p-2 text-xs ${
                    feeVerification.fullyPaid
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : !feeVerification.koiosAvailable
                        ? 'border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
                        : feeVerification.paidAda > 0
                          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                          : 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
                  }`}
                >
                  {feeVerification.fullyPaid ? (
                    <span>
                      <strong>✓ Fully paid</strong> — {feeVerification.paidAda.toLocaleString()} ₳ received at the fee address (required {feeVerification.requiredAda.toLocaleString()} ₳).
                      The TX hash field is locked. You can now submit.
                    </span>
                  ) : !feeVerification.koiosAvailable ? (
                    <span>
                      <strong>⚠ Couldn&apos;t reach the chain right now</strong> — Koios is throttling our requests. Your hash is saved; the platform will keep retrying every ~10 s and the answer will appear here as soon as it gets through. (This is an external service issue, not a problem with your tx.)
                    </span>
                  ) : feeVerification.paidAda > 0 ? (
                    <span>
                      <strong>Partial payment:</strong> {feeVerification.paidAda.toLocaleString()} ₳ received,{' '}
                      <strong>{feeVerification.missingAda.toLocaleString()} ₳ still missing</strong>{' '}
                      (required {feeVerification.requiredAda.toLocaleString()} ₳).
                      Send the rest in a new tx, paste the new hash here, and click Verify again — both txs will be counted.
                    </span>
                  ) : feeVerification.txs.every((t) => t.koiosAvailable && !t.found) ? (
                    <span>✗ The tx hash wasn&apos;t found on-chain yet. The platform re-checks every ~10 s — leave the form open and the answer will update as soon as the next block lands.</span>
                  ) : (
                    <span>✗ This tx didn&apos;t pay the fee address. Did you send to the right address?</span>
                  )}
                  {/* Per-tx breakdown when there are several. */}
                  {feeVerification.txs.length > 1 ? (
                    <ul className="mt-1 space-y-0.5 text-[11px]">
                      {feeVerification.txs.map((t) => (
                        <li key={t.hash} className="break-all">
                          <span className="font-mono">{t.hash.slice(0, 16)}…</span>{' '}
                          {!t.koiosAvailable ? '→ chain check failed' : t.paidAda > 0 ? `→ ${t.paidAda.toLocaleString()} ₳ paid` : t.found ? '→ 0 ₳ to the fee address' : '→ not found on-chain'}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
              No submission fee for {commercial ? 'commercial' : 'open-source'} proposals in this round — your proposal
              goes <strong>live immediately</strong> when you submit (no payment, no board fee confirmation).
            </div>
          )}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {/* What's still missing before this can be saved/submitted (so a disabled button is never a mystery). */}
          {!draftReady ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <div className="font-medium">Still needed before you can submit or save:</div>
              <ul className="mt-0.5 list-disc pl-4">
                {draftMissing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : feeRequired && !fee.trim() ? (
            <div className="text-xs text-neutral-500">
              Ready to save as a draft. To <strong>submit</strong>, also paste the submission-fee transaction hash above.
            </div>
          ) : null}
          {/* §3 — privacy + the two ways out of the form. */}
          <p className="text-xs text-neutral-500">
            <strong>Drafts are private</strong> — visible only to you, not to DReps or the board. A proposal becomes
            public only after you submit and a board member confirms the fee.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {editingStatus === 'PENDING' ? (
              // Already submitted — only save the edits (re-submitting isn't meaningful).
              <button type="button" onClick={saveDraft} disabled={busy || !draftReady} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy ? 'Working…' : 'Save changes'}
              </button>
            ) : (
              <>
                <button type="submit" disabled={busy || !draftReady || (feeRequired && !fee.trim())} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busy ? 'Working…' : editingStatus === 'REJECTED' ? 'Re-submit' : feeRequired ? 'Submit' : 'Submit (no fee)'}
                </button>
                <button type="button" onClick={saveDraft} disabled={busy || !draftReady} className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
                  {editingStatus === 'REJECTED' ? 'Save changes' : 'Save Draft'}
                </button>
              </>
            )}
          </div>
        </form>
      ) : null}

      {mine.length > 0 ? (
        <div className="mt-3">
          <div className="text-sm font-medium">My proposals</div>
          <p className="text-xs text-neutral-500">Drafts are private. Open one to read/edit it; submit a draft when you&apos;re ready (pay the fee + paste the tx).</p>
          <ul className="mt-1 space-y-1 text-sm">
            {/* Hide the proposal currently open in the editor above (avoids a confusing duplicate). */}
            {mine.filter((p) => p.id !== editingId).map((p) => (
              <MineRow key={p.id} p={p} feeAddress={cfg?.submissionFeeAddress ?? undefined} onOpen={() => setOpenId(p.id)} onEdit={() => startEdit(p.id)} onSubmitted={loadMine} />
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
  onEdit,
  onSubmitted,
}: {
  p: ProposalSummary;
  feeAddress?: string;
  onOpen: () => void;
  onEdit: () => void;
  onSubmitted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [fee, setFee] = useState(p.submissionFeeTxHash ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  const isDraft = p.status === 'DRAFT';
  const feeRejected = p.status === 'REJECTED' && !p.stage;
  // Pre-public (DRAFT/PENDING/fee-rejected) → edit ALL fields in the full form.
  const fullFormEdit = isDraft || p.status === 'PENDING' || feeRejected;
  // Public/under-review (Filtering / Debate & Vote) → revise content in the detail editor.
  const detailEdit = !fullFormEdit && (p.stage === 'FILTERING' || p.stage === 'DEBATE_VOTE');

  const submit = async () => {
    setError(null);
    // No client-side fee check: the backend requires a tx only when this proposal's fee > 0
    // (a 0% / open-source proposal submits with no tx and goes live immediately).
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
          <span className={`text-xs ${p.status === 'REJECTED' ? 'font-medium text-red-600' : isDraft ? 'text-amber-600' : 'text-neutral-500'}`}>
            {p.status}{p.stage ? ` · ${p.stage}` : ''}{isDraft ? ' · private' : ''}
          </span>
          {fullFormEdit ? (
            <>
              <button onClick={onEdit} className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800">
                Edit
              </button>
              {isDraft ? (
                <button onClick={() => setSubmitting((v) => !v)} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950">
                  {submitting ? 'Close' : 'Submit'}
                </button>
              ) : null}
            </>
          ) : detailEdit ? (
            <button onClick={onOpen} className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800">
              Edit
            </button>
          ) : null}
        </span>
      </div>
      {isDraft && submitting ? (
        <div className="space-y-1 border-t border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
          <div className="text-neutral-500">
            Pay the submission fee on-chain, then paste the tx hash. The platform verifies it and a board member confirms.
          </div>
          {feeAddress ? (
            <div className="flex items-start gap-2">
              <div className="flex-1 break-all font-mono text-[11px] text-neutral-500">{feeAddress}</div>
              <CopyButton text={feeAddress} label="Copy address" />
            </div>
          ) : null}
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

/**
 * §3 — optional pledge UI: checkbox + amount + collapsible return-method markdown.
 * Off by default; only rendered when the round's `pledgeThresholdAda > 0`. When the
 * checkbox is on, the amount input is shown (with the round minimum as placeholder)
 * and a MarkdownEditor for "how will the pledge be returned" (per-milestone /
 * after final milestone / etc.) — collapsible to match the rest of the form.
 */
function PledgeSection({
  minAda,
  enabled,
  amount,
  returnMethod,
  onEnabled,
  onAmount,
  onReturnMethod,
}: {
  minAda: number;
  enabled: boolean;
  amount: number;
  returnMethod: string;
  onEnabled: (v: boolean) => void;
  onAmount: (v: number) => void;
  onReturnMethod: (v: string) => void;
}) {
  const field = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  return (
    <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
        <span className="font-medium">Skin in the game (refundable pledge — optional)</span>
        <span className="text-xs text-neutral-500">— minimum {minAda.toLocaleString()} ₳ (round setting)</span>
      </label>
      {enabled ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              Pledge ₳
              <input
                type="number"
                className={`${field} w-32`}
                min={minAda}
                value={amount || ''}
                placeholder={String(minAda)}
                onChange={(e) => onAmount(Number(e.target.value))}
              />
            </label>
            {amount > 0 && amount < minAda ? (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                Below round minimum ({minAda.toLocaleString()} ₳)
              </span>
            ) : amount >= minAda ? (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                Meets minimum
              </span>
            ) : null}
          </div>
          <MarkdownEditor
            value={returnMethod}
            onChange={onReturnMethod}
            title="Pledge return method"
            subtitle="How and when will the pledge be returned? Common patterns: a slice with each milestone, or the full amount only after the final milestone. The team may propose another scheme — describe it here."
            placeholder="Example: 25% returned after milestone 1, 25% after milestone 2, the rest after the final milestone."
            minRows={3}
            defaultCollapsed={!returnMethod.trim()}
            required
          />
          <div className="text-[11px] text-neutral-500">
            You commit here. The pledge is paid on-chain <strong>after</strong> the proposal is approved (FUNDING stage): the platform shows the pledge address + you paste the tx hash, a board member confirms it. While unpaid/unconfirmed the proposal stays <strong>PENDING</strong> and milestone POAs are blocked.
          </div>
        </div>
      ) : (
        <div className="mt-1 text-xs text-neutral-500">
          No pledge by default. If you opt in, you commit here and pay on-chain later in the FUNDING stage.
        </div>
      )}
    </div>
  );
}

/**
 * §12 — submission-fee tx-hash input with inline format validation + auto-verify.
 *
 * A Cardano tx hash is the 32-byte blake2b digest of the tx body, i.e. exactly
 * 64 hex characters. We surface the format issue inline so the user doesn't
 * click Verify and wait for a roundtrip just to learn they pasted whitespace:
 *   - empty            → neutral helper "paste your fee-payment tx hash"
 *   - whitespace       → "remove the leading/trailing whitespace"
 *   - wrong length     → "X chars (need 64)"
 *   - non-hex chars    → "contains non-hex characters"
 *   - 64 hex chars     → "✓ looks like a valid tx hash" + Verify enabled
 *
 * Once the format is valid AND the user pauses typing for ~700 ms, the
 * on-chain check fires automatically (the user said "even if user does not
 * click the button explicitly, the on-chain check could be automatic").
 * Clicking Verify still works to retry immediately.
 */
function FeeTxInput({
  fee,
  onChange,
  locked,
  verifying,
  hasResult,
  onVerify,
}: {
  fee: string;
  onChange: (v: string) => void;
  locked: boolean;
  verifying: boolean;
  /** True when feeVerification is set for the current hash — used to skip the
   *  first-paste 700 ms auto-verify and switch to the 10 s polling cadence. */
  hasResult: boolean;
  onVerify: () => Promise<void> | void;
}) {
  const fld = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  const trimmed = fee.trim();
  const validFormat = /^[0-9a-f]{64}$/i.test(trimmed);
  let hint: { text: string; tone: 'neutral' | 'red' | 'emerald' } | null = null;
  if (locked) {
    hint = { text: '✓ fully paid — locked', tone: 'emerald' };
  } else if (verifying) {
    hint = { text: 'verifying on-chain…', tone: 'neutral' };
  } else if (fee.length === 0) {
    hint = { text: 'Paste your fee-payment tx hash (64 hex characters).', tone: 'neutral' };
  } else if (fee !== trimmed) {
    hint = { text: 'Remove the leading/trailing whitespace.', tone: 'red' };
  } else if (/\s/.test(fee)) {
    hint = { text: 'Tx hashes don\'t contain spaces — paste a single hex string.', tone: 'red' };
  } else if (!/^[0-9a-fA-F]*$/.test(fee)) {
    hint = { text: 'Contains non-hex characters — a tx hash is hex only (0-9, a-f).', tone: 'red' };
  } else if (fee.length !== 64) {
    hint = { text: `${fee.length} characters (need 64). Did the paste cut something off?`, tone: 'red' };
  } else if (validFormat) {
    hint = { text: '✓ looks like a valid tx hash — checking on-chain…', tone: 'emerald' };
  }

  // Auto-verify cadence:
  //   - first time the hash becomes a valid 64-hex string AND we have no result
  //     yet → fire after ~700 ms (debounced; cancels on every keystroke so
  //     rapid typing doesn't queue extra calls).
  //   - once a result is in but the tx wasn't found yet (or Koios was
  //     unavailable) → re-check every 10 s. The user said ~block time, and
  //     Preprod/Mainnet block intervals are ~20 s so 10 s is one re-try per
  //     block on average.
  //   - stop when locked (fully paid).
  // The previous version re-fired on every state change because `verifying`
  // flipping false re-triggered the effect → infinite loop / "blinking".
  useEffect(() => {
    if (!validFormat || verifying || locked) return;
    const delay = hasResult ? 10_000 : 700;
    const t = setTimeout(() => { void onVerify(); }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, validFormat, verifying, locked, hasResult]);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-stretch gap-2">
        <input
          className={`${fld} flex-1 disabled:bg-emerald-50 disabled:text-emerald-700 dark:disabled:bg-emerald-950/30 dark:disabled:text-emerald-300`}
          placeholder="Submission fee TX hash (64 hex chars — paste, the platform verifies it on-chain)"
          value={fee}
          onChange={(e) => onChange(e.target.value)}
          disabled={locked}
        />
        <button
          type="button"
          disabled={verifying || locked || !validFormat}
          onClick={() => { void onVerify(); }}
          className="rounded-md border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
          title={
            locked ? 'Already fully paid — the field is locked.'
              : validFormat ? 'Re-check on-chain now (auto-fires shortly after paste).'
              : 'A Cardano tx hash is 64 hex characters — fix the format first.'
          }
        >
          {verifying ? 'Verifying…' : 'Verify on-chain'}
        </button>
      </div>
      {hint ? (
        <div className={`text-[11px] ${
          hint.tone === 'red'
            ? 'text-red-600 dark:text-red-400'
            : hint.tone === 'emerald'
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-neutral-500'
        }`}>
          {hint.text}
        </div>
      ) : null}
    </div>
  );
}
