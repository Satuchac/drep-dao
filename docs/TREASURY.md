# Treasury — model, budgets & how the board moves money

> Living doc. Update alongside any change to the treasury model, budget buckets,
> or the board-action flow. See `ANCHOR-WALLET.md` for the hot-wallet specifics
> and `PROJECT.md` §7 for the overview.
>
> **Last updated:** 2026-05-23.

## Decision: native multisig, platform-assisted

**Q: Do we use a multisig for the treasury, or something else?**
**A: A Cardano *native* script multisig — 3-of-5 of the board's DRep/payment
keys.** Reasons:

- **Right trust model.** The DAO's funds must require a quorum of the board, not
  a single operator. 3-of-5 tolerates one lost key and one unavailable signer.
- **No smart-contract risk or cost.** A native multisig (`all`/`atLeast` script)
  needs no Plutus validator, no audit, no script-execution fees — just signatures.
  (Plutarch/Aiken treasury validators were considered and rejected as
  over-engineering for a board-quorum spend; revisit only if we need on-chain
  spending *rules*, e.g. rate limits.)
- **Standard & inspectable.** Anyone can verify the policy from the script.

**Q: Set the multisig up in Eternl, or can the platform assist?**
**A: Both, by design — the platform assists, Eternl (or any CIP-30 wallet) signs.**

- **Key custody stays with the board, in their own wallets.** No private key for
  the treasury ever touches the platform DB or browser. This is the whole point of
  a multisig and mirrors the hot-wallet rule (`ANCHOR-WALLET.md`).
- **The platform assists with everything *around* the keys:**
  1. **Assemble the policy** — collect the 5 board key hashes (we already have
     them from `genesis.json` / `BoardSeat`), build the `atLeast 3` native script,
     and derive the treasury address. The board confirms it.
  2. **Prepare transactions** — when money needs to move (a hot-wallet top-up, a
     reward payout, project funding), the platform builds the unsigned tx and
     records it as a `MultisigAction`, then **notifies** the board.
  3. **Collect signatures** — each board member signs (next on-chain step: real
     witness via their wallet; today: a verified CIP-30 approval signature, §
     "Board actions"). At 3-of-5 the platform assembles the witnesses and
     broadcasts.
- **Why platform-assisted beats "do it all in Eternl":** Eternl can build the
  multisig and is a fine fallback, but it doesn't know the DAO's context (which
  payout, which round, which bucket), can't notify the right signers, and can't
  tie the spend back to a governance decision/anchor. The platform orchestrates;
  the wallet remains the only thing that holds a key.

## Budget buckets & addresses

Funding (if granted) arrives as distinct budgets, so the treasury is presented as
**buckets** (allocated / spent / remaining), each ideally with its **own dedicated
address** for clean accounting:

| Bucket | Source budget | Config |
|---|---|---|
| **Rewards** | ~600M ADA (often paid in advance) | `REWARDS_BUDGET_ADA`, `REWARDS_ADDRESS` |
| **Operations** | ~600M ADA | `OPERATIONS_BUDGET_ADA`, `OPERATIONS_ADDRESS` |
| **Round #N** | 4M ADA per round (round 1, then round 2, …) | `Round.budgetAda`, `Round.multisigAddress` |

- Each bucket falls back to the main `TREASURY_ADDRESS` until a dedicated address
  is configured, so the dashboard works from day one and tightens as addresses are
  assigned.
- **Spend is read from data, not guessed:**
  - Rewards spent = Σ `RewardEntry.amountAda` where `paidAt` is set.
  - Operations spent = Σ `MultisigAction.amountAda` where `kind = OPS` and
    `status = CONFIRMED`.
  - Per-round budgets come from the `Round` table.
- The *Treasury* view (left menu) renders each bucket as a horizontal
  allocated/spent bar plus total allocated / total spent, and shows treasury +
  hot-wallet balances live (Koios `/address_info`).

## Board actions (preparing & signing a spend)

Implemented in `apps/api/src/treasury` + `components/board-actions.tsx`:

1. **Prepare** — `MultisigAction { kind, amountAda, description, status:
   PENDING_SIGS }`. Auto-created when the hot wallet drops below
   `HOT_WALLET_MIN_ADA (100 ₳)` → top-up of `HOT_WALLET_TOPUP_ADA (500 ₳)`; or
   created explicitly by a board member.
2. **Notify** — `GET /me/board-actions` returns the pending actions + a `count` of
   those *this* member hasn't signed; that count drives the login **notification
   badge**.
3. **Approve** — `POST /admin/board-actions/:id/approve` with a CIP-30 signature
   over `boardActionMessage(...)`. The API verifies it (CIP-8) and upserts a
   `MultisigSignature` (unique per action+member).
4. **Threshold** — at `APPROVAL_THRESHOLD (3)` signatures the action flips to
   `READY`.

### Lifecycle

```
PENDING_SIGS ──(3-of-5 approvals)──▶ READY ──(assemble+broadcast)──▶ BROADCASTED ──▶ CONFIRMED
                                                                                  └─▶ FAILED
```

`PENDING_SIGS → READY` is built. **`READY → BROADCASTED` is the next on-chain
step:** turn the 3 collected approvals into real native-script witnesses and
submit the multisig payment. It's intentionally deferred until the on-chain
3-of-5 script + funded treasury exist on Preprod, because it must sign a *real*
transaction, not a message. Until then the platform proves the full
prepare → notify → 3-of-5 approve loop with verifiable signatures.

## Data model (Prisma, §24.9)

- `MultisigAction { kind, txCbor?, txHash?, status, amountAda?, description }` —
  `kind ∈ {REWARD_PAYOUT, PROJECT_FUNDING, PLEDGE_RETURN, OPS, LEFTOVER_RETURN}`.
- `MultisigSignature { actionId, boardDrepId, witnessCbor }` — unique
  `(actionId, boardDrepId)`.
- `Round { number, budgetAda, rewardsPoolAda, multisigAddress, … }`.
- `RewardEntry { amountAda, paidAt, paidInTx }`.
