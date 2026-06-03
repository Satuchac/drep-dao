'use client';

import { useCallback, useEffect, useState } from 'react';
import { multisigApi, type MultisigStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CopyButton } from './copy-button';

const MULTISIG_KEY_MESSAGE = (stakeAddress: string, paymentBech32: string, ts: string) =>
  ['drep-dao | multisig key attestation', `seat:${stakeAddress}`, `pay:${paymentBech32}`, `ts:${ts}`].join('\n');

/**
 * §15 — multisig setup panel. Shows on the Treasury page so anyone can see
 * who's submitted what. Renders a per-board roster; for the logged-in board
 * member without a key, embeds the submission form (HW-wallet attestation +
 * CIP-30 challenge sign).
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

      {status.active ? (
        <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="font-semibold text-emerald-800 dark:text-emerald-200">
            ✓ Multisig assembled · {status.active.threshold}-of-{status.active.totalKeys}
          </div>
          <div className="mt-1">
            <div className="text-[11px] text-neutral-500">Script address (on-chain home)</div>
            <div className="mt-0.5 flex items-start gap-2">
              <div className="flex-1 break-all font-mono text-[11px] text-neutral-700 dark:text-neutral-300">{status.active.bech32Address}</div>
              <CopyButton text={status.active.bech32Address} label="Copy" />
            </div>
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Script hash: <span className="font-mono">{status.active.scriptHash}</span>
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded border border-amber-300 bg-amber-100/50 p-2 text-xs dark:border-amber-900 dark:bg-amber-900/30">
          <strong>Multisig not yet built.</strong> Every board seat must submit a payment verification key
          before the platform can assemble the on-chain script. Inbound / outbound treasury operations
          are not active until then.
        </div>
      )}

      {/* Per-seat roster */}
      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Board roster</div>
        <ul className="mt-1 space-y-1 text-xs">
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
    </section>
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
    if (!hardware) {
      setError('Please confirm the key is on a hardware wallet.');
      return;
    }
    setBusy(true);
    try {
      const ts = new Date().toISOString();
      const message = MULTISIG_KEY_MESSAGE(profile.user.stakeAddress, addr, ts);
      // CIP-30: sign with the wallet that holds the multisig key. This is
      // typically DIFFERENT from the wallet you're logged in with (the DRep
      // wallet). Most browser wallets sign with the active address — switch
      // wallets/accounts first if needed.
      const sig = await signMessage(message);
      if (!sig) {
        setError('Could not reach a wallet to sign. Open the HW-wallet extension and try again.');
        return;
      }
      await multisigApi.submitKey({
        paymentBech32: addr,
        hardwareAttested: hardware,
        signature: sig.signature,
        key: sig.key,
        ts,
      });
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
