# Two-phase multisig signing — how the board moves treasury funds

The treasury is a Cardano **native-script multisig**: `atLeast M-of-N` of the board's
payment keys (currently **3-of-5**). To spend, the final transaction must carry **M
valid witnesses** over *that exact transaction*, plus the script itself.

Moving funds runs a **two-phase ceremony**. The two signatures each board member
produces are cryptographically different things, and the split is what makes a
native 3-of-5 spend assemble deterministically.

## Why two phases

A native-script tx can only be built once you know **which** M of the N keys will
sign, because:

1. **Everyone must sign the *identical* transaction** (same body hash). If the
   platform built one version and a different one got signed, no witness would be
   valid.
2. The **fee and size depend on how many witnesses** the tx carries (~100 bytes
   each). To build a correctly-priced, valid M-of-N tx the platform must commit to
   *exactly these M* signers up front — not "some M, we'll see who turns up".

So phase 1 fixes the signer set cheaply (off-chain message signatures), and phase 2
collects the real transaction witnesses from exactly those signers.

## Phase 1 — Authorize (commit)

- **What:** each board member signs a short **commit message** with their wallet
  (CIP-30 `signData`). It costs nothing, touches no funds, and is *not* a
  transaction — it only records intent.
- **Endpoint:** `POST /admin/board-actions/:id/commit` `{ signature, key, ts }`.
- **Close:** once `SIGNING_THRESHOLD (3)` members commit, the platform snapshots
  exactly those 3 payment-key hashes onto the action (`committedKeyHashes`) and the
  action moves to phase 2. From that moment the signer set is fixed.

## Phase 2 — Sign tx (witness)

- **Build:** `GET /admin/board-actions/:id/tx-body` builds the unsigned tx with
  `required_signers` = the committed 3 (and sources funds — see below). The same tx
  body is cached so all signers sign an identical hash.
- **Sign:** each committed member `signTx`s the body and submits the witness via
  `POST /admin/board-actions/:id/witness` `{ witnessHex }`.
- **Gating:** **only the 3 who authorized can sign.** The UI shows a "waiting for …"
  line to everyone else, and the API rejects any witness whose key hash isn't in
  `committedKeyHashes`. The dialog shows who authorized and who has signed, by name.
- **Combine + broadcast:** on the 3rd witness the platform combines the witnesses
  with the native script and submits via Koios `/submittx`; the action flips to
  `CONFIRMED` with the on-chain tx hash.

```
PENDING_SIGS ──(phase 1: 3 commit → keyhashes snapshotted)──▶ PENDING_SIGS (signing)
   └─(phase 2: 3 witnesses over the built tx → combine + submit)──▶ CONFIRMED
   └─(any board member cancels)──────────────────────────────────▶ FAILED
```

## Source of funds

A spend sources from its `sourceBucketId` (default: the Operations-flagged bucket).
Buckets are **separate sub-addresses**, so if the chosen bucket holds no UTxOs the
build **falls back to the primary multisig** (where funds usually sit) and persists
that choice — otherwise the combine step would attach the bucket's script to a tx
built from the primary and the chain would reject it (Missing/ExtraneousScript­
Witnesses). Change returns to the same source.

## Cancel

Any board member can cancel a pending action
(`POST /admin/board-actions/:id/cancel` `{ reason }`) → `FAILED`, which drops it from
the sign queue and the notification badge. Multiple top-ups may be queued; cancel the
unwanted ones.

## vs. a single signature

- **Why not one signature per member?** The phase-1 commit is *free and instant* (a
  message, no fee); only phase 2 produces the real on-chain witness. The extra step
  buys a deterministic signer set, which is what makes the M-of-N tx valid.
- **Why a multisig at all?** No single key can move the treasury — it needs a board
  quorum, survives one lost/compromised key, and the requirement is enforced on-chain
  by Cardano, not by trusting an operator. The tiny single-sig **hot wallet** (auto-
  generated on boot, holds only a fee float) is what *doesn't* need the ceremony.

Implementation: `apps/api/src/treasury/multisig-broadcast.service.ts`
(`commitToSign`, `prepareTxBody`, `submitWitness`, `combineAndSubmit`) +
`apps/web/src/components/board-actions.tsx`.
