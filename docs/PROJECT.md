# DRep DAO — project overview (living document)

> **Keep this current.** This is the single high-level map of what the platform
> *actually does today*. Whenever behaviour, a module, a wallet, or a flow
> changes, update the relevant section here in the same change. `DESIGN.md` is the
> full spec (the "what we intend"); this file is the "what is built".
>
> **Last updated:** 2026-05-23 — added Treasury overview, board actions
> (platform-prepared multisig top-ups), and the login notification badge.

---

## 1. What it is

A Cardano governance platform for a DAO of on-chain **DReps** (CIP-1694). It runs
a recurring funding programme: DReps are admitted, proposals are submitted and
move through *Filtering → Debate & Vote → Funding*, and decisions are recorded
both off-chain (Postgres) and on-chain (transaction metadata anchors). The DAO's
money lives in a **3-of-5 native multisig treasury**; the platform reads chain
state via **Koios** and authenticates everyone with **CIP-30** wallet signatures.

Network: **Preprod** for build/test; mainnet for the MVP deployment.

## 2. Stack & layout

pnpm + Turborepo monorepo.

| Path | What |
|---|---|
| `apps/web` | Next.js (App Router) front end. CIP-30 login, all dashboards. |
| `apps/api` | NestJS API. Auth, governance logic, Cardano queries, anchoring, treasury. |
| `packages/shared` | Shared TS types/constants. |
| `packages/cardano` | Isomorphic Cardano helpers: CIP-30 verify, **anchor + governance metadata codecs**. |
| `packages/db` | Prisma schema + client (Postgres 16). |
| `docs/` | `DESIGN.md` (spec), `PROJECT.md` (this), `TREASURY.md`, `ANCHOR-WALLET.md`, `ACTORS.md`. |
| `tools/` | Node test/seed scripts + `TESTS.md` (the test cast & on-chain setup). |

## 3. Identity, roles & login

- **Login = CIP-30 `signData`.** The user signs a one-time challenge with their
  wallet's stake key; the API verifies it (CIP-8 via
  `@cardano-foundation/cardano-verify-datasignature`) and issues a JWT. No
  passwords for DAO users.
- **Roles are derived, not assigned:**
  - `BOARD` — a registered DRep whose key hash is seated in `genesis.json`
    (`BoardSeat` table). Founding board = 5 DReps (see `ACTORS.md`).
  - `DAO_MEMBER` — a registered DRep admitted by a 3-of-5 board vote.
  - Viewer/applicant — any wallet; registered-DRep status is checked live at
    login via Koios `/drep_info`.
- **Admin** is a separate username/password auth at `/admin/login` (platform
  operator), distinct from DAO wallet auth.
- The login card shows the person's display name + single status
  ("Alice — Board member"), their DRep ID, a **notification badge** (§7), and a
  link into *My area*.

## 4. Participation flows

- **Join as DAO member** (registered DReps): applicant submits a DRep profile;
  the board votes **1-member-1-vote**; 3 YES → **ADMITTED**, and the decision is
  anchored on-chain (§6). DRep on-chain metadata (CIP-119 name/image) is pulled
  into the member overview, with a generic avatar fallback.
- **Apply as Expert** (ADA holders without a DRep): board approves; expert
  provides subject-matter input. No on-chain DRep required.
- **Removal**: a member can be voted out (RemovalPanel / RemovalBanner).

## 5. Voting model

Two **graphically distinct** styles (a badge always shows which is in use):

| Style | Badge | Where |
|---|---|---|
| **1 member · 1 vote** (`1P1V`) | "1 member · 1 vote" | Admission, Filtering, Milestone review |
| **Balanced voting power** (`BAL`) | "Balanced voting power" | Debate & Vote, internal/quick polls |

Balanced power = `log10(stake) × (1 + merit/200)` — dampened stake, merit-boosted.
Tally helpers (`tallyOnePersonOneVote`, `tallyBalanced`) live in
`packages/cardano/src/governance-metadata.ts`.

## 6. On-chain anchoring — "Model C" (signed votes + one anchor)

DAO outcomes are **board-executed, not on-chain-enforced**, so we don't pay a fee
per vote:

1. **Each vote** is authenticated by a **free CIP-30 `signData` signature** over a
   canonical message (`admissionVoteMessage(...)`). The signature + signing key
   are stored; anyone can re-verify them.
