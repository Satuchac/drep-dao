'use client';

import { useEffect, useState } from 'react';
import { treasuryApi } from '@/lib/api';

/**
 * §15.3 — notifications in the login rectangle. A standard red circle with the
 * number of board actions awaiting this user's signature. Click → "My area",
 * where the actions can be processed. Self-hides when there is nothing to sign.
 */
export function NotificationBadge({ onClick }: { onClick: () => void }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      treasuryApi
        .boardActions()
        .then((r) => alive && setCount(r.count))
        .catch(() => alive && setCount(0));
    poll();
    const id = setInterval(poll, 30_000); // light polling; actions are rare
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (count <= 0) return null;

  return (
    <button
      onClick={onClick}
      title={`${count} action${count === 1 ? '' : 's'} awaiting your signature`}
      className="relative flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <span aria-hidden>🔔</span>
      <span>Actions to sign</span>
      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white tabular-nums">
        {count}
      </span>
    </button>
  );
}
