'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardActionMessage } from '@drep-dao/cardano';
import { treasuryApi, type BoardAction } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CopyButton } from './copy-button';
import { useExplorer } from '@/lib/explorer';

/** §15.3 — pending board/treasury actions the platform prepared, awaiting 3-of-5 approval. */
export function BoardActions({ onChange, history = false }: { onChange?: () => void; history?: boolean }) {
  const { profile, signMessage } = useAuth();
  const { txUrl } = useExplorer();
  const [actions, setActions] = useState<BoardAction[]>([]);
  const [past, setPast] = useState<BoardAction[]>([]);
  const [treasury, setTreasury] = useState<{ address: string | null; balanceAda: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // §15.3 — per-action error map so the message appears next to the button
  // the user clicked (the previous single-error state lived at the section
  // top, easy to miss when there are several actions and you've scrolled).
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    treasuryApi
      .boardActions(history)
      .then((r) => { setActions(r.actions); setPast(r.history ?? []); setTreasury(r.treasury); })
      .catch(() => { setActions([]); setPast([]); setTreasury(null); });
  }, [history]);
  useEffect(load, [load]);

  const setErr = (id: string, msg: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });
  const approve = async (a: BoardAction) => {
    setErr(a.id, null);
    setBusy(a.id);
    try {
      if (!profile) {
        setErr(a.id, 'Connect your wallet to sign this action.');
        return;
      }
      const ts = new Date().toISOString();
      const message = boardActionMessage({
        actionId: a.id,
        kind: a.kind,
        amountAda: a.amountAda ?? 0,
        voterStakeAddress: profile.user.stakeAddress,
        ts,
      });
      // A treasury approval MUST be signed by the board member's own wallet.
      // signMessage throws if the user cancels (caught below); returns null
      // only when the wallet you logged in with isn't injected (e.g.
      // extension disabled / different browser profile). Give a concrete
      // instruction in that case so the user can act.
      const s = await signMessage(message);
      if (!s) {
        setErr(a.id, 'Could not reach the wallet you logged in with. Open the wallet extension (or re-connect from the login card on the right) and click Approve & sign again.');
        return;
      }
      await treasuryApi.approveAction(a.id, { signature: s.signature, signingKey: s.key, ts });
      load();
      onChange?.();
    } catch (e) {
      setErr(a.id, e instanceof Error ? e.message : 'Approve cancelled — nothing was recorded.');
    } finally {
      setBusy(null);
    }
  };

  if (actions.length === 0 && past.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <h3 className="text-base font-semibold">Actions to sign</h3>
      <p className="text-xs text-neutral-500">
        The platform prepared these treasury/hot-wallet actions. Each needs {actions[0]?.threshold ?? past[0]?.threshold ?? 3} of 5 board
        signatures before it can be executed on-chain.
      </p>
      {/* §15 — treasury source-of-truth: address + live on-chain balance, so the
          board can see at a glance whether pending payouts can be covered. */}
      {treasury ? (
        <div className="rounded border border-neutral-200 bg-white p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          <div className="font-semibold text-neutral-700 dark:text-neutral-300">
            Treasury balance: <span className="tabular-nums">{treasury.balanceAda.toLocaleString()} ₳</span>
          </div>
          {treasury.address ? (
            <div className="mt-0.5 flex items-start gap-2">
              <div className="flex-1 break-all font-mono text-[11px] text-neutral-500">{treasury.address}</div>
              <CopyButton text={treasury.address} label="Copy" />
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-red-600">No TREASURY_ADDRESS configured.</div>
          )}
        </div>
      ) : null}
      {actions.length === 0 ? <div className="text-xs text-neutral-500">Nothing awaiting signatures.</div> : null}
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {/* Prefer the structured proposal title for PROJECT_FUNDING; fall
                    back to description (OPS / top-ups / reward payouts). */}
                {a.proposalTitle
                  ? <>Milestone #{(a.milestoneIdx ?? 0) + 1} payout — {a.proposalTitle}</>
                  : (a.description ?? a.kind)}
              </span>
              {a.amountAda != null ? <span className="tabular-nums text-neutral-500">{a.amountAda.toLocaleString()} ₳</span> : null}
            </div>
            {/* Full destination address (no truncation) + copy button. Label
                changes by action kind so it reads naturally:
                  • PROJECT_FUNDING → "Send to (team payout address)"
                  • OPS top-up      → "Send to (anchor hot wallet)"
                  • REWARD_PAYOUT   → "Send to (DRep reward address)"
                  • anything else   → "Send to (destination)" */}
            {a.destAddress ? (
              <div className="mt-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {a.kind === 'PROJECT_FUNDING' ? 'Send to (team payout address)'
                    : a.kind === 'OPS' ? 'Send to (anchor hot wallet)'
                    : a.kind === 'REWARD_PAYOUT' ? 'Send to (DRep reward address)'
                    : 'Send to (destination)'}
                </div>
                <div className="mt-0.5 flex items-start gap-2">
                  <div className="flex-1 break-all font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{a.destAddress}</div>
                  <CopyButton text={a.destAddress} label="Copy" />
                </div>
              </div>
            ) : null}
            {/* Insufficient-funds warning — server-computed against live balance. */}
            {a.insufficient && a.amountAda != null && treasury ? (
              <div className="mt-1 rounded border border-red-300 bg-red-50 p-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                ⚠ Treasury currently holds {treasury.balanceAda.toLocaleString()} ₳ — not enough to cover this {a.amountAda.toLocaleString()} ₳ payout.
                Approval at threshold will be blocked until the treasury is topped up.
              </div>
            ) : null}
            <div className="mt-1 text-xs text-neutral-500">
              {a.approvals}/{a.threshold} approvals{a.mineApproved ? ' · you approved ✓' : ''}
            </div>
            <button
              disabled={busy === a.id || a.mineApproved}
              onClick={() => approve(a)}
              className="mt-2 rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              {a.mineApproved ? 'Approved' : busy === a.id ? 'Signing…' : 'Approve & sign'}
            </button>
            {errors[a.id] ? (
              <div className="mt-1 rounded border border-red-300 bg-red-50 p-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {errors[a.id]}
              </div>
            ) : null}
            {/* §11/§15 — once the threshold is reached, the board broadcasts the
                assembled tx from their wallet and pastes the on-chain hash here.
                Backend verifies via Koios and flips the action to CONFIRMED. */}
            {(a.status === 'READY' || a.status === 'BROADCASTED') && a.destAddress ? (
              <PayoutTxVerify action={a} onChange={() => { load(); onChange?.(); }} />
            ) : null}
            {a.status === 'CONFIRMED' && a.txHash ? (
              <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-1.5 text-[11px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                ✓ PAID on-chain — <a href={txUrl(a.txHash)} target="_blank" rel="noreferrer" className="font-mono underline">{a.txHash} ↗</a>
              </div>
            ) : null}
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
                  <span>{a.proposalTitle ? `Milestone #${(a.milestoneIdx ?? 0) + 1} payout — ${a.proposalTitle}` : (a.description ?? a.kind)}</span>
                  <span className="flex items-center gap-2 text-neutral-500">
                    {a.amountAda != null ? <span className="tabular-nums">{a.amountAda.toLocaleString()} ₳</span> : null}
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{a.status === 'CONFIRMED' ? 'PAID' : a.status}</span>
                  </span>
                </div>
                {a.txHash ? (
                  <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-500">
                    tx <a href={txUrl(a.txHash)} target="_blank" rel="noreferrer" className="underline">{a.txHash} ↗</a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Tx-hash input + auto-verify against the destination address. Mirrors the
 *  pledge/fee verify pattern: 700 ms debounce on a valid 64-hex paste, then a
 *  10 s poll until Koios returns paid=true and the backend flips CONFIRMED. */
function PayoutTxVerify({ action, onChange }: { action: BoardAction; onChange: () => void }) {
  const [tx, setTx] = useState(action.txHash ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; paid?: boolean; found?: boolean; koiosAvailable?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmed = tx.trim().toLowerCase();
  const valid = /^[0-9a-f]{64}$/.test(trimmed);

  const submit = useCallback(async () => {
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      const r = await treasuryApi.submitPayoutTx(action.id, trimmed);
      setResult(r);
      if (r.status === 'CONFIRMED') onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }, [action.id, trimmed, valid, onChange]);

  // 700 ms debounce on a fresh valid paste, then 10 s polling until confirmed.
  useEffect(() => {
    if (!valid || busy) return;
    if (result?.status === 'CONFIRMED') return;
    const delay = result ? 10_000 : 700;
    const t = setTimeout(() => { void submit(); }, delay);
    return () => clearTimeout(t);
  }, [valid, busy, result, submit]);

  return (
    <div className="mt-2 rounded border border-neutral-300 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      <div className="font-semibold text-neutral-700 dark:text-neutral-300">Broadcast tx hash</div>
      <div className="text-[11px] text-neutral-500">
        After your wallet broadcasts the assembled 3-of-5 multisig tx, paste the on-chain hash here. The platform verifies the payment and flips this action to PAID.
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          value={tx}
          onChange={(e) => { setTx(e.target.value); setResult(null); }}
          placeholder="64-hex tx hash"
          className="flex-1 rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button disabled={busy || !valid} onClick={submit} className="rounded border border-emerald-500 px-2 py-0.5 text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
          {busy ? '…' : 'Verify on-chain'}
        </button>
      </div>
      {error ? <div className="mt-1 text-red-600">{error}</div> : null}
      {result ? (
        result.status === 'CONFIRMED' ? (
          <div className="mt-1 text-emerald-700 dark:text-emerald-300">✓ Verified on-chain — milestone marked PAID.</div>
        ) : !result.koiosAvailable ? (
          <div className="mt-1 text-amber-700 dark:text-amber-300">⚠ Couldn&apos;t reach Koios. Re-checking every ~10 s.</div>
        ) : !result.found ? (
          <div className="mt-1 text-amber-700 dark:text-amber-300">Tx not on-chain yet — re-checking every ~10 s.</div>
        ) : (
          <div className="mt-1 text-red-600">Tx didn&apos;t pay the destination address.</div>
        )
      ) : null}
    </div>
  );
}
