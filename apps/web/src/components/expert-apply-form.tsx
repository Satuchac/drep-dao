'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import { expertApi, type MyExpert } from '@/lib/api';

const field =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §2 — a non-DRep ADA holder applies to be an Expert (milestone reviewer); board approves. */
export function ExpertApplyForm({ onChange }: { onChange?: () => void } = {}) {
  const [mine, setMine] = useState<MyExpert | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [subs, setSubs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    expertApi.mine().then((e) => {
      setMine(e);
      if (e) {
        setName(e.displayName);
        setBio(e.bio ?? '');
        setSubs(e.subcategoryIds ?? []);
      }
    });
  useEffect(() => {
    void load();
  }, []);

  const toggleSub = (id: string) =>
    setSubs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await expertApi.apply({ displayName: name.trim(), bio: bio.trim() || undefined, subcategoryIds: subs });
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  if (mine?.approvedByBoard) {
    return (
      <div className="space-y-1 text-sm">
        <h3 className="text-base font-semibold">Expert</h3>
        <div className="text-emerald-600">You are an approved Expert ✅</div>
        <p className="text-neutral-500">
          You can provide your expertise — milestone reviews and feedback in the Debate &amp; Vote stage.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h3 className="text-base font-semibold">Apply to be an Expert</h3>
      <p className="text-sm text-neutral-500">
        Experts are non-DRep ADA holders approved by the board to provide their expertise — milestone
        reviews and feedback in the Debate &amp; Vote stage.
        {mine ? ' Your application is under board review — you can update it below.' : ''}
      </p>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Display name</span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Experience / skills</span>
        <textarea className={field} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>
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
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? 'Submitting…' : mine ? 'Update application' : 'Submit expert application'}
      </button>
    </form>
  );
}
