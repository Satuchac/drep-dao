import { PLATFORM_CONFIG_DEFAULTS, DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';
import { HealthBadge } from './health-badge';
import { ConnectWallet } from '@/components/connect-wallet';
import { MemberArea } from '@/components/member-area';
import { RoundsSection } from '@/components/rounds-section';

const PHASES = [
  { name: 'Scaffold', detail: 'monorepo, DB schema, health — running skeleton', done: true },
  { name: 'Auth slice', detail: 'CIP-30/CIP-8 wallet login → JWT session', done: true },
  { name: 'DRep admission', detail: 'application form → board review', done: true },
  { name: 'Admin layer', detail: '/admin: genesis, admins (§18)', done: true },
  { name: 'Rounds admin', detail: 'create/configure rounds (§6)', done: true },
];

export default function Home() {
  const configCount = Object.keys(PLATFORM_CONFIG_DEFAULTS).length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">DRep DAO</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Cardano governance platform (Preprod).
      </p>

      {/* Login — primary call to action */}
      <div className="mt-6 rounded-xl border border-neutral-300 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <ConnectWallet />
      </div>

      <MemberArea />

      <RoundsSection />

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

      <div className="mt-8 border-t border-neutral-200 pt-3 text-xs text-neutral-400 dark:border-neutral-800">
        <HealthBadge /> · {configCount} params · {DEFAULT_SUBCATEGORIES.length} subcategories
      </div>
    </main>
  );
}
