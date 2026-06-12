'use client';

import { useEffect, useState } from 'react';
import { submitterApi, type ApprovedSubmitter } from '@/lib/api';
import { card } from '@/lib/ui';

/**
 * §2.1 — public directory of APPROVED submitters (mirrors the DAO members overview).
 * A submitter who is ALSO a DAO member is flagged prominently — they both submit
 * proposals and vote on funding, which matters for conflict-of-interest review.
 */
export function SubmittersDirectory() {
  const [rows, setRows] = useState<ApprovedSubmitter[] | null>(null);
  useEffect(() => {
    submitterApi.directory().then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Submitters</h2>
        <p className="text-sm text-neutral-500">
          Approved submitters — accounts allowed to submit funding proposals. Submitters who are
          also DAO members (they vote, too) are flagged.
        </p>
      </div>
      {rows === null ? <p className="text-sm text-neutral-500">Loading…</p> : null}
      {rows?.length === 0 ? <p className="text-sm text-neutral-500">No approved submitters yet.</p> : null}
      <div className="space-y-3">
        {rows?.map((s) => (
          <section key={s.id} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                {s.logoDataUrl ? <img src={s.logoDataUrl} alt="" className="h-9 w-9 rounded object-cover" /> : null}
                <span className="font-medium">{s.displayName}</span>
                {s.country ? <span className="text-xs text-neutral-500">{s.country}</span> : null}
                {s.isDaoMember ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200" title="This submitter also votes on funding proposals">
                    ⚠ also a DAO member
                  </span>
                ) : null}
                {s.noSelfVotePledge ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">✓ no self-vote pledge</span> : null}
              </span>
              {s.since ? <span className="text-xs text-neutral-400">approved {new Date(s.since).toLocaleDateString()}</span> : null}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{s.description}</p>
            {s.conflictOfInterest ? (
              <div className="mt-1 text-xs">
                <span className="font-medium">Conflict of interest:</span>{' '}
                <span className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">{s.conflictOfInterest}</span>
              </div>
            ) : null}
            {(s.githubUrls.length || s.socialLinks.length) ? (
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {[...s.githubUrls, ...s.socialLinks].map((l, i) => (
                  <a key={i} href={l} target="_blank" rel="noreferrer" className="text-emerald-700 underline dark:text-emerald-400">{l}</a>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
