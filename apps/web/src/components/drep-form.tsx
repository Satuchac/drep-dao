'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import { useAuth } from '@/lib/auth-context';
import { drepApi, type DrepApplicationInput } from '@/lib/api';

const field =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/**
 * §14.3 DRep form. `join` = a registered DRep requesting DAO membership (board
 * then votes 3-of-5). `profile` = an existing DAO member editing their details.
 */
export function DrepForm({ mode }: { mode: 'join' | 'profile' }) {
  const { profile, refresh } = useAuth();
  const drepId = profile?.onchainDrep.drepId ?? null;

  const [displayName, setDisplayName] = useState(profile?.user.displayName ?? '');
  const [bio, setBio] = useState('');
  const [x, setX] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [github, setGithub] = useState('');
  const [telegram, setTelegram] = useState('');
  const [email, setEmail] = useState('');
  const [subs, setSubs] = useState<string[]>([]);
  const [kyc, setKyc] = useState(false);
  const [calls, setCalls] = useState(false);
  const [admissionCall, setAdmissionCall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Prefill from the existing profile (both modes — a re-applying DRep keeps prior data).
  useEffect(() => {
    void drepApi.mine().then((d) => {
      if (!d) return;
      setBio(d.bio ?? '');
      setSubs(d.subcategoryIds ?? []);
      const s = d.socials ?? {};
      setX(s.x ?? '');
      setLinkedin(s.linkedin ?? '');
      setGithub(s.github ?? '');
      const c = d.contact ?? {};
      setTelegram(c.telegram ?? '');
      setEmail(c.email ?? '');
      setKyc(d.kycOptin);
      setCalls(d.callsOptin);
      setAdmissionCall(d.admissionCallOptin);
    });
  }, []);

  const toggleSub = (id: string) =>
    setSubs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    const input: DrepApplicationInput = {
      displayName: displayName.trim() || undefined,
      bio: bio.trim() || undefined,
      subcategoryIds: subs,
      socials: {
        ...(x.trim() ? { x: x.trim() } : {}),
        ...(linkedin.trim() ? { linkedin: linkedin.trim() } : {}),
        ...(github.trim() ? { github: github.trim() } : {}),
      },
      contact: {
        ...(telegram.trim() ? { telegram: telegram.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      },
      kycOptin: kyc,
      callsOptin: calls,
      admissionCallOptin: admissionCall,
    };
    try {
      if (mode === 'join') await drepApi.apply(input);
      else await drepApi.update(input);
      setSaved(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="block space-y-1">
        <span className="text-sm font-medium">Your DRep ID (verified on-chain)</span>
        <div className="break-all rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
          {drepId ?? '—'}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Display name</span>
        <input className={field} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Motivation / experience</span>
        <textarea className={field} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>

      <div className="space-y-1">
        <span className="text-sm font-medium">Expertise (subcategories)</span>
        <div className="flex flex-wrap gap-1.5">
          {DEFAULT_SUBCATEGORIES.map((sc) => (
            <button
              type="button"
              key={sc.id}
              onClick={() => toggleSub(sc.id)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                subs.includes(sc.id)
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-neutral-300 dark:border-neutral-700'
              }`}
            >
              {sc.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">X / Twitter</span>
          <input className={field} value={x} onChange={(e) => setX(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">LinkedIn</span>
          <input className={field} value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">GitHub</span>
          <input className={field} value={github} onChange={(e) => setGithub(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Telegram</span>
          <input className={field} value={telegram} onChange={(e) => setTelegram(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Email</span>
          <input className={field} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>

      <div className="space-y-1.5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={kyc} onChange={(e) => setKyc(e.target.checked)} /> KYC opt-in
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={calls} onChange={(e) => setCalls(e.target.checked)} /> Calls opt-in
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={admissionCall} onChange={(e) => setAdmissionCall(e.target.checked)} />{' '}
          Admission-call opt-in
        </label>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {saved ? (
        <div className="text-sm text-emerald-600">
          {mode === 'join' ? 'Request submitted — awaiting board review.' : 'Profile saved.'}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy || !drepId}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? 'Saving…' : mode === 'join' ? 'Submit request to join' : 'Save profile'}
      </button>
    </form>
  );
}
