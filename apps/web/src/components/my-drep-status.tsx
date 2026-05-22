'use client';

import { useEffect, useState } from 'react';
import { drepApi, type MyDrep } from '@/lib/api';

const LABEL: Record<string, { text: string; cls: string }> = {
  PENDING_ADMISSION: { text: 'Membership request under board review', cls: 'text-amber-600' },
  ADMITTED: { text: 'You are a DAO member ✅', cls: 'text-emerald-600' },
  REJECTED: { text: 'Membership request rejected', cls: 'text-red-600' },
  REMOVED: { text: 'DAO membership removed', cls: 'text-red-600' },
};

export function MyDrepStatus() {
  const [drep, setDrep] = useState<MyDrep | null>(null);

  useEffect(() => {
    void drepApi.mine().then(setDrep).catch(() => setDrep(null));
  }, []);

  if (!drep) return null;
  const label = LABEL[drep.status] ?? { text: drep.status, cls: '' };
  const noVotes = drep.admissionVotesReceived.filter((v) => v.choice === 'NO');

  return (
    <div className="space-y-2 text-sm">
      <h3 className="text-base font-semibold">DAO membership</h3>
      <div className={label.cls}>{label.text}</div>
      <div className="font-mono text-xs text-neutral-500 break-all">{drep.drepIdOnchain}</div>

      {drep.status === 'PENDING_ADMISSION' ? (
        <div className="text-xs text-neutral-500">
          Board votes so far: {drep.admissionVotesReceived.filter((v) => v.choice === 'YES').length} YES
          {noVotes.length ? `, ${noVotes.length} NO` : ''}.
        </div>
      ) : null}

      {(drep.status === 'REJECTED' || drep.status === 'REMOVED') && noVotes.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs dark:border-red-900 dark:bg-red-950">
          <div className="font-medium">Board feedback:</div>
          <ul className="ml-4 list-disc">
            {noVotes.map((v, i) => (
              <li key={i}>{v.feedback}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
