'use client';

import { useEffect, useState } from 'react';
import { drepApi, type EntryEligibility } from '@/lib/api';

/**
 * §14.1 — the "Join DAO" button, gated on the configurable on-chain entry
 * requirements. When the gate is disabled (testnet default) the button is active;
 * when enabled and unmet, it is disabled with a note listing what's missing.
 */
export function JoinDaoButton({ onJoin }: { onJoin: () => void }) {
  const [elig, setElig] = useState<EntryEligibility | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    drepApi
      .entryEligibility()
      .then(setElig)
      .catch(() => setElig(null))
      .finally(() => setLoading(false));
  }, []);

  const blocked = !!elig && elig.gatingEnabled && !elig.eligible;
  const unmet = elig?.requirements.filter((r) => !r.met) ?? [];

  return (
    <div className="space-y-1">
      <button
        onClick={onJoin}
        disabled={loading || blocked}
        title={blocked ? 'You do not meet the minimum entry requirements' : undefined}
        className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-400 disabled:opacity-70"
      >
        {loading ? 'Checking eligibility…' : 'JOIN DAO'}
      </button>
      {blocked ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/60 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <div className="font-medium">You don&apos;t meet the minimum entry requirements:</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
            {unmet.map((r, i) => (
              <li key={i}>
                <span className="font-medium">{r.label}</span> — {r.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
