'use client';

import { useEffect, useMemo, useState } from 'react';
import { roundsApi, type RoundSummary } from '@/lib/api';
import { useUrlNav } from '@/lib/use-url-nav';
import { ProposalList } from './proposal-list';

/**
 * §11 — proposals of the active round, with a horizontal submenu to switch between
 * the active round and older rounds. The selected round lives in the URL (?round=),
 * defaulting to the active round when one isn't specified — so links are shareable.
 */
export function ActiveProposals() {
  const { get, setParams } = useUrlNav();
  const roundParam = get('round');
  const [rounds, setRounds] = useState<RoundSummary[] | null>(null);

  useEffect(() => {
    roundsApi.list().then(setRounds).catch(() => setRounds([]));
  }, []);

  // The URL's round if valid, else default to the active (highest-numbered) or latest round.
  const selected = useMemo(() => {
    if (!rounds) return null;
    if (roundParam && rounds.some((r) => r.id === roundParam)) return roundParam;
    return rounds.find((r) => r.active)?.id ?? rounds[0]?.id ?? null;
  }, [rounds, roundParam]);

  // Active rounds first, then older rounds (already number-desc from the API).
  const tabs = useMemo(() => {
    if (!rounds) return [];
    return [...rounds].sort((a, b) => Number(b.active) - Number(a.active) || b.number - a.number);
  }, [rounds]);

  if (!rounds) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (rounds.length === 0)
    return (
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Proposals</h2>
        <p className="text-sm text-neutral-500">No rounds yet — proposals appear once a round opens.</p>
      </div>
    );

  const hasActive = rounds.some((r) => r.active);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Proposals</h2>
        <p className="text-sm text-neutral-500">
          {hasActive ? 'Proposals in the active round. Switch rounds to browse earlier ones.' : 'No active round right now — browse proposals from earlier rounds.'}
        </p>
      </div>

      {/* Horizontal round submenu. */}
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        {tabs.map((r) => (
          <button
            key={r.id}
            onClick={() => setParams({ round: r.id, proposal: null })}
            className={`rounded-md px-3 py-1 text-sm ${
              selected === r.id
                ? 'bg-emerald-600 font-medium text-white'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            Round #{r.number}
            {r.active ? <span className="ml-1 text-[10px] uppercase opacity-80">active</span> : null}
          </button>
        ))}
      </div>

      {selected ? <ProposalList roundId={selected} /> : null}
    </div>
  );
}
