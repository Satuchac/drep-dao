# Platform wallets — anchor hot wallet & treasury (secure design)

The platform pays the small Cardano tx fees for **on-chain anchors** (one tx per
governance decision — votes are signed off-chain for free; only the decision is
anchored, §C). This describes who pays, how it's funded, and how to rotate keys
safely after a compromise.

## Two wallets

| Wallet | Purpose | Custody | Balance |
|---|---|---|---|
| **Treasury** | The DAO's funds. Source of truth for budget. | **3-of-5 native multisig** (the board's hardware wallets). | Full budget. |
| **Anchor hot wallet** | Pays ~0.2 ₳ per anchor tx (and future ops txs). | A single key held by the **operator** (env var / KMS), **not** in the app DB and **never** exposed in the UI. | **Minimal** — a small float (e.g. ≤ a few hundred ₳), enough for N anchors. |

The board **sees** both addresses + live balances in *Platform setup → Platform
wallets* (read-only oversight). The hot wallet's private key is never shown or
settable through the web app — a web compromise must not be able to exfiltrate or
swap signing keys.

## Funding flow

```
Treasury (3-of-5 multisig)  ──top-up──▶  Anchor hot wallet  ──fees──▶  on-chain anchors
        ▲ board signs                         (minimal float)
        │
   (Intersect / DAO income)
```

- The board periodically tops up the hot wallet from the treasury (a normal
  3-of-5 multisig payment). The hot wallet is kept low on purpose: if it's
  drained or its key leaks, the loss is bounded to the float.
- The platform raises an alert when the hot-wallet balance falls below a
  threshold so the board can top it up before anchors start failing
  (anchoring degrades gracefully — a decision still succeeds; its anchor is
  recorded as *pending* and can be re-submitted once funded).

## Configuration

- `ANCHOR_MNEMONIC` (or, in prod, a KMS-held key) — the hot-wallet signing key,
  an **operator secret**. Dev uses a 24-word mnemonic in `.env`.
- `TREASURY_ADDRESS` — the multisig address (display + balance only).
- The platform derives the hot-wallet address from its key and shows it; the
  board confirms that address is the one they fund.

## Key rotation (compromise response)

Because the key is operator-custodied and the float is minimal, rotation is a
short, low-risk runbook — **no app/DB change can move funds**:

1. **Stop the bleeding** — operator removes/disables the old `ANCHOR_MNEMONIC`
   (anchoring pauses; decisions still record pending anchors).
2. **Provision a new key** — operator generates a fresh hot wallet (new mnemonic
   in env/KMS). The platform now derives + displays the new address.
3. **Board verifies + funds** — the board confirms the new address in *Platform
   setup* and tops it up from the treasury multisig; any residual in the old
   wallet is swept back to the treasury.
4. **Resume** — pending anchors are re-submitted from the new wallet.

No private key ever lives in the database or passes through the browser, so the
attack surface for fund theft is the operator's secret store (env/KMS) — not the
DAO app. (Future hardening: move the key to a cloud KMS / HSM and sign anchors
via a signing service; the app only requests signatures, never holds the key.)
