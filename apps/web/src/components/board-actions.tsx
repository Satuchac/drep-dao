'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardActionMessage } from '@drep-dao/cardano';
import { treasuryApi, type BoardAction, type TreasuryPolicyStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** §15.3 — pending board/treasury actions the platform prepared, awaiting 3-of-5 approval. */
export function BoardActions({ onChange, history = false }: { onChange?: () => void; history?: boolean }) {
  const { profile, signMessage, signTx, getTreasuryKeyHash } = useAuth();
  const [actions, setActions] = useState<BoardAction[]>([]);
  const [past, setPast] = useState<BoardAction[]>([]);
  const [policy, setPolicy] = useState<TreasuryPolicyStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    treasuryApi
      .boardActions(history)
      .then((r) => { setActions(r.actions); setPast(r.history ?? []); })
      .catch(() => { setActions([]); setPast([]); });
    treasuryApi.policy().then(setPolicy).catch(() => setPolicy(null));
  }, [history]);
  useEffect(load, [load]);

  const confirmed = policy?.policy?.status === 'CONFIRMED';

  /** Real native-script path: fetch the unsigned spend, signTx, submit the witness (3-of-5 → broadcast). */
  const signReal = async (a: BoardAction) => {
    const { txHex } = await treasuryApi.actionTx(a.id);
    const witnessSet = await signTx(txHex);
    if (!witnessSet) {
      setError('Could not reach the wallet you logged in with — open it and try again. Nothing was signed.');
      return;
    }
    const res = await treasuryApi.signAction(a.id, witnessSet);
    if (res.status === 'BROADCASTED') setNotice(`Broadcast on-chain — tx ${res.txHash?.slice(0, 16)}…`);
    else if (res.status === 'READY') setNotice('3-of-5 reached; assembled but the chain submit failed — retry from History.');
  };

  const approve = async (a: BoardAction) => {
    setError(null);
    setNotice(null);
    setBusy(a.id);
    try {
      if (!profile) {
        setError('Connect your wallet to sign this action.');
        return;
      }
      if (confirmed) {
        await signReal(a); // native-script multisig: sign the actual transaction
      } else {
        // No on-chain policy yet → record the board member's signed approval (CIP-30 signData).
        const ts = new Date().toISOString();
        const message = boardActionMessage({
          actionId: a.id,
          kind: a.kind,
          amountAda: a.amountAda ?? 0,
          voterStakeAddress: profile.user.stakeAddress,
          ts,
        });
        const s = await signMessage(message);
        if (!s) {
          setError('Could not reach the wallet you logged in with — open it and try again. Nothing was approved.');
          return;
        }
        await treasuryApi.approveAction(a.id, { signature: s.signature, signingKey: s.key, ts });
      }
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve cancelled — nothing was recorded.');
    } finally {
      setBusy(null);
    }
  };

  const registerKey = async () => {
    setError(null);
    setNotice(null);
    setBusy('register');
    try {
      const keyHash = await getTreasuryKeyHash();
      if (!keyHash) {
        setError('Could not reach your wallet to read its payment key. Open it and try again.');
        return;
      }
      await treasuryApi.registerSigningKey(keyHash);
      setNotice('Treasury signing key registered.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not register the signing key.');
    } finally {
      setBusy(null);
    }
  };

  const assemble = async () => {
    setError(null);
    setNotice(null);
    setBusy('assemble');
    try {
      const r = await treasuryApi.confirmPolicy();
      setNotice(`3-of-5 treasury policy confirmed — ${r.address.slice(0, 24)}…`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assemble the policy.');
    } finally {
      setBusy(null);
    }
  };

  const broadcast = async (a: BoardAction) => {
    setError(null);
    setNotice(null);
    setBusy(a.id);
    try {
      const res = await treasuryApi.broadcastAction(a.id);
      if (res.status === 'BROADCASTED') setNotice(`Broadcast on-chain — tx ${res.txHash?.slice(0, 16)}…`);
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Broadcast failed.');
    } finally {
      setBusy(null);
    }
  };

  // The policy panel always shows for the board (it's the setup gate); actions may be empty.
  const showPolicyPanel = !!policy;
  if (actions.length === 0 && past.length === 0 && !showPolicyPanel) return null;

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <h3 className="text-base font-semibold">Actions to sign</h3>
      <p className="text-xs text-neutral-500">
        The platform prepared these treasury/hot-wallet actions. Each needs {policy?.required ?? actions[0]?.threshold ?? 3} of 5 board
        signatures before it can be executed on-chain.
      </p>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {notice ? <div className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</div> : null}

      {/* §15 — native-script treasury policy setup (assemble the 3-of-5 + register your key). */}
      {showPolicyPanel ? (
        <div className="rounded-md border border-neutral-200 bg-white/60 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
          {confirmed ? (
            <div className="space-y-0.5">
              <div className="font-medium text-emerald-700 dark:text-emerald-300">✓ Treasury policy confirmed ({policy!.required}-of-5)</div>
              <div className="break-all font-mono text-[11px] text-neutral-500">{policy!.policy!.address}</div>
              <div className="text-neutral-500">Approving an action now signs the real transaction in your wallet.</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="font-medium">Set up the 3-of-5 treasury (native multisig)</div>
              <div className="text-neutral-500">
                {policy!.registeredCount}/{policy!.seats.length} board members have registered a signing key.
              </div>
              <ul className="grid gap-0.5">
                {policy!.seats.map((s) => (
                  <li key={s.drepKeyHash} className="flex items-center justify-between">
                    <span>{s.name}</span>
                    <span className={s.registered ? 'text-emerald-600' : 'text-neutral-400'}>{s.registered ? 'registered ✓' : 'not yet'}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  disabled={busy === 'register'}
                  onClick={registerKey}
                  className="rounded border border-sky-500 px-2.5 py-1 text-sky-700 hover:bg-sky-50 disabled:opacity-40 dark:text-sky-300 dark:hover:bg-sky-950"
                >
                  {busy === 'register' ? 'Registering…' : 'Register my signing key'}
                </button>
                {policy!.canAssemble ? (
                  <button
                    disabled={busy === 'assemble'}
                    onClick={assemble}
                    className="rounded border border-emerald-500 px-2.5 py-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
                  >
                    {busy === 'assemble' ? 'Assembling…' : 'Assemble & confirm 3-of-5'}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {actions.length === 0 ? <div className="text-xs text-neutral-500">Nothing awaiting signatures.</div> : null}
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{a.description ?? a.kind}</span>
              {a.amountAda != null ? <span className="tabular-nums text-neutral-500">{a.amountAda.toLocaleString()} ₳</span> : null}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              {a.approvals}/{a.threshold} approvals{a.mineApproved ? ' · you approved ✓' : ''}
            </div>
            <button
              disabled={busy === a.id || a.mineApproved}
              onClick={() => approve(a)}
              className="mt-2 rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              {a.mineApproved ? 'Approved' : busy === a.id ? (confirmed ? 'Signing tx…' : 'Signing…') : confirmed ? 'Approve & sign tx' : 'Approve & sign'}
            </button>
          </li>
        ))}
      </ul>
      {/* History: past actions (executed / no longer awaiting signatures), read-only. */}
      {past.length > 0 ? (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">History</div>
          <ul className="mt-1 space-y-1">
            {past.map((a) => (
              <li key={a.id} className="rounded border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{a.description ?? a.kind}</span>
                  <span className="flex items-center gap-2 text-neutral-500">
                    {a.amountAda != null ? <span className="tabular-nums">{a.amountAda.toLocaleString()} ₳</span> : null}
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{a.status}</span>
                    {a.status === 'READY' ? (
                      <button
                        disabled={busy === a.id}
                        onClick={() => broadcast(a)}
                        className="rounded border border-amber-500 px-1.5 py-0.5 text-amber-700 hover:bg-amber-50 disabled:opacity-40 dark:text-amber-300 dark:hover:bg-amber-950"
                      >
                        {busy === a.id ? 'Broadcasting…' : 'Retry broadcast'}
                      </button>
                    ) : null}
                  </span>
                </div>
                {a.txHash ? <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-500">tx {a.txHash}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
