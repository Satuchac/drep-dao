'use client';

import { useEffect, useState } from 'react';
import { submitterApi, type MySubmitter } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { COUNTRIES } from '@/lib/countries';
import { ConfirmDialog } from './confirm-dialog';

const MIN_WORDS = 100;
const MAX_LOGO_BYTES = 256 * 1024;
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const inputCls = 'w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §2.1 — apply for the submitter role. The board approves/rejects; only then can you submit. */
export function SubmitterApplyForm({ onChange }: { onChange?: () => void }) {
  const { profile } = useAuth();
  // §2.1 — never ask for a name the platform knows: members reuse the profile display name.
  const knownName = profile?.user.displayName?.trim() || '';
  const isMember = !!profile && (profile.roles.includes('DAO_MEMBER') || profile.roles.includes('BOARD') || profile.roles.includes('DREP'));
  const [mine, setMine] = useState<MySubmitter | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [githubs, setGithubs] = useState<string[]>([]);
  const [socials, setSocials] = useState<string[]>([]);
  // §2.1 — disclosure + contact.
  const [conflict, setConflict] = useState('');
  const [noSelfVote, setNoSelfVote] = useState(false);
  const [telegram, setTelegram] = useState('');
  const [prevFunding, setPrevFunding] = useState('');
  const [email, setEmail] = useState('');
  const [logo, setLogo] = useState('');
  const [country, setCountry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §2.1 — persistence consent (required to apply) + leave flow.
  const [agreePersist, setAgreePersist] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const load = () =>
    submitterApi.mine().then((m) => {
      setMine(m); setLoaded(true);
      if (m) {
        setName(m.displayName); setDesc(m.description); setGithubs(m.githubUrls ?? []);
        setSocials(m.socialLinks ?? []); setLogo(m.logoDataUrl ?? ''); setCountry(m.country);
        setConflict(m.conflictOfInterest ?? ''); setNoSelfVote(!!m.noSelfVotePledge);
        setTelegram(m.telegram ?? ''); setEmail(m.email ?? '');
        setPrevFunding(m.previousFunding ?? '');
      }
    }).catch(() => setLoaded(true));
  useEffect(() => { load(); }, []);

  const onFile = (file: File) => {
    if (file.size > MAX_LOGO_BYTES) { setError(`Image is ${(file.size / 1024).toFixed(0)} KB — keep it under 256 KB.`); return; }
    const reader = new FileReader();
    reader.onerror = () => setError('Could not read the image.');
    reader.onload = () => { if (typeof reader.result === 'string') { setLogo(reader.result); setError(null); } };
    reader.readAsDataURL(file);
  };

  const words = wordCount(desc);
  // §2.1 — the 100-word minimum gates a NEW application the board reviews; an already-approved
  // member can update their profile with any non-empty description.
  const needsFullDesc = mine?.status !== 'APPROVED';
  const effectiveName = knownName || name.trim();
  const memberNeedsProfileName = isMember && !knownName; // §2.1 — set the profile name first
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const needsConsent = mine?.status !== 'APPROVED';
  const canSubmit = !memberNeedsProfileName && !!effectiveName && !!country && !!desc.trim() && !!conflict.trim() && !!telegram.trim() && emailOk && (!needsConsent || agreePersist) && (!needsFullDesc || words >= MIN_WORDS);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) { setError(needsFullDesc ? 'Fill the required fields — the description needs at least 100 words.' : 'Fill the required fields.'); return; }
    setBusy(true);
    try {
      await submitterApi.apply({
        displayName: effectiveName,
        description: desc.trim(),
        githubUrls: githubs.map((s) => s.trim()).filter(Boolean),
        socialLinks: socials.map((s) => s.trim()).filter(Boolean),
        conflictOfInterest: conflict.trim(),
        noSelfVotePledge: noSelfVote,
        telegram: telegram.trim(),
        email: email.trim(),
        previousFunding: prevFunding.trim(),
        logoDataUrl: logo || undefined,
        country,
        agreePersist,
      });
      await load();
      onChange?.();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'failed'); } finally { setBusy(false); }
  };

  if (!loaded) return null;
  const approved = mine?.status === 'APPROVED';

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">{mine ? 'Submitter profile' : 'Become a submitter'}</h3>
        {approved ? (
          <p className="text-sm text-emerald-600">You are an approved submitter ✅ — submit proposals under <strong>My proposals</strong>. You can still update your profile below.</p>
        ) : mine?.status === 'PENDING' ? (
          <p className="text-sm text-amber-600">Your application is under board review. You can update it below.</p>
        ) : mine?.status === 'LEFT' ? (
          <p className="text-sm text-neutral-500">You left the platform{mine.leftAt ? ` on ${new Date(mine.leftAt).toLocaleDateString()}` : ''} — your profile is kept in the history. You can re-apply below.</p>
        ) : mine?.status === 'REJECTED' ? (
          <div className="rounded border border-red-200 bg-red-50 p-2 text-sm dark:border-red-900 dark:bg-red-950/30">
            <div className="font-medium text-red-800 dark:text-red-200">Application rejected</div>
            {mine.rejectionReason ? <div className="mt-1 whitespace-pre-wrap text-red-700 dark:text-red-300">{mine.rejectionReason}</div> : null}
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">Edit the form below and re-apply.</div>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Apply for the submitter role. Once a board member approves, you can submit proposals.</p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-3">
        {knownName ? (
          // §2.1 — the platform already knows this user's name; no duplicate input.
          <div className="text-sm">
            <span className="font-medium">Display name</span>
            <div className="mt-1 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
              {knownName} <span className="text-xs text-neutral-400">— from your profile</span>
            </div>
          </div>
        ) : memberNeedsProfileName ? (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            ⚠ Set your <strong>display name</strong> in your DRep profile (above on this page) first — the
            submitter role reuses it. The form unlocks once it&apos;s saved.
          </div>
        ) : (
          <label className="block">
            <span className="text-sm font-medium">Display name <span className="text-red-500">*</span></span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={`mt-1 ${inputCls}`} placeholder="Your name or project name" />
          </label>
        )}

        <label className="block">
          <span className="text-sm font-medium">Description <span className="text-red-500">*</span> <span className="text-xs font-normal text-neutral-500">{needsFullDesc ? `(min 100 words — ${words}/100)` : `(${words} words)`}</span></span>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={5} maxLength={20000} className={`mt-1 ${inputCls}`} placeholder="Who you are, what you build, your track record…" />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Country <span className="text-red-500">*</span></span>
          <select value={country} onChange={(e) => setCountry(e.target.value)} className={`mt-1 ${inputCls}`}>
            <option value="">— select a country —</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <div>
          <span className="text-sm font-medium">GitHub links <span className="text-xs font-normal text-neutral-500">(optional)</span></span>
          <div className="mt-1 space-y-1">
            {githubs.map((g, i) => (
              <div key={i} className="flex gap-2">
                <input value={g} onChange={(e) => setGithubs((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))} maxLength={500} className={inputCls} placeholder="https://github.com/…" />
                <button type="button" onClick={() => setGithubs((arr) => arr.filter((_, idx) => idx !== i))} className="rounded border border-neutral-300 px-2 text-sm dark:border-neutral-700">✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setGithubs((arr) => [...arr, ''])} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">
              + Add {githubs.length === 0 ? 'a GitHub link' : 'another link'}
            </button>
          </div>
        </div>

        {/* §2.1 — disclosure + contact (board may need to reach the team). */}
        <label className="block">
          <span className="text-sm font-medium">Conflict of interest <span className="text-red-500">*</span></span>
          <p className="text-xs text-neutral-500">Disclose everything related to a conflict of interest around approving funding (write &quot;none&quot; if you have none).</p>
          <textarea value={conflict} onChange={(e) => setConflict(e.target.value)} rows={3} maxLength={20000} className={`mt-1 ${inputCls}`} placeholder="e.g. I am affiliated with project X which competes for the same category…" />
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={noSelfVote} onChange={(e) => setNoSelfVote(e.target.checked)} className="mt-0.5" />
          <span>I will not vote for my own proposal <span className="text-xs text-neutral-500">(informative — optional)</span></span>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Previous funding <span className="text-xs font-normal text-neutral-500">(optional — please keep it updated)</span></span>
          <p className="text-xs text-neutral-500">List ALL previous funding you received in the Cardano ecosystem — Catalyst, Treasury Withdrawals, Builder DAO, or other funding vehicles. Update this regularly as you receive new funding.</p>
          <textarea value={prevFunding} onChange={(e) => setPrevFunding(e.target.value)} rows={3} maxLength={20000} className={`mt-1 ${inputCls}`} placeholder="e.g. Catalyst F11 — Project X, 50k ₳ (2024); Builder DAO grant — 10k ₳ (2025)…" />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Telegram <span className="text-red-500">*</span></span>
            <input value={telegram} onChange={(e) => setTelegram(e.target.value)} maxLength={200} className={`mt-1 ${inputCls}`} placeholder="@handle" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Email <span className="text-red-500">*</span></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} className={`mt-1 ${inputCls}`} placeholder="team@example.org" />
          </label>
        </div>

        <div>
          <span className="text-sm font-medium">Social links <span className="text-xs font-normal text-neutral-500">(optional)</span></span>
          <div className="mt-1 space-y-1">
            {socials.map((s, i) => (
              <div key={i} className="flex gap-2">
                <input value={s} onChange={(e) => setSocials((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))} maxLength={500} className={inputCls} placeholder="https://…" />
                <button type="button" onClick={() => setSocials((arr) => arr.filter((_, idx) => idx !== i))} className="rounded border border-neutral-300 px-2 text-sm dark:border-neutral-700">✕</button>
              </div>
            ))}
            {/* Show "add" once there's a first link (or to add the first). After the first, more can be added. */}
            <button type="button" onClick={() => setSocials((arr) => [...arr, ''])} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">
              + Add {socials.length === 0 ? 'a social link' : 'another link'}
            </button>
          </div>
        </div>

        <div>
          <span className="text-sm font-medium">Photo / project logo <span className="text-xs font-normal text-neutral-500">(optional, ≤256 KB)</span></span>
          <div className="mt-1 flex items-center gap-3">
            {logo ? <img src={logo} alt="logo" className="h-12 w-12 rounded object-cover" /> : null}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} className="text-xs" />
            {logo ? <button type="button" onClick={() => setLogo('')} className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">Remove</button> : null}
          </div>
        </div>

        {error ? <div className="text-xs text-red-600">{error}</div> : null}
        {!canSubmit ? <div className="text-xs text-amber-600">{memberNeedsProfileName ? 'Profile display name is required. ' : !effectiveName ? 'Display name is required. ' : ''}{!country ? 'Country is required. ' : ''}{!conflict.trim() ? 'Conflict-of-interest disclosure is required. ' : ''}{!telegram.trim() ? 'Telegram is required. ' : ''}{!emailOk ? 'A valid email is required. ' : ''}{needsConsent && !agreePersist ? 'You must agree to profile persistence. ' : ''}{!desc.trim() ? 'Description is required. ' : needsFullDesc && words < MIN_WORDS ? `Description needs at least ${MIN_WORDS} words (${words}/${MIN_WORDS}).` : ''}</div> : null}
        {needsConsent ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agreePersist} onChange={(e) => setAgreePersist(e.target.checked)} className="mt-0.5" />
            <span>I agree that the profile will be persisted by the platform <span className="text-red-500">*</span> <span className="text-xs text-neutral-500">(it stays in the history even after leaving)</span></span>
          </label>
        ) : null}
        <button type="submit" disabled={busy} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Submitting…' : mine && mine.status !== 'REJECTED' ? 'Update application' : mine?.status === 'REJECTED' ? 'Re-apply' : 'Apply'}
        </button>
      </form>

      {approved ? (
        <div className="rounded border border-red-200 p-3 dark:border-red-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-neutral-500">Deregister as a submitter. Your profile stays in the platform&apos;s history.</p>
            <button onClick={() => { setLeaveError(null); setConfirmLeave(true); }} className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
              Leave DAO
            </button>
          </div>
          {leaveError ? <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">⚠ {leaveError}</div> : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmLeave}
        title="Leave as a submitter?"
        message="You will lose the submitter role and won't be able to submit proposals. Your profile is kept in the platform's history (visible under Submitters → show deleted accounts). You can re-apply later. Are you sure?"
        confirmLabel="Leave DAO"
        cancelLabel="Stay"
        tone="danger"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          void submitterApi.leave()
            .then(async () => { await load(); onChange?.(); })
            .catch((e) => setLeaveError(e instanceof Error ? e.message : 'failed'));
        }}
      />

      {mine && mine.history.length > 0 ? (
        <details className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
          <summary className="cursor-pointer text-neutral-500">Change history ({mine.history.length})</summary>
          <ul className="mt-2 space-y-2">
            {mine.history.map((h, i) => (
              <li key={i} className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
                <div className="text-neutral-400">Replaced {new Date(h.snapshotAt).toLocaleString()}</div>
                <div className="mt-1 flex items-center gap-2">
                  {h.logoDataUrl ? <img src={h.logoDataUrl} alt="" className="h-6 w-6 rounded object-cover" /> : null}
                  <span className="font-medium">{h.displayName}</span> · {h.country}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">{h.description}</div>
                {h.conflictOfInterest ? <div className="mt-1"><span className="font-medium">Conflict of interest:</span> <span className="whitespace-pre-wrap">{h.conflictOfInterest}</span></div> : null}
                <div className="mt-1 text-neutral-500">
                  {h.noSelfVotePledge ? '✓ no-self-vote pledge' : 'no self-vote pledge'}
                  {h.telegram ? <> · Telegram: <span className="font-mono">{h.telegram}</span></> : null}
                  {h.email ? <> · Email: {h.email}</> : null}
                </div>
                {(h.githubUrls?.length || h.socialLinks?.length) ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {[...(h.githubUrls ?? []), ...(h.socialLinks ?? [])].map((l, j) => <span key={j} className="break-all text-neutral-500">{l}</span>)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
