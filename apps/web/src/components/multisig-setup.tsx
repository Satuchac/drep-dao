'use client';

import { useCallback, useEffect, useState } from 'react';
import { multisigApi, type MultisigStatus, type MultisigHistoryEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CopyButton } from './copy-button';

const MULTISIG_KEY_MESSAGE = (stakeAddress: string, paymentBech32: string, ts: string) =>
  ['drep-dao | multisig key attestation', `seat:${stakeAddress}`, `pay:${paymentBech32}`, `ts:${ts}`].join('\n');

/**
 * §15 — multisig setup + rotation panel. Sections:
 *   • Status line (threshold + how many keys collected) + rotation banner
 *   • Active config card (script address, balance) — collapsible
 *   • Per-seat roster — collapsible
 *   • Submission form (only for the logged-in board member without a key)
 *   • Old multisigs (history) — collapsible; each entry shows balance + a
 *     "Migrate funds" button (board members) when balance > 0 and active
 *     config exists.
 */
export function MultisigSetup() {
  const [status, setStatus] = useState<MultisigStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    multisigApi.status().then(setStatus).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  const mySeat = status?.seats.find((s) => s.userId === profile?.user.id);

  const [showActive, setShowActive] = useState(true);
  const [showRoster, setShowRoster] = useState(true);
  const [showHistory, setShowHistory] = useState(true);

  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!status) return null;

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50/40 p-4 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Treasury multisig — setup</h3>
        <span className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
          Required: {status.threshold}-of-{status.total} · Submitted: {status.submitted}/{status.total}
        </span>
      </div>

      {/* §15.2 — rotation banner: there's an active wallet but the current
          board's keys would assemble to a different script (re-election in
          progress, or new seats need to submit). */}
      {status.rotationInProgress ? (
        <div className="mt-2 rounded border border-amber-400 bg-amber-100/60 p-2 text-xs dark:border-amber-800 dark:bg-amber-900/40">
          <strong>Rotation in progress.</strong>{' '}
          {status.allSubmitted
            ? 'All new keys collected — the platform will assemble the new multisig on the next status refresh.'
            : `${status.submitted}/${status.total} new keys collected. The current (old) multisig remains active until the new one is assembled.`}
        </div>
      ) : null}

      {/* Active assembled config (collapsible). */}
      {status.active ? (
        <>
          <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40">
            <button
              type="button"
              onClick={() => setShowActive((v) => !v)}
              className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200"
            >
              <span>✓ Active multisig · {status.active.threshold}-of-{status.active.totalKeys} · {status.active.balanceAda.toLocaleString()} ₳ on-chain</span>
              <span>{showActive ? '▾ hide' : '▸ show'}</span>
            </button>
            {showActive ? (
              <div className="px-2 pb-2 text-xs">
                <div className="text-[11px] text-neutral-500">Script address (on-chain home)</div>
                <div className="mt-0.5 flex items-start gap-2">
                  <div className="flex-1 break-all font-mono text-[11px] text-neutral-700 dark:text-neutral-300">{status.active.bech32Address}</div>
                  <CopyButton text={status.active.bech32Address} label="Copy" />
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  Script hash: <span className="font-mono">{status.active.scriptHash}</span>
                </div>
              </div>
            ) : null}
          </div>
          {/* §15.3 — bootstrap CTA: the multisig is built but holds 0 ₳.
              The platform doesn't sign for the legacy env TREASURY_ADDRESS, so
              a board member with that key has to send funds in from their own
              wallet. Once anything lands, the platform routes every inbound +
              outbound flow through this address automatically. */}
          {status.active.balanceAda === 0 ? (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="font-semibold">Bootstrap funds to start using this multisig</div>
              <p className="mt-1">
                The multisig is assembled but on-chain balance is <strong>0 ₳</strong>. Send some tADA to the
                script address above from any wallet that controls funds (e.g. the legacy treasury wallet, or any
                board member&apos;s personal wallet). Inbound flows (submission fees, pledges) already route
                here automatically — they&apos;ll pile up once proposals start.
              </p>
              <p className="mt-1 text-[11px]">
                Outbound payouts work via the standard board signing flow once {status.active.totalKeys}-of-{status.active.totalKeys}{' '}
                board members have signed via <strong>Actions → Approve &amp; sign</strong> (each click signs the
                tx with their HW wallet; the platform combines witnesses + broadcasts on the 3rd signature).
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-2 rounded border border-amber-300 bg-amber-100/50 p-2 text-xs dark:border-amber-900 dark:bg-amber-900/30">
          <strong>Multisig not yet built.</strong> Every board seat must submit a payment verification key
          before the platform can assemble the on-chain script.
        </div>
      )}

      {/* Per-seat roster (collapsible). */}
      <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setShowRoster((v) => !v)}
          className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
        >
          <span>Board roster ({status.submitted}/{status.total} keys submitted)</span>
          <span>{showRoster ? '▾ hide' : '▸ show'}</span>
        </button>
        {showRoster ? (
          <ul className="space-y-1 px-2 pb-2 text-xs">
            {status.seats.map((s) => (
              <li key={s.seatId} className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{s.displayName}</span>
                    <span className="ml-2 break-all font-mono text-[11px] text-neutral-500">{s.drepId}</span>
                  </div>
                  {s.hasKey ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                      ✓ key submitted{s.hardwareAttested ? ' · HW' : ''}
                    </span>
                  ) : (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      ⏳ awaiting key
                    </span>
                  )}
                </div>
                {s.hasKey && s.paymentBech32 ? (
                  <div className="mt-1 break-all font-mono text-[11px] text-neutral-500">{s.paymentBech32}</div>
                ) : null}
                {s.hasKey && s.keyHash ? (
                  <div className="mt-0.5 text-[11px] text-neutral-500">key hash: <span className="font-mono">{s.keyHash}</span></div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* My-seat submission form (only when I AM a board member without a key) */}
      {isBoard && mySeat && !mySeat.hasKey ? (
        <SubmitKeyForm onChange={load} />
      ) : null}
      {isBoard && mySeat?.hasKey ? (
        <div className="mt-3 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/40">
          You&apos;ve submitted your multisig key — thanks. To rotate, contact the other board members.
        </div>
      ) : null}

      {/* §15.2 — previous multisigs (collapsible). Each entry shows live
          balance + a "Migrate funds" CTA (board members only) when funds
          remain at the old address. */}
      {status.history.length > 0 ? (
        <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
          >
            <span>
              Previous multisigs ({status.history.length})
              {status.history.some((h) => h.balanceAda > 0)
                ? <> · <span className="text-amber-700 dark:text-amber-300">⚠ {status.history.filter((h) => h.balanceAda > 0).length} still hold funds — migration pending</span></>
                : null}
            </span>
            <span>{showHistory ? '▾ hide' : '▸ show'}</span>
          </button>
          {showHistory ? (
            <ul className="space-y-2 px-2 pb-2">
              {status.history.map((h) => (
                <HistoryRow
                  key={h.id}
                  h={h}
                  isBoard={isBoard}
                  pending={status.migrationsPending.find((m) => m.fromConfigId === h.id) ?? null}
                  onChange={load}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function HistoryRow({ h, isBoard, pending, onChange }: { h: MultisigHistoryEntry; isBoard: boolean; pending: { id: string; status: string; approvals: number; threshold: number } | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prepare = async () => {
    setError(null); setBusy(true);
    try { await multisigApi.prepareMigration(h.id); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };
  const hasFunds = h.balanceAda > 0;
  return (
    <li className="rounded border border-neutral-200 bg-white p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {h.threshold}-of-{h.totalKeys} multisig
          <span className="ml-2 text-neutral-500">replaced {new Date(h.replacedAt).toLocaleDateString()}</span>
        </span>
        <span className={`tabular-nums ${hasFunds ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-500'}`}>
          {h.balanceAda.toLocaleString()} ₳ on-chain
        </span>
      </div>
      <div className="mt-1">
        <div className="text-[11px] text-neutral-500">Script address</div>
        <div className="mt-0.5 flex items-start gap-2">
          <div className="flex-1 break-all font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{h.bech32Address}</div>
          <CopyButton text={h.bech32Address} label="Copy" />
        </div>
      </div>
      <div className="mt-1 text-[11px] text-neutral-500">
        Signers: {h.keyHashes.length} key{h.keyHashes.length === 1 ? '' : 's'} (need {h.threshold} to migrate)
      </div>
      {pending ? (
        <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] dark:border-amber-900 dark:bg-amber-950/40">
          Migration prepared · {pending.approvals}/{pending.threshold} old-board signatures · status: <span className="font-mono">{pending.status}</span>
        </div>
      ) : hasFunds && isBoard ? (
        <div className="mt-1 flex items-center gap-2">
          <button
            onClick={prepare}
            disabled={busy}
            className="rounded border border-emerald-500 px-2 py-0.5 text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
          >
            {busy ? '…' : 'Prepare migration to active multisig'}
          </button>
          {error ? <span className="text-red-600">{error}</span> : null}
        </div>
      ) : !hasFunds ? (
        <div className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">✓ Empty — no migration needed.</div>
      ) : null}
    </li>
  );
}

/** Board member's key-submission form: paste an HW-wallet payment address,
 *  attest HW, sign a CIP-30 challenge with that wallet, submit. */
function SubmitKeyForm({ onChange }: { onChange: () => void }) {
  const { profile, signMessage } = useAuth();
  const [paymentBech32, setPaymentBech32] = useState('');
  const [hardware, setHardware] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!profile) { setError('Connect a wallet first.'); return; }
    const addr = paymentBech32.trim();
    if (!/^addr(_test)?[a-z0-9]+$/i.test(addr)) {
      setError('Paste a Cardano payment address (addr… / addr_test…) from your hardware wallet.');
      return;
    }
    if (!hardware) { setError('Please confirm the key is on a hardware wallet.'); return; }
    setBusy(true);
    try {
      const ts = new Date().toISOString();
      const message = MULTISIG_KEY_MESSAGE(profile.user.stakeAddress, addr, ts);
      const sig = await signMessage(message);
      if (!sig) {
        setError('Could not reach a wallet to sign. Open the HW-wallet extension and try again.');
        return;
      }
      await multisigApi.submitKey({ paymentBech32: addr, hardwareAttested: hardware, signature: sig.signature, key: sig.key, ts });
      setPaymentBech32('');
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded border border-emerald-300 bg-white p-3 text-sm dark:border-emerald-900 dark:bg-neutral-900">
      <div className="text-sm font-semibold">Submit your multisig signing key</div>
      <p className="mt-1 text-xs text-neutral-500">
        Paste a payment address from your <strong>hardware wallet</strong> (Ledger / Trezor / Keystone…). This can
        be a different wallet from the one you use for your DRep identity — that&apos;s fine. The platform
        extracts the payment key hash from this address and uses it in the native multisig script.
      </p>
      <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        ⚠ Use only a hardware wallet. The platform cannot verify HW-vs-hot from the signature alone — you
        must attest below. Submitting a hot-wallet key weakens the entire multisig.
      </div>
      <label className="mt-2 block text-xs font-medium">
        Payment address (HW wallet)
        <input
          value={paymentBech32}
          onChange={(e) => setPaymentBech32(e.target.value)}
          placeholder="addr_test1… (Preprod) or addr1… (Mainnet)"
          className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      <label className="mt-2 flex items-start gap-2 text-xs">
        <input type="checkbox" checked={hardware} onChange={(e) => setHardware(e.target.checked)} className="mt-0.5" />
        <span>I attest this key is stored on a hardware wallet, not a hot/browser/file wallet.</span>
      </label>
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          disabled={busy || !paymentBech32.trim() || !hardware}
          onClick={submit}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? 'Verifying signature…' : 'Sign with HW wallet & submit'}
        </button>
        <span className="text-[11px] text-neutral-500">Your wallet will pop a sign-data request.</span>
      </div>
    </div>
  );
}
