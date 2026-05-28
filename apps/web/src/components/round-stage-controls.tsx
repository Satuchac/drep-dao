'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardRoundsApi, roundsApi, type RoundDetail } from '@/lib/api';
import { ProposalCounts, StatusBadge, fmtDateTime, toLocalInput, DateField } from './round-ui';
import { CreateRoundForm } from './rounds-section';

const STAGE_LABEL: Record<string, string> = {
  SUBMISSION: 'Submission',
  FILTERING: 'Filtering',
  DV: 'Debate & Vote',
  FUNDING: 'Funding',
  CLOSED: 'Close round',
};

/**
 * §8 — board controls for advancing a round's stages. Each transition is confirmed
 * by a board member: choose auto-start at the planned date or launch early by hand;
 * the final stage (Funding) is closed manually. Self-hides when no round is open.
 */
export function RoundStageControls() {
  const [rounds, setRounds] = useState<RoundDetail[]>([]);

  const load = useCallback(() => {
    roundsApi
      .list()
      .then((list) => Promise.all(list.filter((r) => r.status !== 'CLOSED').map((r) => roundsApi.get(r.id))))
      .then(setRounds)
      .catch(() => setRounds([]));
  }, []);
  useEffect(load, [load]);

  if (rounds.length === 0) return null;

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div>
        <h3 className="text-base font-semibold">Round stage controls</h3>
        <p className="text-xs text-neutral-500">
          Confirm each next stage before it begins. Check the proposals are ready, then let it auto-start at the
          planned time or launch it early. Delays shift the new stage to start now and keep its planned length.
        </p>
      </div>
      {rounds.map((r) => (
        <RoundControl key={r.id} round={r} onChange={load} />
      ))}
    </section>
  );
}

function RoundControl({ round, onChange }: { round: RoundDetail; onChange: () => void }) {
  const next = round.nextStage;
  const [autoStart, setAutoStart] = useState(next?.autoStart ?? false);
  const [startsAt, setStartsAt] = useState(toLocalInput(next?.planned?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(next?.planned?.endsAt));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
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

      {!next ? (
        <div className="mt-2 text-xs text-neutral-500">Round complete.</div>
      ) : next.manualOnly ? (
        // Funding → CLOSED: always a manual confirmation.
        <div className="mt-3 space-y-2">
          <div className="text-xs">
            Final stage. Close the round when funding is complete — this is confirmed manually (delays expected).
          </div>
          <button
            onClick={() => {
              if (confirm(`Close round #${round.number}? This ends the round.`)) run(() => boardRoundsApi.close(round.id), 'close');
            }}
            disabled={busy !== null}
            className="rounded border border-red-500 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
          >
            {busy === 'close' ? 'Closing…' : 'Close round'}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="text-xs">
            Next stage: <span className="font-medium">{STAGE_LABEL[next.status] ?? next.status}</span>
            {' · '}
            {next.confirmed ? (
              <span className="text-emerald-600">
                confirmed ({next.autoStart ? 'auto-start' : 'manual'}, planned {fmtDateTime(next.planned?.startsAt)})
              </span>
            ) : (
              <span className="text-amber-600">not yet confirmed</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-neutral-500">
              starts
              <DateField
                value={startsAt}
                onChange={setStartsAt}
                className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
            <div className="flex items-center gap-1 text-xs text-neutral-500">
              ends
              <DateField
                value={endsAt}
                onChange={setEndsAt}
                className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
              auto-start at the planned time
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                run(
                  () =>
                    boardRoundsApi.confirmStage(round.id, next.stageKey!, {
                      autoStart,
                      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
                      endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
                    }),
                  'confirm',
                )
              }
              disabled={busy !== null}
              className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              {busy === 'confirm' ? 'Saving…' : 'Confirm date'}
            </button>
            <button
              onClick={() => run(() => boardRoundsApi.launchNext(round.id), 'launch')}
              disabled={busy !== null}
              className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              {busy === 'launch' ? 'Launching…' : `Launch ${STAGE_LABEL[next.status] ?? next.status} now`}
            </button>
          </div>
        </div>
      )}
      {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
    </div>
  );
}
