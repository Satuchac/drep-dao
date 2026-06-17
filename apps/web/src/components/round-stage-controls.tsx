'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardRoundsApi, roundsApi, type RoundDetail } from '@/lib/api';
import { ROUND_SETTING_DEFAULTS, ROUND_SETTING_META } from '@drep-dao/shared';
import { ProposalCounts, StatusBadge, fmtDateTime, toLocalInput, DateField } from './round-ui';
import { CreateRoundForm } from './rounds-section';
import { ConfirmDialog } from './confirm-dialog';
import { useAuth } from '@/lib/auth-context';
import { notifyTodoChanged } from '@/lib/use-todo-counts';

/** "1 day and 5 hours" / "5 hours and 12 minutes" / "8 minutes" from a ms delta. */
function untilLabel(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const u = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (days > 0) return `${u(days, 'day')} and ${u(hours, 'hour')}`;
  if (hours > 0) return `${u(hours, 'hour')} and ${u(mins, 'minute')}`;
  return u(mins, 'minute');
}

/** Stage length from a start→end ms span: "10 days", "3 weeks (21 days)", "2 months (64 days)". */
function durationLabel(startMs: number, endMs: number): string | null {
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  const hours = Math.round((endMs - startMs) / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round((endMs - startMs) / 86_400_000);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks (${days} days)`;
  return `${Math.round(days / 30)} months (${days} days)`;
}

const STAGE_LABEL: Record<string, string> = {
  SUBMISSION: 'Submission',
  FILTERING: 'Filtering',
  DEBATE: 'Debate & Vote — Debate',
  VOTE: 'Debate & Vote — Vote',
  DV: 'Debate & Vote (legacy)', // deprecated alias
  FUNDING: 'Funding',
  CLOSED: 'Close round',
};

/**
 * §8 — board controls for advancing a round's stages. Each transition is confirmed
 * by a board member: choose auto-start at the planned date or launch early by hand;
 * the final stage (Funding) is closed manually. Self-hides when no round is open.
 */
export function RoundStageControls() {
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [rounds, setRounds] = useState<RoundDetail[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    roundsApi
      .list()
      .then((list) => Promise.all(list.filter((r) => r.status !== 'CLOSED').map((r) => roundsApi.get(r.id))))
      .then(setRounds)
      .catch(() => setRounds([]));
  }, []);
  useEffect(load, [load]);

  // Non-board members with no open round have nothing to act on here.
  if (!isBoard && rounds.length === 0) return null;

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Round stage controls</h3>
          <p className="text-xs text-neutral-500">
            Confirm each next stage before it begins. Check the proposals are ready, then let it auto-start at the
            planned time or launch it early. Delays shift the new stage to start now and keep its planned length.
          </p>
        </div>
        {/* §5/§6 — board members can start a new funding round straight from here
            (same control as the Rounds section). */}
        {isBoard ? (
          <button
            onClick={() => setCreating((v) => !v)}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {creating ? 'Cancel' : '+ Create round'}
          </button>
        ) : null}
      </div>

      {creating ? <CreateRoundForm onDone={() => { setCreating(false); load(); }} /> : null}

      {rounds.length === 0 ? (
        <p className="text-sm text-neutral-500">No open round. Create one to get started.</p>
      ) : (
        rounds.map((r) => <RoundControl key={r.id} round={r} onChange={load} />)
      )}
    </section>
  );
}

// Stage chronology — every stage with a schedule row, in execution order.
// `status` is the round status the stage corresponds to (used to compare against
// round.status). The board sees ALL of these in the round-control panel: past
// ones are read-only, the current one allows end-date edits, the immediate
// next allows confirm/launch, and any stages beyond that can be re-planned.
const ALL_STAGES: { key: string; status: string; label: string }[] = [
  { key: 'submission', status: 'SUBMISSION', label: 'Submission' },
  { key: 'filtering',  status: 'FILTERING',  label: 'Filtering' },
  { key: 'debate',     status: 'DEBATE',     label: 'Debate' },
  { key: 'vote',       status: 'VOTE',       label: 'Vote' },
  { key: 'funding',    status: 'FUNDING',    label: 'Funding' },
];
// Legacy 'debate_vote' rows fall back to "Vote" semantically (the deprecated
// alias was treated as VOTE everywhere else).
const STAGE_LABEL_BY_KEY: Record<string, string> = {
  submission: 'Submission',
  filtering: 'Filtering',
  debate: 'Debate',
  vote: 'Vote',
  debate_vote: 'Debate & Vote (legacy)',
  funding: 'Funding',
};
// Map of round.status → the stageKey corresponding to the currently-running stage.
// (Kept for the back-compat DV path that the schedule may still hold as 'debate_vote'.)
const CURRENT_STAGE_KEY: Record<string, string | null> = {
  PREPARATION: null,
  SUBMISSION: 'submission',
  FILTERING: 'filtering',
  DEBATE: 'debate',
  VOTE: 'vote',
  DV: 'debate_vote',
  FUNDING: 'funding',
  CLOSED: null,
};

function RoundControl({ round, onChange }: { round: RoundDetail; onChange: () => void }) {
  const next = round.nextStage;
  // The "next stage" status — for legacy DV the next is FUNDING (rare).
  const nextStatus = next?.status ?? null;
  // Where we are in the chronology.
  const currentIdx = ALL_STAGES.findIndex((s) => s.status === round.status);
  // Map from stage key → schedule row (legacy debate_vote also gets mapped under
  // 'vote' so a pre-split round still shows a Vote control).
  const scheduleByKey = new Map(round.schedule.map((s) => [s.stageKey, s]));
  const legacyDv = round.schedule.find((s) => s.stageKey === 'debate_vote');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // §6 — two sub-views: the stage timeline (advance the round) and the round setup
  // (edit name / budget / categories / settings). Horizontal submenu, like My-area.
  const [subTab, setSubTab] = useState<'stages' | 'setup'>('stages');
  const [confirmClose, setConfirmClose] = useState(false);
  // A round's fields (name, budget, categories, settings) are editable until review starts.
  const canEdit = round.status === 'PREPARATION' || round.status === 'SUBMISSION';

  const run = async (action: () => Promise<unknown>, tag: string) => {
    setError(null);
    setBusy(tag);
    try {
      await action();
      onChange();
      // §8 — confirming/launching/saving a stage changes the Round-control to-do count;
      // refresh the badges right away (a now-confirmed next stage drops off the count).
      notifyTodoChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          Round #{round.number}
          {round.name ? ` — ${round.name}` : ''}
        </span>
        <StatusBadge status={round.status} />
      </div>

      {/* §6 — horizontal submenu: stage timeline vs. round setup. */}
      <div className="mt-2 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {([['stages', 'Round stage control'], ['setup', 'Round setup']] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setSubTab(k)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${subTab === k ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* §6 — round setup: edit name / budget / categories / settings (locked once review starts). */}
      {subTab === 'setup' ? (
        <div className="mt-3">
          {canEdit ? (
            <CreateRoundForm initial={round} roundId={round.id} onDone={onChange} />
          ) : round.status === 'CLOSED' ? (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              ⚠ The round is closed — its setup can no longer be edited.
            </p>
          ) : (
            <LockedRoundSetup round={round} onChange={onChange} />
          )}
        </div>
      ) : null}

      {subTab === 'stages' ? (
      <>
      <div className="mt-2">
        <div className="text-xs text-neutral-500">Proposals (verify readiness before advancing):</div>
        <div className="mt-1"><ProposalCounts counts={round.proposalCounts} /></div>
      </div>

      {/* §6/§8 — full schedule for the round: every stage in execution order with
          the controls that make sense for its kind (past / current / next / future). */}
      <div className="mt-3 space-y-2">
        {(() => {
          // Track the previous stage's stored end so each row can flag a start set before it.
          let prevEndsAt: string | undefined;
          return ALL_STAGES.map((stage, idx) => {
            // Resolve the schedule row — fall back to legacy 'debate_vote' for the Vote slot
            // (the Vote sub-stage inherited from the pre-split design when nothing was migrated).
            const row = scheduleByKey.get(stage.key)
              ?? (stage.key === 'vote' && legacyDv ? legacyDv : undefined);
            const kind: 'past' | 'current' | 'next' | 'future' =
              idx < currentIdx ? 'past'
              : idx === currentIdx ? 'current'
              : stage.status === nextStatus ? 'next'
              : 'future';
            const prev = prevEndsAt;
            if (row) prevEndsAt = row.endsAt; // becomes the lower bound for the next stage
            return (
              <StageRow
                key={stage.key}
                kind={kind}
                label={stage.label}
                stageKey={stage.key}
                row={row}
                nextStage={kind === 'next' ? next : null}
                prevEndsAt={prev}
                roundId={round.id}
                busy={busy}
                onRun={run}
              />
            );
          });
        })()}
        {/* §8 — Funding → CLOSED is always manual; surface a dedicated control once we're there. */}
        {round.status === 'FUNDING' ? (
          <div className="rounded border border-red-200 p-2 text-xs dark:border-red-900">
            <div className="font-medium text-red-800 dark:text-red-200">Closing the round</div>
            <div className="mt-0.5 text-neutral-500">
              Close manually once funding is complete; delays expected.
            </div>
            <button
              onClick={() => setConfirmClose(true)}
              disabled={busy !== null}
              className="mt-1 rounded border border-red-500 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
            >
              {busy === 'close' ? 'Closing…' : 'Close round'}
            </button>
            <ConfirmDialog
              open={confirmClose}
              title={`Close round #${round.number}?`}
              message="This ends the round. New milestone POAs / votes will no longer be accepted."
              confirmLabel="Close round"
              tone="danger"
              onConfirm={() => { setConfirmClose(false); void run(() => boardRoundsApi.close(round.id), 'close'); }}
              onCancel={() => setConfirmClose(false)}
            />
          </div>
        ) : null}
        {!next && round.status !== 'FUNDING' ? (
          <div className="text-xs text-neutral-500">Round complete.</div>
        ) : null}
      </div>
      </>
      ) : null}
      {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
    </div>
  );
}

