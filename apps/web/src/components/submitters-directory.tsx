'use client';

import { useEffect, useState } from 'react';
import { submitterApi, type ApprovedSubmitter } from '@/lib/api';
import { card } from '@/lib/ui';
import { FallbackAvatar } from './fallback-avatar';
import { CopyButton } from './copy-button';
import { useExplorer } from '@/lib/explorer';

/**
 * §2.1 — public directory of APPROVED submitters (mirrors the DAO members overview).
 * Click a row to open the FULL profile (photo — or a universal B/W placeholder head —
 * description, country, conflict-of-interest, pledge, contact, every link). A submitter
 * who is ALSO a DAO member is flagged prominently: they both submit and vote.
 */
export function SubmittersDirectory() {
  const { drepUrl } = useExplorer();
  const [rows, setRows] = useState<ApprovedSubmitter[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // §2.1 — deregistered profiles stay in the history; show them on demand.
  const [showLeft, setShowLeft] = useState(false);
  useEffect(() => {
    setRows(null);
    submitterApi.directory(showLeft).then(setRows).catch(() => setRows([]));
  }, [showLeft]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Submitters</h2>
        <p className="text-sm text-neutral-500">
          Approved submitters — accounts allowed to submit funding proposals. Click a row for the
          full profile. Submitters who are also DAO members (they vote, too) are flagged.
        </p>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
        Show deleted accounts (submitters who left — profiles are kept in the history)
      </label>
      {rows === null ? <p className="text-sm text-neutral-500">Loading…</p> : null}
      {rows?.length === 0 ? <p className="text-sm text-neutral-500">No approved submitters yet.</p> : null}
      <div className="space-y-3">
        {rows?.map((s) => {
          const open = openId === s.id;
          return (
            <section key={s.id} className={card}>
              <button onClick={() => setOpenId(open ? null : s.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                <span className="flex items-center gap-2">
                  {s.logoDataUrl
                    ? <img src={s.logoDataUrl} alt="" className="h-9 w-9 rounded object-cover" />
                    : <FallbackAvatar name={s.displayName} className="h-9 w-9 rounded" />}
                  <span className="font-medium">{s.displayName}</span>
                  {s.country ? <span className="text-xs text-neutral-500">{s.country}</span> : null}
                  {s.status === 'LEFT' ? (
                    <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" title={s.leftAt ? `left ${new Date(s.leftAt).toLocaleDateString()}` : 'left the platform'}>
                      left{s.leftAt ? ` ${new Date(s.leftAt).toLocaleDateString()}` : ''}
                    </span>
                  ) : null}
                  {s.isDaoMember ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200" title="This submitter also votes on funding proposals">
                      ⚠ also a DAO member
                    </span>
                  ) : null}
                  {s.noSelfVotePledge ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">✓ no self-vote pledge</span> : null}
                </span>
                <span className="flex items-center gap-2 text-xs text-neutral-400">
                  {s.since ? <span>approved {new Date(s.since).toLocaleDateString()}</span> : null}
                  <span>{open ? '▴' : '▾'}</span>
                </span>
              </button>

              {open ? (
                <div className="mt-3 flex flex-wrap gap-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                  {s.logoDataUrl
                    ? <img src={s.logoDataUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
                    : <FallbackAvatar name={s.displayName} className="h-24 w-24 rounded-lg" />}
                  <div className="min-w-0 flex-1 space-y-2 text-sm">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Description</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{s.description}</p>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Previous funding</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{s.previousFunding || '— none declared —'}</p>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Conflict of interest</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{s.conflictOfInterest || '—'}</p>
                    </div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-300">
                      <span className="font-medium">Pledge:</span> {s.noSelfVotePledge ? '✓ will not vote for own proposals' : 'no self-vote pledge given (informative)'}
                      {s.isDaoMember ? <span className="ml-2 font-medium text-amber-700 dark:text-amber-300">⚠ this submitter is also a DAO member and votes on funding</span> : null}
                    </div>
                    <div className="text-xs">
                      <span className="font-medium">Contact:</span>{' '}
                      {s.telegram ? <span className="font-mono">{s.telegram}</span> : '—'}
                      {' · '}
                      {s.email ? <a href={`mailto:${s.email}`} className="text-emerald-700 underline dark:text-emerald-400">{s.email}</a> : '—'}
                    </div>
                    {/* The platform knows the wallet — surface the on-chain identity. */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium">Wallet (stake):</span>
                      <span className="break-all font-mono text-neutral-600 dark:text-neutral-300">{s.stakeAddress}</span>
                      <CopyButton text={s.stakeAddress} label="Copy" />
                    </div>
                    {s.drepIdOnchain ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-medium">DRep ID:</span>
                        <a href={drepUrl(s.drepIdOnchain)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">{s.drepIdOnchain}</a>
                        <CopyButton text={s.drepIdOnchain} label="Copy" />
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Links</div>
                      <div className="mt-0.5 space-y-0.5 text-xs">
                        <div>
                          <span className="font-medium">GitHub:</span>{' '}
                          {s.githubUrls.length
                            ? s.githubUrls.map((l, i) => (
                                <a key={i} href={l} target="_blank" rel="noreferrer" className="mr-2 break-all text-emerald-700 underline dark:text-emerald-400">{l}</a>
                              ))
                            : <span className="text-neutral-400">not provided</span>}
                        </div>
                        <div>
                          <span className="font-medium">Social media:</span>{' '}
                          {s.socialLinks.length
                            ? s.socialLinks.map((l, i) => (
                                <a key={i} href={l} target="_blank" rel="noreferrer" className="mr-2 break-all text-emerald-700 underline dark:text-emerald-400">{l}</a>
                              ))
                            : <span className="text-neutral-400">not provided</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
