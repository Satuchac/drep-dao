'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import { useAuth } from '@/lib/auth-context';
import { drepApi } from '@/lib/api';

export function DrepApplicationForm() {
  const { detectDRepId, refresh } = useAuth();
  const [drepId, setDrepId] = useState('');
  const [autoDetected, setAutoDetected] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [telegram, setTelegram] = useState('');
  const [email, setEmail] = useState('');
  const [subs, setSubs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CIP-95 auto-detect on mount (best-effort; editable).
  useEffect(() => {
    void detectDRepId().then((id) => {
      if (id) {
        setDrepId(id);
        setAutoDetected(true);
      }
    });
  }, [detectDRepId]);

  const toggleSub = (id: string) =>
    setSubs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await drepApi.apply({
        drepIdOnchain: drepId.trim(),
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
        subcategoryIds: subs,
        contact: {
          ...(telegram.trim() ? { telegram: telegram.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        },
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  return (
    <form onSubmit={submit} className="space-y-4">
      <h3 className="text-base font-semibold">Apply to become a DRep</h3>

      <label className="block space-y-1">
        <span className="text-sm font-medium">DRep ID</span>
        <input
          className={field}
          placeholder="drep1..."
          value={drepId}
          onChange={(e) => {
            setDrepId(e.target.value);
            setAutoDetected(false);
          }}
          required
        />
        <span className="text-xs text-neutral-500">
          {autoDetected
            ? 'Auto-detected from your wallet (CIP-95) — edit if it differs from your wallet.'
            : 'Paste your drep1… ID, or it will be auto-filled if your wallet supports CIP-95.'}
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Display name</span>
        <input className={field} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Motivation / bio</span>
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

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Telegram</span>
          <input className={field} value={telegram} onChange={(e) => setTelegram(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Email</span>
          <input className={field} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <button
        type="submit"
        disabled={busy || !drepId.trim()}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit application'}
      </button>
    </form>
  );
}
