'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  internalProposalsApi,
  daoApi,
  configApi,
  type InternalProposalSummary,
  type InternalProposalDetail,
  type CreateInternalInput,
  type DaoMember,
  type PublicConfig,
} from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { StatusBadge, PROPOSAL_STATUS_CLS, fmtDateTime, toLocalInput } from './round-ui';
import { Markdown, MarkdownEditor } from './markdown';

const card = 'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';
const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

const TYPE_LABEL: Record<string, string> = {
  INSTRUCTIVE: 'Instructive (names actors to act)',
  INFORMATIVE: 'Informative (yes / no decision)',
  POLL: 'Poll (choose option(s))',
};
const SCOPE_LABEL: Record<string, string> = {
  DREPS_ONLY: 'Non-board DReps only',
  BOARD_ONLY: 'Board members only',
  BOTH: 'All DReps (board + others)',
};
const VTYPE_LABEL: Record<string, string> = {
  ONE_PERSON_ONE_VOTE: '1 member = 1 vote',
  BALANCED: 'Adjusted voting power',
};

/** §10 — Internal proposals: a unified queue, a submit form, and per-proposal voting. */
export function InternalProposals() {
  const [items, setItems] = useState<InternalProposalSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    internalProposalsApi.list().then(setItems).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  if (openId) {
    return <InternalDetail id={openId} onBack={() => { setOpenId(null); load(); }} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Internal proposals</h2>
          <p className="text-sm text-neutral-500">DAO-governance decisions — process changes, parameter changes, board changes, polls. Not tied to a round; voting opens immediately.</p>
        </div>
        <button onClick={() => setCreating((v) => !v)} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          {creating ? 'Close' : 'New internal proposal'}
        </button>
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      {creating ? (
        <section className={card}>
          <SubmitInternalForm onDone={() => { setCreating(false); load(); }} />
        </section>
      ) : null}

      {items === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500">No internal proposals yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id}>
              <button onClick={() => setOpenId(p.id)} className={`${card} block w-full text-left hover:border-emerald-400`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {p.publicId ? <span className="mr-2 font-mono text-xs text-neutral-500">{p.publicId}</span> : null}
                    {p.title}
                    {p.isPrivate ? <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">PRIVATE · board</span> : null}
                  </span>
                  <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} />
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {TYPE_LABEL[p.internalType] ?? p.internalType} · {SCOPE_LABEL[p.votersScope] ?? p.votersScope} · {VTYPE_LABEL[p.votingType] ?? p.votingType}
                  {p.tally.kind === 'THRESHOLD' ? ` · threshold ${p.thresholdPct ?? '?'}%` : ''}
                  {p.submitter ? ` · by ${p.submitter}` : ''}
                  {p.status === 'ACTIVE' && p.votingEndAt ? ` · ends ${fmtDateTime(p.votingEndAt)}` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubmitInternalForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [internalType, setInternalType] = useState('INFORMATIVE');
  const [votersScope, setVotersScope] = useState('BOTH');
  const [thresholdKind, setThresholdKind] = useState('DEFAULT');
  const [votingType, setVotingType] = useState('BALANCED');
  const [votingEnd, setVotingEnd] = useState(() => toLocalInput(new Date(Date.now() + 7 * 86400_000).toISOString()));
  const [isPrivate, setIsPrivate] = useState(false);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [actors, setActors] = useState<string[]>([]); // selected DRep display names
  const [deliveryDate, setDeliveryDate] = useState('');
  const [members, setMembers] = useState<DaoMember[]>([]);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    daoApi.members().then(setMembers).catch(() => setMembers([]));
    configApi.get().then(setCfg).catch(() => setCfg(null));
  }, []);

  const isPoll = internalType === 'POLL';
  const isInstructive = internalType === 'INSTRUCTIVE';
  const days = Math.max(0, Math.ceil((new Date(votingEnd).getTime() - Date.now()) / 86400_000));
  const dThresh = cfg?.internalThresholds.default;
  const iThresh = cfg?.internalThresholds.important;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const end = new Date(votingEnd);
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) { setError('Pick a voting-end date in the future.'); return; }
    const cleanOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (isPoll && cleanOptions.length < 2) { setError('A poll needs at least two options.'); return; }
    const input: CreateInternalInput = {
      title: title.trim(),
      contentMd: content,
      internalType,
      votersScope: isPrivate ? 'BOARD_ONLY' : votersScope,
      thresholdKind,
      votingType,
      votingEndAt: end.toISOString(),
      isPrivate,
      ...(isPoll ? { pollOptions: cleanOptions, pollMultiple } : {}),
      ...(isInstructive && actors.length ? { actors } : {}),
      ...(isInstructive && deliveryDate ? { deliveryDate: new Date(deliveryDate).toISOString() } : {}),
    };
    setBusy(true);
    try {
      await internalProposalsApi.submit(input);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h3 className="text-base font-semibold">New internal proposal</h3>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Title</span>
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>

      {/* Content is always present, even for polls. */}
      <MarkdownEditor value={content} onChange={setContent} title="Content" placeholder="Describe the proposal (markdown)" minRows={5} required />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Type</span>
          <select className={field} value={internalType} onChange={(e) => setInternalType(e.target.value)}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Voting ends</span>
          <input type="datetime-local" className={field} value={votingEnd} min={toLocalInput(new Date().toISOString())} onChange={(e) => setVotingEnd(e.target.value)} required />
          <span className="text-xs text-neutral-500">{days > 0 ? `voting will run ${days} day${days === 1 ? '' : 's'} from now` : 'pick a future date'}</span>
        </label>
      </div>

      {isPoll ? (
        <div className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="text-sm font-medium">Poll options</div>
          {pollOptions.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={field} value={o} placeholder={`Option ${i + 1}`} onChange={(e) => setPollOptions((opts) => opts.map((x, j) => (j === i ? e.target.value : x)))} />
              {pollOptions.length > 2 ? (
                <button type="button" onClick={() => setPollOptions((opts) => opts.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">remove</button>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={() => setPollOptions((opts) => [...opts, ''])} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">+ add option</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pollMultiple} onChange={(e) => setPollMultiple(e.target.checked)} />
            Allow voters to choose more than one option
          </label>
        </div>
      ) : null}

      {isInstructive ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-sm font-medium">Actors <span className="font-normal text-neutral-400">(optional — who must act if approved)</span></span>
            {/* Pick the DReps expected to act from the DAO member list. */}
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
              {members.length === 0 ? (
                <span className="text-xs text-neutral-400">No DAO members to choose from.</span>
              ) : (
                members.map((m) => (
                  <label key={m.drepId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={actors.includes(m.displayName)}
                      onChange={() => setActors((s) => (s.includes(m.displayName) ? s.filter((x) => x !== m.displayName) : [...s, m.displayName]))}
                    />
                    {m.displayName}{m.isBoard ? <span className="text-[10px] text-neutral-400"> (board)</span> : null}
                  </label>
                ))
              )}
            </div>
            {actors.length ? <span className="text-xs text-neutral-500">{actors.join(', ')}</span> : null}
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Delivery date <span className="font-normal text-neutral-400">(optional)</span></span>
            <input type="date" className={field} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </label>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Who can vote</span>
          <select className={field} value={isPrivate ? 'BOARD_ONLY' : votersScope} disabled={isPrivate} onChange={(e) => setVotersScope(e.target.value)}>
            {Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Voting type</span>
          <select className={field} value={votingType} onChange={(e) => setVotingType(e.target.value)}>
            {Object.entries(VTYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Threshold</span>
          <select className={field} value={thresholdKind} onChange={(e) => setThresholdKind(e.target.value)}>
            <option value="DEFAULT">Default{dThresh != null ? ` (${dThresh}%)` : ''}</option>
            <option value="IMPORTANT">Important{iThresh != null ? ` (${iThresh}%)` : ''}</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        Private — visible &amp; votable to board members only
      </label>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <button type="submit" disabled={busy || !title.trim() || !content.trim()} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
        {busy ? 'Submitting…' : 'Submit (opens voting now)'}
      </button>
    </form>
  );
}

function InternalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { txUrl } = useExplorer();
  const [p, setP] = useState<InternalProposalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rationale, setRationale] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [newEnd, setNewEnd] = useState('');

  const load = useCallback(() => {
    internalProposalsApi.get(id).then((d) => { setP(d); setPicked(d.myVotes); }).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <div className="space-y-3"><BackBtn onBack={onBack} /><div className="text-sm text-red-600">{error}</div></div>;
  if (!p) return <div className="space-y-3"><BackBtn onBack={onBack} /><p className="text-sm text-neutral-500">Loading…</p></div>;

  const isPoll = p.internalType === 'POLL';
  const act = async (fn: () => Promise<unknown>) => {
    setError(null); setBusy(true);
    try { await fn(); load(); } catch (e) { setError(e instanceof Error ? e.message : 'failed'); } finally { setBusy(false); }
  };
  const voteThreshold = (choice: 'YES' | 'NO' | 'ABSTAIN') => act(() => internalProposalsApi.vote(id, { choice, rationale: rationale.trim() || undefined }));
  const votePoll = () => {
    if (picked.length === 0) { setError('Select at least one option.'); return; }
    act(() => internalProposalsApi.vote(id, { options: picked, rationale: rationale.trim() || undefined }));
  };
  const togglePick = (o: string) => {
    if (p.poll?.multiple) setPicked((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
    else setPicked([o]);
  };

  return (
    <div className="space-y-4">
      <BackBtn onBack={onBack} />
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {p.title}
            {p.submitter ? <span className="ml-2 text-sm font-normal text-neutral-500">by {p.submitter}</span> : null}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            {p.publicId ? <span>ID: <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{p.publicId}</span></span> : null}
            {p.isPrivate ? <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">PRIVATE · board</span> : null}
            <span className="flex items-center gap-1">Status: <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} /></span>
          </div>
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          {TYPE_LABEL[p.internalType] ?? p.internalType} · {SCOPE_LABEL[p.votersScope] ?? p.votersScope} · {VTYPE_LABEL[p.votingType] ?? p.votingType}
          {p.tally.kind === 'THRESHOLD' ? ` · threshold ${p.thresholdPct ?? '?'}%` : ''}
          {' · '}{p.status === 'ACTIVE' ? `voting ends ${fmtDateTime(p.votingEndAt)}` : `voting ${fmtDateTime(p.votingStartAt)} → ${fmtDateTime(p.votingEndAt)}`}
        </div>

        <div className="mt-3">
          <Markdown className="text-sm text-neutral-700 dark:text-neutral-300">{p.contentMd}</Markdown>
        </div>

        {p.internalType === 'INSTRUCTIVE' && (p.actors?.length || p.deliveryDate) ? (
          <div className="mt-3 rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
            {p.actors?.length ? <div><span className="font-medium">Actors:</span> {p.actors.join(', ')}</div> : null}
            {p.deliveryDate ? <div><span className="font-medium">Delivery date:</span> {fmtDateTime(p.deliveryDate)}</div> : null}
          </div>
        ) : null}
      </div>

      {/* Tally */}
      <div className={card}>
        <h3 className="text-base font-semibold">Result</h3>
        {p.tally.kind === 'THRESHOLD' ? (
          <div className="mt-1 space-y-1 text-sm">
            <div className="text-neutral-600 dark:text-neutral-300">
              YES {p.tally.yesPower} / {p.tally.denominator} ({p.tally.ratioPct}%) · threshold {p.tally.thresholdPct}% ·{' '}
              <span className={p.tally.approved ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>{p.tally.approved ? 'passing' : 'not passing'}</span>
            </div>
            <div className="text-xs text-neutral-500">{p.tally.cast} of {p.tally.eligible} eligible voted · abstain {p.tally.abstainPower} · total power {p.tally.totalPower}</div>
            {/* §4.4 — YES/NO/abstain over the full eligible voting power (0 → max), with the threshold marker. */}
            <ThresholdBar
              yes={p.tally.yesPower}
              abstain={p.tally.abstainPower}
              total={p.tally.totalPower}
              denominator={p.tally.denominator}
              thresholdPct={p.tally.thresholdPct}
            />
          </div>
        ) : (
          <div className="mt-1 space-y-1 text-sm">
            <div className="text-xs text-neutral-500">{p.tally.voted} of {p.tally.eligible} eligible voted{p.poll?.multiple ? ' · multiple choice' : ' · single choice'}</div>
            <ul className="space-y-1">
              {p.tally.options.map((o) => {
                const max = Math.max(1, ...(p.tally.kind === 'POLL' ? p.tally.options.map((x) => x.power) : [1]));
                const pct = Math.round((o.power / max) * 100);
                return (
                  <li key={o.option} className="text-sm">
                    <div className="flex justify-between"><span>{o.option}</span><span className="text-neutral-500">{o.voters} vote(s){p.votingType === 'BALANCED' ? ` · ${o.power} power` : ''}</span></div>
                    <div className="h-1.5 w-full rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {p.anchorTxHash ? (
          <div className="mt-2 text-xs"><a href={txUrl(p.anchorTxHash)} target="_blank" rel="noreferrer" className="text-emerald-700 underline dark:text-emerald-400">on-chain record ↗</a></div>
        ) : p.status !== 'ACTIVE' && p.anchorHash ? (
          <div className="mt-2 text-xs text-neutral-400">on-chain anchor recorded (pending submission)</div>
        ) : null}
      </div>

      {/* Voting */}
      {p.status === 'ACTIVE' && p.canVote ? (
        <div className={card}>
          <h3 className="text-base font-semibold">Cast your vote</h3>
          <p className="text-xs text-neutral-500">You can change your vote until voting ends.</p>
          {isPoll ? (
            <div className="mt-2 space-y-1.5">
              {p.poll?.options.map((o) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input type={p.poll?.multiple ? 'checkbox' : 'radio'} name="pollopt" checked={picked.includes(o)} onChange={() => togglePick(o)} />
                  {o}
                </label>
              ))}
            </div>
          ) : null}
          <div className="mt-2">
            <MarkdownEditor value={rationale} onChange={setRationale} title="Rationale" hint="optional — Markdown supported" placeholder="Why you voted this way (optional)" minRows={3} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {isPoll ? (
              <button disabled={busy} onClick={votePoll} className="rounded border border-emerald-500 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950">Submit vote</button>
            ) : (
              <>
                <button disabled={busy} onClick={() => voteThreshold('YES')} className={`rounded border px-3 py-1 text-sm disabled:opacity-40 ${p.myVotes.includes('YES') ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950'}`}>{p.myVotes.includes('YES') ? '✓ YES' : 'YES'}</button>
                <button disabled={busy} onClick={() => voteThreshold('NO')} className={`rounded border px-3 py-1 text-sm disabled:opacity-40 ${p.myVotes.includes('NO') ? 'border-red-400 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'border-red-400 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950'}`}>{p.myVotes.includes('NO') ? '✓ NO' : 'NO'}</button>
                <button disabled={busy} onClick={() => voteThreshold('ABSTAIN')} className={`rounded border px-3 py-1 text-sm disabled:opacity-40 ${p.myVotes.includes('ABSTAIN') ? 'border-neutral-400 bg-neutral-100 dark:bg-neutral-800' : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}>{p.myVotes.includes('ABSTAIN') ? '✓ Abstain' : 'Abstain'}</button>
              </>
            )}
          </div>
        </div>
      ) : p.status === 'ACTIVE' ? (
        <div className={card}><p className="text-sm text-neutral-500">You are not eligible to vote on this proposal ({SCOPE_LABEL[p.votersScope] ?? p.votersScope}).</p></div>
      ) : null}

      {/* Submitter: move the voting end (content stays frozen). */}
      {p.isMine && p.status === 'ACTIVE' ? (
        <div className={card}>
          <h3 className="text-base font-semibold">Manage voting period</h3>
          <p className="text-xs text-neutral-500">You can move the end of voting (you can&apos;t edit the content while voting is open).</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input type="datetime-local" className={`${field} sm:w-auto`} value={newEnd || toLocalInput(p.votingEndAt)} onChange={(e) => setNewEnd(e.target.value)} />
            <button disabled={busy} onClick={() => act(() => internalProposalsApi.extend(id, new Date(newEnd || toLocalInput(p.votingEndAt)).toISOString()))} className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800">Update end</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BackBtn({ onBack }: { onBack: () => void }) {
  return <button onClick={onBack} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">← back to internal proposals</button>;
}

/**
 * §4.4 result bar: YES / NO / abstain over the **full eligible voting power** (0 → total), with a
 * marker at the approval threshold (placed on the total-power scale, allowing for abstains).
 */
function ThresholdBar({ yes, abstain, total, denominator, thresholdPct }: { yes: number; abstain: number; total: number; denominator: number; thresholdPct: number }) {
  const no = Math.max(0, total - yes - abstain); // explicit + implicit NO
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  // Threshold is a % of the denominator (total − abstain); place it on the 0→total scale.
  const tpos = total > 0 ? Math.min(100, Math.max(0, (((thresholdPct / 100) * denominator) / total) * 100)) : 0;
  return (
    <div className="mt-5">
      <div className="relative h-5 w-full rounded bg-neutral-200 dark:bg-neutral-800">
        <div className="absolute inset-0 overflow-hidden rounded">
          <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${pct(yes)}%` }} />
          <div className="absolute inset-y-0 bg-red-400" style={{ left: `${pct(yes)}%`, width: `${pct(no)}%` }} />
          <div className="absolute inset-y-0 bg-neutral-400" style={{ left: `${pct(yes + no)}%`, width: `${pct(abstain)}%` }} />
        </div>
        <div className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-neutral-700 dark:text-neutral-300" style={{ left: `${tpos}%` }}>
          threshold {thresholdPct}%
        </div>
        <div className="absolute -top-1.5 bottom-0 w-0.5 bg-neutral-900 dark:bg-white" style={{ left: `${tpos}%` }} title={`threshold ${thresholdPct}%`} />
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />YES {fmt(yes)}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-400" />NO {fmt(no)}</span>
        {abstain > 0 ? <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-neutral-400" />abstain {fmt(abstain)}</span> : null}
        <span className="tabular-nums">max power {fmt(total)}</span>
      </div>
    </div>
  );
}
