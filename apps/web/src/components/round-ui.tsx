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
 * Date / datetime-local input that buffers the pick until the user confirms — browsers commit
 * the native picker's value on every interaction (no built-in Confirm/Cancel), which is easy to
 * trigger by accident. Confirm/Cancel buttons appear only when there's an unconfirmed change.
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
  useEffect(() => setPending(value), [value]);
  const dirty = pending !== value;
  const inputCls = className ?? 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type={type}
        className={inputCls}
        value={pending}
        min={min}
        required={required}
        onChange={(e) => setPending(e.target.value)}
      />
      {dirty ? (
        <>
          <button
            type="button"
            onClick={() => onChange(pending)}
            className="rounded border border-emerald-500 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setPending(value)}
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
        </>
      ) : null}
    </div>
  );
}
