'use client';

import { useEffect, useState } from 'react';
import { drepApi, type MyDrep } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';

const LABEL: Record<string, { text: string; cls: string }> = {
  PENDING_ADMISSION: { text: 'Membership request under board review', cls: 'text-amber-600' },
  ADMITTED: { text: 'You are a DAO member ✅', cls: 'text-emerald-600' },
  REJECTED: { text: 'Membership request rejected', cls: 'text-red-600' },
  REMOVED: { text: 'DAO membership removed', cls: 'text-red-600' },
};

export function MyDrepStatus() {
  const { txUrl } = useExplorer();
  const [drep, setDrep] = useState<MyDrep | null>(null);

  useEffect(() => {
    void drepApi.mine().then(setDrep).catch(() => setDrep(null));
  }, []);

  if (!drep) return null;
  const label = LABEL[drep.status] ?? { text: drep.status, cls: '' };
  const pending = drep.status === 'PENDING_ADMISSION';

  return (
    <div className="space-y-2 text-sm">
      <h3 className="text-base font-semibold">DAO membership</h3>
      <div className={label.cls}>{label.text}</div>
      <div className="font-mono text-xs text-neutral-500 break-all">{drep.drepIdOnchain}</div>
      {drep.anchorTxHash ? (
        <div className="text-xs text-neutral-500">
          Decision anchored on-chain ✓{' '}
          <a
            href={txUrl(drep.anchorTxHash)}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            view tx
          </a>
        </div>
      ) : null}

      {pending ? (
        <div className="text-sm">
          <span className="font-medium text-emerald-600">{drep.yes}</span> of{' '}
          <span className="font-medium">{drep.threshold}</span> required YES votes
          {drep.no ? <span className="text-red-600"> · {drep.no} NO</span> : null}
        </div>
      ) : null}

      {drep.admissionVotesReceived.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs font-medium text-neutral-500">Board votes</div>
          <ul className="space-y-1">
            {drep.admissionVotesReceived.map((v, i) => (
              <li
                key={i}
                className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
              >
                <span className={v.choice === 'YES' ? 'font-medium text-emerald-600' : 'font-medium text-red-600'}>
                  {v.choice}
                </span>{' '}
                <span className="text-neutral-500">— {v.voterName}</span>
                {v.feedback ? <div className="mt-0.5 text-neutral-600 dark:text-neutral-400">{v.feedback}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : pending ? (
        <p className="text-xs text-neutral-500">No board votes cast yet.</p>
      ) : null}
    </div>
  );
}
