'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardRoundsApi, roundsApi, type RoundDetail } from '@/lib/api';
import { ProposalCounts, StatusBadge, fmtDateTime, toLocalInput, DateField } from './round-ui';
import { CreateRoundForm } from './rounds-section';
import { ConfirmDialog } from './confirm-dialog';
import { useAuth } from '@/lib/auth-context';

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
  const [editing, setEditing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // A round's fields (name, budget, categories, settings) are editable until review starts.
  const canEdit = round.status === 'PREPARATION' || round.status === 'SUBMISSION';

  const run = async (action: () => Promise<unknown>, tag: string) => {
    setError(null);
    setBusy(tag);
    try {
      await action();
      onChange();
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
        <span className="flex items-center gap-2">
          {canEdit ? (
            <button
              onClick={() => setEditing((v) => !v)}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {editing ? 'Close editor' : 'Edit round'}
            </button>
          ) : null}
          <StatusBadge status={round.status} />
        </span>
      </div>

      {/* §6 — board edits the round's fields (name/budget/categories/settings) while pre-review. */}
      {editing ? (
        <div className="mt-3">
          <CreateRoundForm initial={round} roundId={round.id} onDone={() => { setEditing(false); onChange(); }} />
        </div>
      ) : null}

      <div className="mt-2">
        <div className="text-xs text-neutral-500">Proposals (verify readiness before advancing):</div>
        <div className="mt-1"><ProposalCounts counts={round.proposalCounts} /></div>
      </div>

      {/* §6/§8 — full schedule for the round: every stage in execution order with
          the controls that make sense for its kind (past / current / next / future). */}
      <div className="mt-3 space-y-2">
        {ALL_STAGES.map((stage, idx) => {
          // Resolve the schedule row — fall back to legacy 'debate_vote' for the Vote slot
          // (the Vote sub-stage inherited from the pre-split design when nothing was migrated).
          const row = scheduleByKey.get(stage.key)
            ?? (stage.key === 'vote' && legacyDv ? legacyDv : undefined);
          const kind: 'past' | 'current' | 'next' | 'future' =
            idx < currentIdx ? 'past'
            : idx === currentIdx ? 'current'
            : stage.status === nextStatus ? 'next'
            : 'future';
          return (
            <StageRow
              key={stage.key}
              kind={kind}
              label={stage.label}
              stageKey={stage.key}
              row={row}
              nextStage={kind === 'next' ? next : null}
              roundId={round.id}
              busy={busy}
              onRun={run}
            />
          );
        })}
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
  roundId,
  busy,
  onRun,
}: {
  kind: 'past' | 'current' | 'next' | 'future';
  label: string;
  stageKey: string;
  row: { stageKey: string; startsAt: string; endsAt: string; autoStart?: boolean; confirmedAt?: string | null } | undefined;
  nextStage: RoundDetail['nextStage'];
  roundId: string;
  busy: string | null;
  onRun: (action: () => Promise<unknown>, tag: string) => Promise<void>;
}) {
  const tag = `${kind}-${stageKey}`;
  const [startsAt, setStartsAt] = useState(toLocalInput(row?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(row?.endsAt));
  const [autoStart, setAutoStart] = useState(row?.autoStart ?? false);
  if (kind === 'past') {
    if (!row) {
      return <PastRow label={label} note="no schedule row" />;
    }
    return (
      <PastRow
        label={label}
        note={`${fmtDateTime(row.startsAt)} → ${fmtDateTime(row.endsAt)}`}
      />
    );
  }
  if (kind === 'current') {
    if (!row) return <PastRow label={label} note="no schedule row" />;
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50/40 p-2 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="text-xs">
          <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
            current
          </span>{' '}
          <span className="font-medium">{label}</span>
          {' · '}
          <span className="text-neutral-500">started {fmtDateTime(row.startsAt)} (frozen)</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            ends
            <DateField value={endsAt} onChange={setEndsAt} />
          </div>
          <button
            onClick={() => onRun(() => boardRoundsApi.updateCurrentStage(roundId, new Date(endsAt).toISOString()), tag)}
            disabled={busy !== null || !endsAt}
            className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            {busy === tag ? 'Saving…' : 'Save new end date'}
          </button>
        </div>
      </div>
    );
  }
  if (kind === 'next') {
    const confirmed = !!nextStage?.confirmed;
    return (
      <div className="rounded border border-amber-300 bg-amber-50/40 p-2 dark:border-amber-900 dark:bg-amber-950/20">
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            starts
            <DateField value={startsAt} onChange={setStartsAt} />
          </div>
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            ends
            <DateField value={endsAt} onChange={setEndsAt} />
          </div>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
            auto-start at the planned time
          </label>
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
            disabled={busy !== null}
            className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            {busy === `${tag}-confirm` ? 'Saving…' : 'Confirm date'}
          </button>
          <button
            onClick={() => onRun(() => boardRoundsApi.launchNext(roundId), `${tag}-launch`)}
            disabled={busy !== null}
            className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
          >
            {busy === `${tag}-launch` ? 'Launching…' : `Launch ${label} now`}
          </button>
        </div>
      </div>
    );
  }
  // FUTURE — beyond next. Re-plannable dates; no transition controls.
  return (
    <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="text-xs">
        <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
          planned
        </span>{' '}
        <span className="font-medium">{label}</span>
        {' · '}
        <span className="text-neutral-500">re-plan ahead</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          starts
          <DateField value={startsAt} onChange={setStartsAt} />
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
          disabled={busy !== null || !startsAt || !endsAt}
          className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
        >
          {busy === tag ? 'Saving…' : 'Save plan'}
        </button>
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