/**
 * One row in the per-round schedule strip. Behaviour per `kind`:
 *   past    — read-only summary; the stage has already happened.
 *   current — start frozen, end editable + Save.
 *   next    — full confirm-or-launch UI for the immediate next stage.
 *   future  — start/end editable + Save plan (no transition).
 */
function StageRow({
  kind,
  label,
  stageKey,
  row,
  nextStage,
  prevEndsAt,
  roundId,
  busy,
  onRun,
}: {
  kind: 'past' | 'current' | 'next' | 'future';
  label: string;
  stageKey: string;
  row: { stageKey: string; startsAt: string; endsAt: string; autoStart?: boolean; confirmedAt?: string | null } | undefined;
  nextStage: RoundDetail['nextStage'];
  // §6 — the end of the previous stage (stored); a stage may not start before it.
  prevEndsAt: string | undefined;
  roundId: string;
  busy: string | null;
  onRun: (action: () => Promise<unknown>, tag: string) => Promise<void>;
}) {
  const tag = `${kind}-${stageKey}`;
  const [startsAt, setStartsAt] = useState(toLocalInput(row?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(row?.endsAt));
  const [autoStart, setAutoStart] = useState(row?.autoStart ?? false);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  // Live clock for the next-stage countdown (minute granularity → days/hours).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const startMs = startsAt ? new Date(startsAt).getTime() : NaN;
  const endMs = endsAt ? new Date(endsAt).getTime() : NaN;
  // §6 — a stage can't start before the previous stage's (stored) end. Flags the start red.
  const prevEndMs = prevEndsAt ? new Date(prevEndsAt).getTime() : NaN;
  const startsBeforePrev = !Number.isNaN(startMs) && !Number.isNaN(prevEndMs) && startMs < prevEndMs;
  // Live stage-length label from the (editable) start→end, recomputed as the inputs change.
  const editDuration = durationLabel(startMs, endMs);
  // §6 — "dirty" = the inputs differ from the saved schedule row. Drives the Saved / Not-saved
  // badge and disables the save button once everything is persisted (re-enables on any edit).
  const savedStart = toLocalInput(row?.startsAt);
  const savedEnd = toLocalInput(row?.endsAt);
  const planDirty = startsAt !== savedStart || endsAt !== savedEnd || autoStart !== (row?.autoStart ?? false);
  const endDirty = endsAt !== savedEnd;
  // Small reusable validation-problem list renderer.
  const Problems = ({ items }: { items: string[] }) =>
    items.length ? (
      <ul className="mt-1 list-disc pl-4 text-[11px] text-red-600 dark:text-red-400">
        {items.map((p) => <li key={p}>{p}</li>)}
      </ul>
    ) : null;
  // Saved / Not-saved indicator shown next to a save button.
  const SavedBadge = ({ dirty }: { dirty: boolean }) =>
    dirty
      ? <span className="text-xs font-medium text-red-600 dark:text-red-400">● Not saved</span>
      : <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ Saved</span>;
  if (kind === 'past') {
    if (!row) {
      return <PastRow label={label} note="no schedule row" />;
    }
    const lasted = durationLabel(new Date(row.startsAt).getTime(), new Date(row.endsAt).getTime());
    return (
      <PastRow
        label={label}
        note={`${fmtDateTime(row.startsAt)} → ${fmtDateTime(row.endsAt)}${lasted ? ` · lasted ${lasted}` : ''}`}
      />
    );
  }
  if (kind === 'current') {
    if (!row) return <PastRow label={label} note="no schedule row" />;
    // Start is frozen; only the end is editable. Length runs from the frozen start.
    const frozenStartMs = new Date(row.startsAt).getTime();
    const curDuration = durationLabel(frozenStartMs, endMs);
    const problems: string[] = [];
    if (!endsAt) problems.push('Set an end date.');
    else if (Number.isNaN(endMs)) problems.push('The end date is invalid.');
    // Only a real error when the board is actively EXTENDING the end (edited it to a past time).
    // An UNCHANGED end date that has simply passed isn't a mistake to fix — the stage is just
    // overdue to hand off, which the next stage / auto-start handles. So don't nag in red then.
    else if (endMs <= now && endDirty) problems.push('The end date must be in the future.');
    else if (endMs <= frozenStartMs) problems.push('The end date must be after the start date.');
    const valid = problems.length === 0;
    // Calm note (not an error) when the planned end has passed and the board hasn't touched it.
    const endOverdue = !Number.isNaN(endMs) && endMs <= now && !endDirty;
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50/40 p-2 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="text-xs">
          <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
            current
          </span>{' '}
          <span className="font-medium">{label}</span>
          {' · '}
          <span className="text-neutral-500">started {fmtDateTime(row.startsAt)} (frozen)</span>
          {curDuration ? <span className="text-neutral-500"> · planned length {curDuration}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            ends
            <DateField value={endsAt} onChange={setEndsAt} />
          </div>
          <button
            onClick={() => onRun(() => boardRoundsApi.updateCurrentStage(roundId, new Date(endsAt).toISOString()), tag)}
            disabled={busy !== null || !valid || !endDirty}
            className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            {busy === tag ? 'Saving…' : 'Save new end date'}
          </button>
          <SavedBadge dirty={endDirty} />
        </div>
        {endOverdue ? (
          <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            This stage&apos;s planned end has passed — the next stage starts at its own planned time (auto-start handles it), or launch it below. Set a later end above only to extend this stage.
          </div>
        ) : null}
        <Problems items={problems} />
      </div>
    );
  }
  if (kind === 'next') {
    const confirmed = !!nextStage?.confirmed;
    // §6/§8 — overdue: the planned start is in the past but the stage hasn't begun.
    const plannedStartMs = nextStage?.planned?.startsAt ? new Date(nextStage.planned.startsAt).getTime() : null;
    const overdue = plannedStartMs != null && plannedStartMs < now;
    // Relational/format problems — a broken state for BOTH buttons (Launch keeps the stage's
    // planned length, so an end-before-start is nonsensical for it too).
    const relProblems: string[] = [];
    if (!startsAt) relProblems.push('Set a start date.');
    else if (Number.isNaN(startMs)) relProblems.push('The start date is invalid.');
    if (!endsAt) relProblems.push('Set an end date.');
    else if (Number.isNaN(endMs)) relProblems.push('The end date is invalid.');
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs <= startMs) relProblems.push('The end date must be after the start date.');
    if (startsBeforePrev) relProblems.push(`${label} can't start before the previous stage ends (${fmtDateTime(prevEndsAt)}).`);
    // "Dirty" for the next stage = either the dates/auto-start were edited, or the stage isn't
    // confirmed yet. When it's already confirmed AND unchanged, there's nothing to confirm.
    const nextDirty = planDirty || !confirmed;
    // An overdue stage that's already confirmed with auto-start needs NO board action — the
    // scheduler advances it on its next check. So only nag "the start must be in the future" when
    // there's actually something to confirm (the board edited the plan, or it isn't confirmed yet).
    const autoStartHandlesIt = confirmed && autoStart && !planDirty;
    // "Confirm date" additionally needs the start in the future (auto/planned start). To start a
    // stage right now regardless of the planned start, use "Launch … now".
    const confirmProblems = [...relProblems];
    if (nextDirty && !Number.isNaN(startMs) && startMs <= now) confirmProblems.push('The start date must be in the future (or use “Launch now” to start immediately).');
    const launchValid = relProblems.length === 0;
    const confirmValid = confirmProblems.length === 0;
    return (
      <div className={`rounded border p-2 ${overdue && !autoStartHandlesIt ? 'border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20' : 'border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20'}`}>
        <div className="text-xs">
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            next
          </span>{' '}
          <span className="font-medium">{label}</span>
          {' · '}
          {confirmed ? (
            <span className="text-emerald-600">
              confirmed ({nextStage?.autoStart ? 'auto-start' : 'manual'}, planned {fmtDateTime(nextStage?.planned?.startsAt)})
            </span>
          ) : (
            <span className="text-amber-700 dark:text-amber-300">not yet confirmed</span>
          )}
        </div>
        {/* §6/§8 — overdue handling. Auto-start + confirmed: NO board action needed — the scheduler
            advances it on its next check (≤1 min); offer "Launch now" only as a shortcut. Manual /
            unconfirmed: a loud red call to action (pick a future date or launch now). */}
        {overdue && autoStartHandlesIt ? (
          <div className="mt-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Planned start ({fmtDateTime(nextStage?.planned?.startsAt)}) has passed — <strong>auto-start</strong> advances it on the next scheduled check (within a minute). No action needed; use <strong>Launch {label} now</strong> to start immediately.
          </div>
        ) : overdue ? (
          <div className="mt-1.5 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            ⚠ The planned start ({fmtDateTime(nextStage?.planned?.startsAt)}) is in the past. Launch {label} now, or move the start date into the future and confirm.
          </div>
        ) : plannedStartMs != null ? (
          <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
            Starts in: <span className="font-semibold text-emerald-700 dark:text-emerald-400">{untilLabel(plannedStartMs - now)}</span>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            starts
            <span className={startsBeforePrev ? 'rounded ring-1 ring-red-400 dark:ring-red-700' : ''}>
              <DateField value={startsAt} onChange={setStartsAt} />
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            ends
            <DateField value={endsAt} onChange={setEndsAt} />
          </div>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
            auto-start at the planned time
          </label>
          {editDuration ? <span className="text-xs text-neutral-500">· will last {editDuration}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() =>
              onRun(
                () => boardRoundsApi.confirmStage(roundId, nextStage?.stageKey ?? stageKey, {
                  autoStart,
                  startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
                  endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
                }),
                `${tag}-confirm`,
              )
            }
            disabled={busy !== null || !confirmValid || !nextDirty}
            className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            {busy === `${tag}-confirm` ? 'Saving…' : 'Confirm date'}
          </button>
          <button
            onClick={() => setConfirmLaunch(true)}
            disabled={busy !== null || !launchValid}
            className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
          >
            {busy === `${tag}-launch` ? 'Launching…' : `Launch ${label} now`}
          </button>
          <SavedBadge dirty={nextDirty} />
        </div>
        <Problems items={confirmProblems} />
        <ConfirmDialog
          open={confirmLaunch}
          title={`Launch ${label} now?`}
          message={`This starts the ${label} stage immediately (instead of at the planned time). The stage keeps its planned length and any later stages shift accordingly. This can't be undone.`}
          confirmLabel={`Launch ${label} now`}
          cancelLabel="Cancel"
          onConfirm={() => { setConfirmLaunch(false); void onRun(() => boardRoundsApi.launchNext(roundId), `${tag}-launch`); }}
          onCancel={() => setConfirmLaunch(false)}
        />
      </div>
    );
  }
  // FUTURE — beyond next. Re-plannable dates; no transition controls.
  const planProblems: string[] = [];
  if (!startsAt) planProblems.push('Set a start date.');
  else if (Number.isNaN(startMs)) planProblems.push('The start date is invalid.');
  else if (startMs <= now) planProblems.push('The start date must be in the future.');
  if (!endsAt) planProblems.push('Set an end date.');
  else if (Number.isNaN(endMs)) planProblems.push('The end date is invalid.');
  else if (!Number.isNaN(startMs) && endMs <= startMs) planProblems.push('The end date must be after the start date.');
  if (startsBeforePrev) planProblems.push(`${label} can't start before the previous stage ends (${fmtDateTime(prevEndsAt)}).`);
  const planValid = planProblems.length === 0;
  return (
    <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="text-xs">
        <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
          planned
        </span>{' '}
        <span className="font-medium">{label}</span>
        {' · '}
        <span className="text-neutral-500">re-plan ahead</span>
        {editDuration ? <span className="text-neutral-500"> · will last {editDuration}</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          starts
          <span className={startsBeforePrev ? 'rounded ring-1 ring-red-400 dark:ring-red-700' : ''}>
            <DateField value={startsAt} onChange={setStartsAt} />
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          ends
          <DateField value={endsAt} onChange={setEndsAt} />
        </div>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
          auto-start at the planned time
        </label>
        <button
          onClick={() =>
            onRun(
              () => boardRoundsApi.updatePlannedStage(roundId, stageKey, {
                autoStart,
                startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
                endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
              }),
              tag,
            )
          }
          disabled={busy !== null || !planValid || !planDirty}
          className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
        >
          {busy === tag ? 'Saving…' : 'Save plan'}
        </button>
        <SavedBadge dirty={planDirty} />
      </div>
      <Problems items={planProblems} />
    </div>
  );
}

/**
 * §6 — restricted round-setup editor shown once review has started (Filtering onward). Only the
 * cosmetic / UX fields are editable — round name, category DESCRIPTIONS, and the text-length limits
 * — because changing them affects no decision, fee, or vote already in play. The budget, category
 * allocations / asks, fees, approval rules, rewards, etc. stay frozen (edit them before Filtering
 * or in a new round); the schedule is adjusted under Round stage control.
 */
const SOFT_LENGTH_FIELDS: { key: 'mandatoryWords' | 'mandatoryWordsMax' | 'minimumTitleLen' | 'minimumMilestoneTitleLen'; label: string }[] = [
  { key: 'mandatoryWords', label: 'Minimum words per field' },
  { key: 'mandatoryWordsMax', label: 'Maximum words per field' },
  { key: 'minimumTitleLen', label: 'Minimum title length (chars)' },
  { key: 'minimumMilestoneTitleLen', label: 'Minimum milestone title (words)' },
];

function LockedRoundSetup({ round, onChange }: { round: RoundDetail; onChange: () => void }) {
  const [name, setName] = useState(round.name ?? '');
  const [descs, setDescs] = useState<Record<string, string>>(() =>
    Object.fromEntries(round.categories.map((c) => [c.id, c.description ?? ''])),
  );
  const [lens, setLens] = useState<Record<string, string>>(() =>
    Object.fromEntries(SOFT_LENGTH_FIELDS.map((f) => [f.key, round.settings[f.key] != null ? String(round.settings[f.key]) : ''])),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = 'rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const soft: Record<string, number> = {};
      for (const f of SOFT_LENGTH_FIELDS) if (lens[f.key]?.trim()) soft[f.key] = Number(lens[f.key]);
      await boardRoundsApi.update(round.id, {
        name: name.trim() || undefined,
        ...soft,
        // Full category objects (validation needs name + allocation); the backend applies only the
        // description in this locked phase and ignores the rest.
        categories: round.categories.map((c) => ({
          id: c.id, name: c.name, type: c.type, allocatedAda: c.allocatedAda,
          minAda: c.minAda ?? undefined, maxAda: c.maxAda ?? undefined,
          conditions: c.conditions ?? undefined, description: descs[c.id] ?? '',
        })),
      });
      setSaved(true);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        ⚠ Review has started, so the round&apos;s rules &amp; economics (budget, category allocations &amp; asks,
        fees, approval rules, rewards…) are <strong>locked</strong>. You can still edit the cosmetic fields below;
        the schedule is adjusted under <strong>Round stage control</strong>.
      </p>

      <label className="block text-sm">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Round name</span>
        <input className={`${field} mt-0.5 w-full`} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
      </label>

      <div>
        <div className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">Category descriptions</div>
        <div className="space-y-2">
          {round.categories.map((c) => (
            <label key={c.id} className="block text-sm">
              <span className="text-xs text-neutral-500">{c.name}</span>
              <textarea
                rows={2}
                className={`${field} mt-0.5 w-full`}
                value={descs[c.id] ?? ''}
                onChange={(e) => { setDescs((d) => ({ ...d, [c.id]: e.target.value })); setSaved(false); }}
              />
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">Text-length limits (UX)</div>
        <div className="space-y-2">
          {SOFT_LENGTH_FIELDS.map((f) => (
            <div key={f.key} className="flex items-start gap-2">
              <label className="w-44 shrink-0 pt-1 text-xs text-neutral-600 dark:text-neutral-300" htmlFor={`ls-${f.key}`}>{f.label}</label>
              <div className="min-w-0">
                <input
                  id={`ls-${f.key}`}
                  type="number"
                  min={0}
                  value={lens[f.key] ?? ''}
                  onChange={(e) => { setLens((l) => ({ ...l, [f.key]: e.target.value })); setSaved(false); }}
                  placeholder={String(ROUND_SETTING_DEFAULTS[f.key])}
                  className={`${field} w-24`}
                />
                <p className="mt-0.5 max-w-xl text-[11px] text-neutral-500">{ROUND_SETTING_META[f.key]}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {saved ? <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ Saved</span> : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}

function PastRow({ label, note }: { label: string; note: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-neutral-50/40 p-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40">
      <span className="rounded bg-neutral-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
        past
      </span>{' '}
      <span className="font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
      {' · '}
      {note}
    </div>
  );
}