2. **Each decision** produces **one** Cardano transaction whose metadata anchors
   the full result: a `sha256` over the canonical preimage **plus** a
   human-readable JSON (subject title, threshold, outcome, and the inline list of
   every voter's DRep ID + YES/NO). Anyone can parse the metadata and understand
   the decision without our DB.
   - Metadata label **80808081** (`GOVERNANCE_METADATA_LABEL`) — governance
     events. (Label `80808080` is reserved for the generic anchor codec in
     `anchor.ts`.)
   - The fee is paid by the **anchor hot wallet** (§7), never by voters.
   - Proven end-to-end on Preprod (`tools/test-anchor.cjs`): bogus signature
     rejected, real CIP-8 signature accepted/stored/re-verified, 3rd YES →
     ADMITTED → on-chain anchor with readable JSON.
- **On-chain proofs** view (left menu) lists everything anchored: human-readable
  description + Cardanoscan link, from the `Anchor` table.

## 7. Treasury & platform wallets

Full detail in **`TREASURY.md`** (model + budgets) and **`ANCHOR-WALLET.md`**
(hot-wallet security + key rotation). Summary:

- **Treasury = 3-of-5 native multisig** holding the budget. The platform shows
  its address + live balance (read-only). Funds move only with 3 board
  signatures.
- **Anchor hot wallet** = a single operator-custodied key (env `ANCHOR_MNEMONIC`
  / KMS in prod), kept at a **minimal float**, that pays the small anchor-tx
  fees. Its private key is **never** in the DB or the UI; a web compromise can't
  move funds. Rotatable via the runbook in `ANCHOR-WALLET.md`.

### How board members use the hot wallet

Board members **never handle the hot-wallet key**. They interact with it only
through *oversight* and *funding*:

- **See it** — *Treasury* and *Platform setup → Platform wallets* show the hot
  wallet address + balance and flag when it's below the top-up threshold
  (`HOT_WALLET_MIN_ADA = 100 ₳`).
- **Fund it** — when the balance is low, the **platform automatically prepares a
  top-up** as a `MultisigAction` (treasury → hot wallet, default `500 ₳`). A
  board member can also prepare one explicitly. The action then needs **3-of-5
  board approvals**.

### Notifications & board actions (the badge)

- Pending actions appear as a **red-circle badge** in the login card showing the
  count of actions *awaiting this member's signature*. Clicking it jumps to
  *My area*, where the **"Actions to sign"** panel lists each action.
- A board member **approves** an action with a **free CIP-30 signature** over a
  canonical message (`boardActionMessage(...)`); the API verifies it and records
  a `MultisigSignature`. At 3 approvals the action flips to `READY` (assembled
  native-multisig tx → broadcast is the next on-chain step).
- The panel and badge self-hide when there's nothing to sign.

## 8. Backend modules (`apps/api/src`)

| Module | Responsibility |
|---|---|
| `auth` | CIP-30 challenge/verify, JWT, `JwtAuthGuard`, `BoardGuard`, admin auth. |
| `users` | Profile, role derivation. |
| `drep` | Admission voting (Model C), DAO member overview (CIP-119 enrichment), on-chain proofs list. |
| `rounds`, `proposals`, `governance` | Funding rounds, proposals, governance config. |
| `treasury` | Treasury overview, board actions (prepare/approve top-ups), notification count. |
| `cardano` (`@Global`) | `CardanoQueryService` (Koios reads), `AnchorService` (hot wallet + anchor tx). |

## 9. Frontend views (`apps/web/src/components`)

Left nav: **DAO Member overview · My area · Rounds · On-chain proofs · Treasury ·
Platform setup** (board-only). Login card on the right with status + notification
badge.

| View / component | Purpose |
|---|---|
| `dao-overview` | DAO members with CIP-119 name/image, voting power, since. |
| `member-area` | Personal area: profile, apply/join, board panels, **Actions to sign**, voting panels. |
| `treasury-overview` | Balances + per-bucket allocated/spent/remaining bars + totals. |
| `board-actions` | Pending multisig actions; approve via `signData`. |
| `on-chain-proofs` | Anchored decisions + Cardanoscan links. |
| `governance-setup` | Board-only setup incl. Platform wallets. |
| `notification-badge` | Red-circle count in the login card → My area. |
| `voting-style-badge` | Shows 1P1V vs Balanced. |

## 10. Cardano integration

- **Reads:** Koios (`preprod.koios.rest`) — `/drep_info`, `/drep_metadata`
  (CIP-119), `/drep_delegators`, `/account_info`, `/address_info`,
  `/address_utxos`, `/epoch_params`, `/tx_metadata`, `/submittx`.
- **Tx building:** CSL v15 (`@emurgo/cardano-serialization-lib-nodejs`) — JSON
  metadata via `add_json_metadatum_with_schema(... NoConversions)`,
  `FixedTransaction.sign_and_add_vkey_signature`.
- **Codecs:** `packages/cardano` is dependency-free/isomorphic (custom utf8 length,
  no Buffer/TextEncoder) so the same message builders run in browser + Node.

## 11. Test cast & tooling

Fixed Preprod cast in `docs/ACTORS.md` / `tools/persona-wallets.json` (gitignored):
5 board (Alice, Dave, Erin, Frank, Grace), 3 voting DReps (Heidi, Ivan, Judy), 2
ADA holders (Bob = funder + dev hot wallet, Carol = dev treasury stand-in). Suites
in `tools/` (`test-all.cjs`, `test-anchor.cjs`, `test-dao.cjs`, …); see
`tools/TESTS.md`. Automated suites `delete process.env.ANCHOR_MNEMONIC` so they
don't submit real anchor txs.

## 12. Key environment config (`.env`)

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CARDANO_NETWORK`, `KOIOS_URL`,
`ANCHOR_MNEMONIC` (hot-wallet key — operator secret), `TREASURY_ADDRESS` (multisig,
display only), `REWARDS_BUDGET_ADA` / `OPERATIONS_BUDGET_ADA` (budget buckets),
optional `REWARDS_ADDRESS` / `OPERATIONS_ADDRESS` (dedicated bucket addresses).

## 13. Status & next steps

- **Done:** wallet login + roles, admission with Model C anchoring (proven on
  Preprod), DAO/expert/removal flows, voting styles + badges, on-chain proofs,
  treasury overview, platform-prepared multisig top-ups + board approvals,
  notification badge.
- **Next on-chain step:** assemble + broadcast the **native-multisig tx** once an
  action reaches `READY` (currently the platform collects 3-of-5 signed approvals;
  building/signing/submitting the actual multisig payment needs the real on-chain
  multisig set up — see `TREASURY.md`).
- **Future hardening:** move the hot-wallet key to KMS/HSM + a signing service.
