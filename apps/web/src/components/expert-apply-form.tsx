'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import { expertApi, type MyExpert } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { MarkdownEditor } from './markdown';
import { PhotoUpload } from './photo-upload';
import { ConfirmDialog } from './confirm-dialog';

const field =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §2 — a non-DRep ADA holder applies to be an Expert (advises in Filtering, advises in
 *  Debate & Vote, and reviews milestones); board approves. Approved experts can edit. */
export function ExpertApplyForm({ onChange }: { onChange?: () => void } = {}) {
  const { refresh } = useAuth();
  const [mine, setMine] = useState<MyExpert | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [motivation, setMotivation] = useState('');
  const [conflict, setConflict] = useState('');
  const [email, setEmail] = useState('');
  const [telegram, setTelegram] = useState('');
  const [socials, setSocials] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [subs, setSubs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = () =>
    expertApi.mine().then((e) => {
      setMine(e);
      if (e) {
        setName(e.displayName);
        setBio(e.bio ?? '');
        setMotivation(e.motivation ?? '');
        setConflict(e.conflictOfInterest ?? '');
        setEmail(e.email ?? '');
        setTelegram(e.telegram ?? '');
        setSocials(e.socialLinks ?? []);
        setPhoto(e.logoDataUrl ?? null);
        setSubs(e.subcategoryIds ?? []);
      }
    });
  useEffect(() => {
    void load();
  }, []);

  const toggleSub = (id: string) =>
    setSubs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // §2 — mandatory: display name, experience, conflict-of-interest, email, telegram.
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canSubmit = !!name.trim() && !!bio.trim() && !!conflict.trim() && emailOk && !!telegram.trim() && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(null);
    const wasExisting = !!mine;
    setBusy(true);
    try {
      await expertApi.apply({
        displayName: name.trim(),
        bio: bio.trim() || undefined,
        motivation: motivation.trim() || undefined,
        conflictOfInterest: conflict.trim() || undefined,
        email: email.trim() || undefined,
        telegram: telegram.trim() || undefined,
        socialLinks: socials.map((s) => s.trim()).filter(Boolean),
        logoDataUrl: photo || undefined,
        subcategoryIds: subs,
      });
      const wasApproved = mine?.approvedByBoard;
      await load();
      onChange?.();
      setSaved(wasApproved ? 'Profile updated.' : wasExisting ? 'Application updated — sent to the board for review.' : 'Application sent to the board for review.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const approved = !!mine?.approvedByBoard;

  return (
    <form onSubmit={submit} className="space-y-3">
      <h3 className="text-base font-semibold">{approved ? 'Expert profile' : 'Apply to be an Expert'}</h3>
      {approved ? (
        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          You are an approved Expert ✅ — you can keep your profile up to date below (it stays approved).
        </div>
      ) : null}
      <p className="text-sm text-neutral-500">
        Experts are non-DRep ADA holders approved by the board to advise on proposals — they can give
        feedback in the Filtering stage, advise in the Debate &amp; Vote stage, and review milestone
        deliveries.
        {mine && !approved ? ' Your application is under board review — you can update it below.' : ''}
      </p>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Display name <span className="text-red-500">*</span></span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <PhotoUpload
        photo={photo}
        onChange={(next, err) => { setPhoto(next); setPhotoError(err ?? null); }}
        error={photoError}
        hint="PNG, JPEG, WebP or GIF · max 256 KB · shown in the experts list (a generated avatar is used if you don't add one)"
      />
      <MarkdownEditor
        value={bio}
        onChange={setBio}
        title="Experience / skills"
        subtitle="Your background and relevant expertise. Supports bold, italics, headers, lists."
        placeholder="Your experience reviewing / building in these areas…"
        minRows={5}
        required
      />
      <MarkdownEditor
        value={motivation}
        onChange={setMotivation}
        title="Motivation / area of help"
        subtitle="Why you want to be an expert and where you'd like to help — e.g. giving feedback in the Filtering stage, advising in the Debate & Vote stage, and/or reviewing milestone deliveries. Supports bold, italics, headers, lists."
        placeholder="e.g. I'd like to help in Filtering and milestone reviews for Tooling / Infrastructure proposals…"
        minRows={4}
      />
      <MarkdownEditor
        value={conflict}
        onChange={setConflict}
        title="Conflict of interest"
        subtitle={'Disclose anything that could bias your milestone reviews or feedback (write "none" if you have none). Supports bold, italics, headers, lists.'}
        placeholder="e.g. I advise project X which submits in the Tooling category…"
        minRows={3}
        required
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Email <span className="text-red-500">*</span></span>
          <input type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Telegram handle <span className="text-red-500">*</span></span>
          <input className={field} value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="@yourhandle" />
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-sm font-medium">Social media links <span className="text-xs font-normal text-neutral-500">(optional)</span></span>
        <div className="space-y-1">
          {socials.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input value={s} onChange={(e) => setSocials((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))} maxLength={500} className={field} placeholder="https://x.com/… , https://linkedin.com/in/…" />
              <button type="button" onClick={() => setSocials((arr) => arr.filter((_, idx) => idx !== i))} className="rounded border border-neutral-300 px-2 text-sm dark:border-neutral-700">✕</button>
            </div>
          ))}
          <button type="button" onClick={() => setSocials((arr) => [...arr, ''])} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">
            + Add {socials.length === 0 ? 'a social link' : 'another link'}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <span className="text-sm font-medium">Expertise</span>
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
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {!canSubmit && !busy ? (
        <div className="text-xs text-amber-600">
          {!name.trim() ? 'Display name is required. ' : ''}
          {!bio.trim() ? 'Experience / skills is required. ' : ''}
          {!conflict.trim() ? 'Conflict-of-interest disclosure is required. ' : ''}
          {!emailOk ? 'A valid email is required. ' : ''}
          {!telegram.trim() ? 'A Telegram handle is required. ' : ''}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Submitting…' : approved ? 'Save profile' : mine ? 'Update application' : 'Submit expert application'}
        </button>
        {mine && !approved && !saved ? <span className="text-xs text-neutral-500">Your application is under board review — you can update it anytime.</span> : null}
        {saved ? <span className="text-xs font-medium text-emerald-600">✓ {saved}</span> : null}
      </div>

      {/* §2 — voluntarily leave: deletes the expert profile (and removes the role). */}
      {mine ? (
        <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => { setLeaveError(null); setConfirmLeave(true); }}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
          >
            Leave the platform
          </button>
          <p className="mt-1 text-xs text-neutral-500">Removes your expert profile entirely. You can apply again later.</p>
          {leaveError ? <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">⚠ {leaveError}</div> : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmLeave}
        title="Leave the platform as an Expert?"
        tone="danger"
        confirmLabel="Leave & delete profile"
        cancelLabel="Stay"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          void (async () => {
            try {
              await expertApi.leave();
              setConfirmLeave(false);
              await load();
              await refresh();
              onChange?.();
            } catch (e) {
              setConfirmLeave(false);
              setLeaveError(e instanceof Error ? e.message : 'failed to leave');
            }
          })();
        }}
        message={<p>This <strong>deletes your expert profile</strong> and removes the Expert role from your account. Any past review/reward history is preserved for the platform&apos;s records. You can apply again any time.</p>}
      />
    </form>
  );
}
