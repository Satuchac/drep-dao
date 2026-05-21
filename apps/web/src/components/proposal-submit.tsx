'use client';

import { useEffect, useState } from 'react';
import {
  proposalsApi,
  roundsApi,
  type ProposalMilestoneInput,
  type ProposalSummary,
  type RoundSummary,
} from '@/lib/api';

export function ProposalSubmit() {
  const [open, setOpen] = useState(false);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [mine, setMine] = useState<ProposalSummary[]>([]);
  const [roundId, setRoundId] = useState('');
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [amount, setAmount] = useState(50000);
  const [commercial, setCommercial] = useState(false);
  const [ms, setMs] = useState<ProposalMilestoneInput[]>([{ description: '', amountAda: 50000 }]);
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadMine = () => proposalsApi.mine().then(setMine).catch(() => undefined);
  useEffect(() => {
    roundsApi.list().then((r) => setRounds(r.filter((x) => x.status !== 'CLOSED'))).catch(() => undefined);
    loadMine();
  }, []);

  useEffect(() => {
    if (!roundId) return;
    roundsApi.get(roundId).then((r) => {
      setCats(r.categories.map((c) => ({ id: c.id, name: c.name })));
      setCategoryId(r.categories[0]?.id ?? '');
    });
  }, [roundId]);

  const field = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const sum = ms.reduce((a, m) => a + Number(m.amountAda), 0);
    if (sum !== Number(amount)) {
      setError(`milestones (${sum}) must sum to requested amount (${amount})`);
      return;
    }
    setBusy(true);
    try {
      const draft = await proposalsApi.create({
        roundId,
        categoryId,
        title: title.trim(),
        contentMd: content,
        isCommercial: commercial,
        requestedAmountAda: Number(amount),
        milestones: ms.map((m) => ({ description: m.description, amountAda: Number(m.amountAda) })),
      });
      const submitted = await proposalsApi.submit(draft.id, fee.trim() || 'pending-fee-tx');
      setMsg(`Submitted "${submitted.title}" — fee ${submitted.submissionFeeAda} ₳, status ${submitted.status}.`);
      setOpen(false);
      loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submission failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Funding proposals</h3>
        <button onClick={() => setOpen((v) => !v)} className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
          {open ? 'Cancel' : '+ Submit proposal'}
        </button>
      </div>

      {msg ? <div className="mt-2 text-sm text-emerald-600">{msg}</div> : null}

      {open ? (
        <form onSubmit={submit} className="mt-3 space-y-2">
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
          <input className={`${field} w-full`} placeholder="Submission fee TX hash (optional in dev)" value={fee} onChange={(e) => setFee(e.target.value)} />
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <button type="submit" disabled={busy || !roundId} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Submitting…' : 'Submit (creates draft + submits)'}
          </button>
        </form>
      ) : null}

      {mine.length > 0 ? (
        <div className="mt-3">
          <div className="text-sm font-medium">My proposals</div>
          <ul className="mt-1 space-y-1 text-sm">
            {mine.map((p) => (
              <li key={p.id} className="flex justify-between rounded border border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
                <span>{p.title} <span className="text-neutral-500">· {p.requestedAmountAda.toLocaleString()} ₳</span></span>
                <span className="text-xs text-neutral-500">{p.status}{p.stage ? ` · ${p.stage}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
