'use client';

import { useEffect, useState } from 'react';

/** Shared presentation bits for rounds & proposals (badges, colors, formatting). */

export const ROUND_STATUS_CLS: Record<string, string> = {
  PREPARATION: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200',
  SUBMISSION: 'bg-amber-200 text-amber-900',
  FILTERING: 'bg-blue-200 text-blue-900',
  DV: 'bg-indigo-200 text-indigo-900',
  FUNDING: 'bg-emerald-200 text-emerald-900',
  CLOSED: 'bg-neutral-300 text-neutral-700',
};

// Proposal statuses. DRAFT/PENDING are surfaced as a count only (content stays private), so a
// round's overview shows how it is filling up.
export const PROPOSAL_STATUS_CLS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  ACTIVE: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  COMPLETE: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
  FAILED: 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100',
  DRAFT: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};
// Order proposal-status chips consistently. The backend (both the round detail and the rounds
// list) sends counts for every status, including DRAFT/PENDING.
const STATUS_ORDER = ['DRAFT', 'PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'COMPLETE', 'FAILED'];

export function StatusBadge({ status, cls }: { status: string; cls?: Record<string, string> }) {
  const map = cls ?? ROUND_STATUS_CLS;
  return <span className={`rounded px-2 py-0.5 text-xs ${map[status] ?? 'bg-neutral-200 text-neutral-700'}`}>{status}</span>;
}

/** Per-status proposal count chips, e.g. "2 ACTIVE · 1 APPROVED". */
export function ProposalCounts({ counts }: { counts?: Record<string, number> }) {
  const c = counts ?? {};
  const entries = STATUS_ORDER.filter((s) => (c[s] ?? 0) > 0).map((s) => [s, c[s]] as const);
  if (entries.length === 0) return <span className="text-xs text-neutral-400">no proposals yet</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([s, n]) => (
        <span key={s} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PROPOSAL_STATUS_CLS[s] ?? ''}`}>
          {n} {s.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Convert an ISO string to the value a <input type="datetime-local"> expects. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

/**
 * Date / datetime-local input. The native picker has no Confirm — the user has to click
 * elsewhere to commit, which is easy to miss. So while the input is **focused** we show
 * Confirm + Cancel buttons (handy alongside the open picker); clicking elsewhere (blur) also
 * commits automatically. Once the date is set, the buttons go away. New date picks default
 * the time to midnight (00:00) so users who only care about the day don't need to touch the
 * time field; subsequent changes to the time are preserved.
 */
export function DateField({
  value,
  onChange,
  type = 'datetime-local',
  min,
  required,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: 'date' | 'datetime-local';
  min?: string;
  required?: boolean;
  className?: string;
}) {
  const [pending, setPending] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => setPending(value), [value]);

  /** Date changed (and so did the time, by the browser's auto-fill) → snap the time to 00:00. */
  const normalize = (newVal: string) => {
    if (type !== 'datetime-local' || !newVal) return newVal;
    const prevDate = (value || '').slice(0, 10);
    const newDate = newVal.slice(0, 10);
    const prevTime = (value || '').slice(11, 16);
    const newTime = newVal.slice(11, 16);
    if (newDate !== prevDate && newTime !== prevTime) {
      return `${newDate}T00:00`;
    }
    return newVal;
  };

  const dirty = pending !== value;
  const showButtons = focused && dirty;
  const inputCls = className ?? 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type={type}
        className={inputCls}
        value={pending}
        min={min}
        required={required}
        onFocus={() => setFocused(true)}
        // Commit on blur unless the user is clicking our Confirm/Cancel (those use
        // onMouseDown→preventDefault so they don't steal focus from the input first).
        onBlur={() => { setFocused(false); if (pending !== value) onChange(pending); }}
        onChange={(e) => setPending(normalize(e.target.value))}
      />
      {showButtons ? (
        <>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(pending); setFocused(false); }}
            className="rounded border border-emerald-500 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
          >
            Confirm
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setPending(value); setFocused(false); }}
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
        </>
      ) : null}
    </div>
  );
}
