import { PLATFORM_CONFIG_DEFAULTS, DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import { HealthBadge } from './health-badge';
import { ConnectWallet } from '@/components/connect-wallet';
import { MemberArea } from '@/components/member-area';

const PHASES = [
  { name: 'Scaffold', detail: 'monorepo, DB schema, health — running skeleton', done: true },
  { name: 'Auth slice', detail: 'CIP-30/CIP-8 wallet login → JWT session', done: true },
  { name: 'DRep admission', detail: 'application form → board review', done: true },
  { name: 'Rounds admin', detail: 'create/configure rounds (§6)', done: false },
];

export default function Home() {
  const configCount = Object.keys(PLATFORM_CONFIG_DEFAULTS).length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">DRep DAO</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Cardano governance platform — running skeleton.
      </p>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <HealthBadge />
        <div className="mt-1 text-neutral-500">
          Shared package wired: {configCount} platform parameters,{' '}
          {DEFAULT_SUBCATEGORIES.length} default subcategories.
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <ConnectWallet />
      </div>

      <MemberArea />

      <h2 className="mt-10 text-lg font-semibold">Delivery path (§27 / §28.5)</h2>
      <ol className="mt-3 space-y-2">
        {PHASES.map((p) => (
          <li
            key={p.name}
            className="flex items-baseline gap-3 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
          >
            <span aria-hidden>{p.done ? '✅' : '⬜️'}</span>
            <span>
              <strong>{p.name}</strong>{' '}
              <span className="text-neutral-500">— {p.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
