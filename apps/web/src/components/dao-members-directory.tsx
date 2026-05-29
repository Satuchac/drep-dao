'use client';

import { useEffect, useMemo, useState } from 'react';
import { daoApi, type DaoMember, type DaoMemberDetail } from '@/lib/api';

/**
 * "DAO members" left-nav view: searchable directory of every current DAO member
 * (board + admitted DReps). Board members are sorted first and tagged. Clicking
 * a row opens the BIO + admission-vote tallies + voting power / merit details.
 */
export function DaoMembersDirectory() {
  const [rows, setRows] = useState<DaoMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    daoApi.members().then(setRows).catch((e) => setError(e.message ?? String(e)));
  }, []);

  const sorted = useMemo(() => {
    if (!rows) return [];
    const board = rows.filter((r) => r.isBoard);
    const rest = rows.filter((r) => !r.isBoard);
    // Board ordered by adjusted power; non-board same. The list endpoint already
    // sorts by adjustedPower desc — we just hoist board members to the top.
    return [...board, ...rest];
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (r) => r.displayName.toLowerCase().includes(q) || r.drepId.toLowerCase().includes(q),
    );
  }, [sorted, query]);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">DAO members</h2>
          <p className="text-xs text-neutral-500">
            Board members first, then admitted DReps. Click a row to see the full profile.
          </p>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or DRep ID…"
          className="w-72 rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
      </header>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!rows ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-neutral-500">No members match “{query}”.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
                <th className="py-2 pr-3">Member</th>
                <th className="py-2 pr-3">DRep ID</th>
                <th className="py-2 pr-3 text-right">Voting power</th>
                <th className="py-2 pr-3 text-right">Merit</th>
                <th className="py-2 pr-3 text-right">Adjusted</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <MemberRow
                  key={m.drepId}
                  m={m}
                  open={openId === m.drepId}
                  onToggle={() => setOpenId(openId === m.drepId ? null : m.drepId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MemberRow({ m, open, onToggle }: { m: DaoMember; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-800/50"
      >
        <td className="py-2 pr-3">
          <div className="flex items-center gap-3">
            <Avatar src={m.image} name={m.displayName} />
            <div>
              <div className="flex items-center gap-1.5 font-medium">
                {m.displayName}
                {m.isBoard ? (
                  <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    Board
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] text-neutral-500">
                {open ? '▾ hide profile' : '▸ show profile'}
              </div>
            </div>
          </div>
        </td>
        <td className="py-2 pr-3 font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
          {m.drepId.slice(0, 14)}…{m.drepId.slice(-6)}
        </td>
        <td className="py-2 pr-3 text-right tabular-nums">{m.votingPowerAda.toLocaleString()} ₳</td>
        <td className="py-2 pr-3 text-right tabular-nums">{m.merit}</td>
        <td className="py-2 pr-3 text-right tabular-nums font-medium">{m.adjustedPower.toFixed(2)}</td>
      </tr>
      {open ? (
        <tr className="border-b border-neutral-100 dark:border-neutral-900">
          <td colSpan={5} className="bg-neutral-50/60 px-3 py-3 dark:bg-neutral-900/40">
            <MemberDetail drepId={m.drepId} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function MemberDetail({ drepId }: { drepId: string }) {
  const [d, setD] = useState<DaoMemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setD(null);
    setError(null);
    daoApi.member(drepId).then(setD).catch((e) => setError(e.message ?? String(e)));
  }, [drepId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
      <div className="flex flex-col items-start gap-2">
        <Avatar src={d.image} name={d.displayName} size={96} />
        <div className="text-sm font-semibold">{d.displayName}</div>
        <div className="break-all font-mono text-[11px] text-neutral-500">{d.drepId}</div>
        {d.isBoard ? (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            Board member
          </span>
        ) : null}
      </div>
      <div className="space-y-3">
        <Stats d={d} />
        {d.bio ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Bio</div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{d.bio}</p>
          </div>
        ) : (
          <p className="text-xs italic text-neutral-400">No bio provided.</p>
        )}
        <Links socials={d.socials} contact={d.contact} />
      </div>
    </div>
  );
}

function Stats({ d }: { d: DaoMemberDetail }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm lg:grid-cols-4">
      <Stat label="Voting power" value={`${d.votingPowerAda.toLocaleString()} ₳`} />
      <Stat label="Delegators" value={d.delegators.toLocaleString()} />
      <Stat label="Merit" value={d.merit.toLocaleString()} />
      <Stat label="Adjusted power" value={d.adjustedPower.toFixed(2)} />
      <Stat
        label="Admission votes cast"
        value={
          d.isBoard
            ? `${d.admissionVotesCast.total} (${d.admissionVotesCast.yes} YES · ${d.admissionVotesCast.no} NO)`
            : '— (non-board)'
        }
      />
      <Stat label="Member since" value={d.since ? new Date(d.since).toLocaleDateString() : '—'} />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Links({ socials, contact }: { socials: Record<string, string> | null; contact: Record<string, string> | null }) {
  const all = [
    ...Object.entries(socials ?? {}),
    ...Object.entries(contact ?? {}),
  ].filter(([, v]) => v && v.trim());
  if (all.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Links</div>
      <ul className="mt-0.5 space-y-0.5 text-xs">
        {all.map(([k, v]) => (
          <li key={k}>
            <span className="mr-1 text-neutral-500">{k}:</span>
            <span className="font-mono text-neutral-700 dark:text-neutral-300">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Avatar({ src, name, size = 36 }: { src: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials || '?'}
    </div>
  );
}
