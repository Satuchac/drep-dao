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
import { useAuth } from '@/lib/auth-context';
import { useExplorer } from '@/lib/explorer';
import { useUrlNav } from '@/lib/use-url-nav';
import { StatusBadge, PROPOSAL_STATUS_CLS, fmtDateTime, toLocalInput, DateField } from './round-ui';
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
  const [creating, setCreating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // §14 — sub-menu splits the regular DAO-governance proposals from board-member elections.
  const [subTab, setSubTab] = useState<'regular' | 'election'>('regular');
  const [error, setError] = useState<string | null>(null);
  // The opened proposal lives in the URL (?ip=<id>) so clicking the My-area "Internal proposals"
  // tab button (which clears `ip`) takes the user back to the list.
  const { get, setParams } = useUrlNav();
  const openId = get('ip');

  const load = useCallback(() => {
    internalProposalsApi.list().then(setItems).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  if (openId) {
    return <InternalDetail id={openId} onBack={() => { setParams({ ip: null }); load(); }} />;
  }

  const all = items ?? [];
  // Sub-tab filter (regular vs election), then the optional history filter.
  const inTab = all.filter((p) => (subTab === 'election' ? p.isBoardElection : !p.isBoardElection));
  const visible = inTab.filter((p) => showHistory || p.status === 'ACTIVE');
  const isElection = subTab === 'election';

  const subTabBtn = (key: 'regular' | 'election', label: string) => (
    <button
      onClick={() => { setSubTab(key); setCreating(false); }}
      className={`rounded-md px-3 py-1.5 text-sm ${subTab === key ? 'bg-emerald-600 font-medium text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* §14 — sub-menu inside the Internal proposals view. */}
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        {subTabBtn('regular', 'Internal proposals')}
        {subTabBtn('election', 'Board member election')}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{isElection ? 'Board member election' : 'Internal proposals'}</h2>
          <p className="text-sm text-neutral-500">
            {isElection
              ? '§14 — propose a new 5-member board. Approval + the installation date trigger the platform to replace the board automatically.'
              : 'DAO-governance decisions — process changes, parameter changes, polls. Not tied to a round; voting opens immediately.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
            Show history
          </label>
          <button onClick={() => setCreating((v) => !v)} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            {creating ? 'Close' : isElection ? 'New election' : 'New internal proposal'}
          </button>
        </div>
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      {creating ? (
        <section className={card}>
          <SubmitInternalForm election={isElection} onDone={() => { setCreating(false); load(); }} />
        </section>
      ) : null}

      {items === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-neutral-500">{showHistory
          ? (isElection ? 'No board-member elections yet.' : 'No internal proposals yet.')
          : (isElection ? 'No active elections — toggle "Show history" to see decided ones.' : 'No active internal proposals — toggle "Show history" to see decided ones.')}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((p) => (
            <li key={p.id}>
              <button onClick={() => setParams({ ip: p.id })} className={`${card} block w-full text-left hover:border-emerald-400`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {p.publicId ? <span className="mr-2 font-mono text-xs text-neutral-500">{p.publicId}</span> : null}
                    {p.title}
                    {p.isPrivate ? <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">PRIVATE · board</span> : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <MyVoteBadge p={p} />
                    <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} />
                  </div>
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

/** Right-side chip on each list row: how the current DRep voted (if at all). */
function MyVoteBadge({ p }: { p: InternalProposalSummary }) {
  if (!p.myVotes || p.myVotes.length === 0) return null;
  const label = formatMyVote(p);
  return (
    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
      ✓ {label}
    </span>
  );
}

function formatMyVote(p: { internalType: string; myVotes: string[] }): string {
  const v = p.myVotes;
  if (v.length === 1 && v[0] === 'ABSTAIN') return 'you abstained';
  if (p.internalType === 'POLL') return `you chose ${v.join(', ')}`;
  return `you voted ${v[0] === 'ABSTAIN' ? 'Abstain' : v[0]}`;
}

function SubmitInternalForm({ onDone, election = false }: { onDone: () => void; election?: boolean }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [internalType, setInternalType] = useState('INFORMATIVE');
  const [votersScope, setVotersScope] = useState('BOTH');
  const [thresholdKind, setThresholdKind] = useState('DEFAULT');
  const [votingType, setVotingType] = useState('BALANCED');
  const [votingEnd, setVotingEnd] = useState(() => {
    // Default to 7 days from now at midnight (local), so users only have to pick a date.
    const d = new Date(Date.now() + 7 * 86400_000);
    d.setHours(0, 0, 0, 0);
    return toLocalInput(d.toISOString());
  });
  const [isPrivate, setIsPrivate] = useState(false);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [actors, setActors] = useState<string[]>([]); // selected DRep display names
  const [candidates, setCandidates] = useState<string[]>([]); // §14 election: 5 DRep UUIDs
  const [installDate, setInstallDate] = useState(''); // §14 election: datetime-local
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

    if (election) {
      if (candidates.length !== 5) { setError('Pick exactly 5 candidates.'); return; }
      const install = new Date(installDate);
      if (Number.isNaN(install.getTime()) || install.getTime() <= end.getTime()) {
        setError('The installation date must be later than the voting end.'); return;
      }
      const input: CreateInternalInput = {
        title: title.trim(),
        contentMd: content,
        internalType: 'INSTRUCTIVE',
        // Server forces these for elections — pass safe defaults anyway.
        votersScope: 'BOTH',
        thresholdKind: 'IMPORTANT',
        votingType: 'BALANCED',
        votingEndAt: end.toISOString(),
        isBoardElection: true,
        candidates,
        deliveryDate: install.toISOString(),
      };
      setBusy(true);
      try { await internalProposalsApi.submit(input); onDone(); }
      catch (err) { setError(err instanceof Error ? err.message : 'failed'); }
      finally { setBusy(false); }
      return;
    }

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
      <h3 className="text-base font-semibold">{election ? 'New board-member election' : 'New internal proposal'}</h3>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Title</span>
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>

      {/* Content is always present, even for polls. */}
      <MarkdownEditor value={content} onChange={setContent} title="Content" placeholder="Describe the proposal (markdown)" minRows={5} required />

      <div className="grid gap-3 sm:grid-cols-2">
        {election ? (
          // §14 — for an election the type is fixed (an INSTRUCTIVE proposal); show it as info.
          <div className="space-y-1">
            <span className="text-sm font-medium">Type</span>
            <div className={`${field} bg-neutral-50 text-neutral-600 dark:bg-neutral-950 dark:text-neutral-400`}>Instructive — board-member election</div>
          </div>
        ) : (
          <label className="block space-y-1">
            <span className="text-sm font-medium">Type</span>
            <select className={field} value={internalType} onChange={(e) => setInternalType(e.target.value)}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium">Voting ends</span>
          <DateField value={votingEnd} onChange={setVotingEnd} min={toLocalInput(new Date().toISOString())} required />
          <span className="text-xs text-neutral-500">{days > 0 ? `voting will run ${days} day${days === 1 ? '' : 's'} from now` : 'pick a future date'}</span>
        </label>
      </div>

      {!election && isPoll ? (
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

      {!election && isInstructive ? (
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
            <DateField value={deliveryDate} onChange={setDeliveryDate} type="date" />
          </label>
        </div>
      ) : null}

      {election ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-sm font-medium">Candidates (pick exactly 5 DReps)</span>
            {/* §14 — the 5 candidates who will become the new board on approval + installation date. */}
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
              {members.length === 0 ? (
                <span className="text-xs text-neutral-400">No DAO members to choose from.</span>
              ) : (
                members.map((m) => {
                  const picked = candidates.includes(m.drepId);
                  return (
                    <label key={m.drepId} className={`flex items-center gap-2 text-sm ${!picked && candidates.length >= 5 ? 'opacity-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={picked}
                        disabled={!picked && candidates.length >= 5}
                        onChange={() => setCandidates((s) => (s.includes(m.drepId) ? s.filter((x) => x !== m.drepId) : [...s, m.drepId]))}
                      />
                      {m.displayName}{m.isBoard ? <span className="text-[10px] text-neutral-400"> (board)</span> : null}
                    </label>
                  );
                })
              )}
            </div>
            <span className={`text-xs ${candidates.length === 5 ? 'text-emerald-600' : 'text-neutral-500'}`}>
              {candidates.length} / 5 selected
            </span>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Installation date <span className="font-normal text-neutral-400">(when the new board takes seats — must be after voting ends)</span></span>
            <DateField value={installDate} onChange={setInstallDate} min={votingEnd || toLocalInput(new Date().toISOString())} required />
            {installDate && votingEnd && new Date(installDate).getTime() <= new Date(votingEnd).getTime() ? (
              <span className="text-xs text-red-600">⚠ the installation date must be later than the voting end ({fmtDateTime(votingEnd)})</span>
            ) : null}
          </label>
        </div>
      ) : null}

      {election ? (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
          Election defaults are fixed:
          <ul className="mt-1 list-disc pl-5">
            <li><span className="font-medium">Who can vote:</span> all DReps (board + others)</li>
            <li><span className="font-medium">Voting type:</span> adjusted voting power</li>
            <li><span className="font-medium">Threshold:</span> IMPORTANT{iThresh != null ? ` (${iThresh}%)` : ''}</li>
            <li><span className="font-medium">Visibility:</span> public</li>
            <li>When approved + the installation date hits, the platform replaces the board with the 5 elected candidates automatically. Any current board member can also install them earlier from the proposal page.</li>
          </ul>
        </div>
      ) : null}

      {!election ? (
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
      ) : null}

      {!election ? (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        Private — visible &amp; votable to board members only
      </label>
      ) : null}

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {(() => {
        // Tell the user exactly what's still missing — and disable the button until it's fixed.
        const missing: string[] = [];
        if (!title.trim()) missing.push('title');
        if (!content.trim()) missing.push('content');
        const endMs = new Date(votingEnd).getTime();
        if (!votingEnd || Number.isNaN(endMs) || endMs <= Date.now()) missing.push('voting end must be in the future');
        if (election) {
          if (candidates.length !== 5) missing.push(`pick exactly 5 candidates (${candidates.length} so far)`);
          if (!installDate) missing.push('installation date');
          else if (!Number.isNaN(new Date(installDate).getTime()) && !Number.isNaN(endMs) && new Date(installDate).getTime() <= endMs) {
            missing.push('installation date must be later than the voting end');
          }
        } else if (isPoll) {
          const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
          if (opts.length < 2) missing.push('at least two poll options');
        }
        const ready = missing.length === 0;
        return (
          <div className="space-y-1">
            {!ready ? (
              <div className="text-xs text-neutral-500">
                Still needed before submit: <span className="text-amber-600">{missing.join(' · ')}</span>
              </div>
            ) : null}
            <button
              type="submit"
              disabled={busy || !ready}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Submitting…' : 'Submit (opens voting now)'}
            </button>
          </div>
        );
      })()}
    </form>
  );
}

function InternalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
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
    if (picked.length === 0) { setError('Select an option or Abstain.'); return; }
    // Abstain on a poll is its own choice — sent as { choice: 'ABSTAIN' }, never mixed with options.
    if (picked.length === 1 && picked[0] === 'ABSTAIN') {
      return act(() => internalProposalsApi.vote(id, { choice: 'ABSTAIN', rationale: rationale.trim() || undefined }));
    }
    act(() => internalProposalsApi.vote(id, { options: picked, rationale: rationale.trim() || undefined }));
  };
  const togglePick = (o: string) => {
    // Abstain is exclusive — picking it clears options; picking an option clears Abstain.
    if (o === 'ABSTAIN') return setPicked(['ABSTAIN']);
    const withoutAbstain = (s: string[]) => s.filter((x) => x !== 'ABSTAIN');
    if (p.poll?.multiple) setPicked((s) => withoutAbstain(s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
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

        {p.isBoardElection ? (
          <div className="mt-3 space-y-1 rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
            <div><span className="font-medium">Candidates (5):</span> {p.candidates?.map((c) => c.displayName).join(', ') ?? '—'}</div>
            <div><span className="font-medium">Installation date:</span> {fmtDateTime(p.deliveryDate)}</div>
            {p.boardInstalledAt ? (
              <div className="text-emerald-700 dark:text-emerald-400">✓ Board installed {fmtDateTime(p.boardInstalledAt)}</div>
            ) : null}
          </div>
        ) : p.internalType === 'INSTRUCTIVE' && (p.actors?.length || p.deliveryDate) ? (
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
            <div className="text-xs text-neutral-500">
              {p.tally.voted} of {p.tally.eligible} eligible voted{p.poll?.multiple ? ' · multiple choice' : ' · single choice'}
              {p.tally.abstain.voters > 0 ? ` · ${p.tally.abstain.voters} abstain` : ''}
            </div>
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

      {/* Per-voter breakdown — who voted how + their rationale. */}
      {p.voters.length > 0 ? (
        <div className={card}>
          <h3 className="text-base font-semibold">Votes ({p.voters.length})</h3>
          <ul className="mt-2 space-y-2">
            {p.voters.map((v, i) => (
              <li key={`${v.drep}-${i}`} className="rounded-md border border-neutral-200 p-2 text-sm dark:border-neutral-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{v.displayName ?? '(unknown)'}</span>
                    <span className="ml-2 break-all font-mono text-[10px] text-neutral-400">{v.drep}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {p.votingType === 'BALANCED' ? <span className="text-[11px] text-neutral-500">{v.weight} power</span> : null}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      v.choice === 'YES'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : v.choice === 'NO'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                          : v.choice === 'ABSTAIN'
                            ? 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                            : 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                    }`}>{v.choice}</span>
                  </span>
                </div>
                {v.rationale ? (
                  <div className="mt-1 whitespace-pre-wrap text-xs text-neutral-600 dark:text-neutral-400">{v.rationale}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* §14 — election install: board members can trigger early; otherwise the platform auto-installs at the installation date. */}
      {p.isBoardElection && p.status === 'APPROVED' && !p.boardInstalledAt ? (
        <div className={card}>
          <h3 className="text-base font-semibold">New board ready to install</h3>
          <p className="text-xs text-neutral-500">
            Installation date: {fmtDateTime(p.deliveryDate)}. The platform will install the new board automatically when that date arrives.
            {isBoard ? ' As a current board member, you can install them earlier:' : ''}
          </p>
          {isBoard ? (
            <button
              disabled={busy}
              onClick={() => act(() => internalProposalsApi.installBoard(id))}
              className="mt-2 rounded-md border border-emerald-500 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              {busy ? 'Installing…' : 'Install new board members now'}
            </button>
          ) : null}
        </div>
      ) : null}

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
              {/* §10 — voters may also abstain on a poll (exclusive with the options). */}
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="pollopt" checked={picked.length === 1 && picked[0] === 'ABSTAIN'} onChange={() => togglePick('ABSTAIN')} />
                <span className="text-neutral-500">Abstain</span>
              </label>
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
            <DateField value={newEnd || toLocalInput(p.votingEndAt)} onChange={setNewEnd} />
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
