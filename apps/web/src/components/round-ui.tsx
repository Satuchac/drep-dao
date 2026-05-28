'use client';

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
/** Same as fmtDateTime but date only — used wherever the time isn't meaningful (board install date, etc.). */
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium' }) : '—';

/** Convert an ISO string to the value a <input type="datetime-local"> expects. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

/**
 * Date / datetime-local input. The native picker commits on every interaction (no extra
 * Confirm/Cancel buttons) — clicking a calendar date or editing the time both commit through
 * onChange. New date picks default the time to midnight (00:00) so users who only care about
 * the day don't have to touch the time field. If the user then explicitly changes the time,
 * the time is preserved on subsequent edits (until they pick a different date again).
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
  const normalize = (newVal: string) => {
    if (type !== 'datetime-local' || !newVal) return newVal;
    const prevDate = (value || '').slice(0, 10);
    const newDate = newVal.slice(0, 10);
    // Any date change → snap the time to 00:00 (the browser's auto-fill might be current time,
    // which the user almost never wants). Time-only edits pass through unchanged.
    if (newDate !== prevDate) return `${newDate}T00:00`;
    return newVal;
  };
  const inputCls = className ?? 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  // Browser inputs always render dates as MM/DD/YYYY (en-US) or DD/MM/YYYY (others) — easy to
  // mis-read. Show the parsed date with the month NAME beneath the input so it's unambiguous.
  const hint = value ? (type === 'date' ? fmtDate(value) : fmtDateTime(value)) : '';
  return (
    <div>
      <input
        type={type}
        className={inputCls}
        value={value}
        min={min}
        required={required}
        onChange={(e) => onChange(normalize(e.target.value))}
      />
      {hint ? <div className="mt-0.5 text-[11px] text-neutral-500">{hint}</div> : null}
    </div>
  );
}
