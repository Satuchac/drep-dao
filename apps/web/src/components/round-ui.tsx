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

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Date / datetime-local picker that shows the **month as a name** (a <select> of "January…
 * December") + numeric day + numeric year + (for datetime) a time input. Native
 * `<input type="datetime-local">` always shows MM/DD/YYYY (or DD/MM/YYYY in non-en locales),
 * which is easy to mis-read, so this custom widget makes the month unambiguous in every browser.
 * `min` is accepted for API compatibility but not enforced per-field; submit-time validation
 * (and inline warnings the caller renders) cover the constraint.
 */
export function DateField({
  value,
  onChange,
  type = 'datetime-local',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const withTime = type === 'datetime-local';
  // Parse the canonical value ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM") into the 3-4 sub-fields.
  const parsed = (() => {
    if (!value) return { y: '', m: '', d: '', t: withTime ? '00:00' : '' };
    const [datePart, timePart] = value.split('T');
    const [yy = '', mm = '', dd = ''] = (datePart ?? '').split('-');
    return {
      y: yy,
      m: mm ? String(parseInt(mm, 10)) : '',
      d: dd ? String(parseInt(dd, 10)) : '',
      t: (timePart ?? '').slice(0, 5) || (withTime ? '00:00' : ''),
    };
  })();

  const commit = (y: string, m: string, d: string, t: string) => {
    if (!y || !m || !d) { onChange(''); return; }
    const date = `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (!withTime) { onChange(date); return; }
    const tt = (t || '00:00').slice(0, 5);
    onChange(`${date}T${tt}`);
  };

  const cell = 'rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      <select
        value={parsed.m}
        required={required}
        onChange={(e) => commit(parsed.y, e.target.value, parsed.d, parsed.t)}
        className={`${cell} min-w-[8.5rem]`}
      >
        <option value="">Month</option>
        {MONTHS.map((label, i) => (
          <option key={i + 1} value={String(i + 1)}>{label}</option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        max={31}
        placeholder="Day"
        value={parsed.d}
        required={required}
        onChange={(e) => commit(parsed.y, parsed.m, e.target.value.replace(/\D/g, ''), parsed.t)}
        className={`${cell} w-16`}
      />
      <input
        type="number"
        min={2024}
        max={2100}
        placeholder="Year"
        value={parsed.y}
        required={required}
        onChange={(e) => commit(e.target.value.replace(/\D/g, ''), parsed.m, parsed.d, parsed.t)}
        className={`${cell} w-24`}
      />
      {withTime ? (
        <input
          type="time"
          value={parsed.t || '00:00'}
          onChange={(e) => commit(parsed.y, parsed.m, parsed.d, e.target.value)}
          className={`${cell} w-28`}
        />
      ) : null}
    </div>
  );
}
