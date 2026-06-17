# DRep DAO — project overview (living document)

> **Keep this current.** This is the single high-level map of what the platform
> *actually does today*. Whenever behaviour, a module, a wallet, or a flow
> changes, update the relevant section here in the same change. `DESIGN.md` is the
> full spec (the "what we intend"); this file is the "what is built".
>
> **Last updated:** 2026-06-15 — profile & round-control polish (see §14): slimmed
> on-chain submission anchor, **post-debate content fingerprint**, proposal **title
> immutability**, **independent submitter vs DAO-member profiles** with **cross-wallet
> linking**, mandatory member contact, DAO-member **Activity** vote stats, per-stage
> **category stats**, round-control **schedule validation + Saved/Not-saved + submenu**,
> larger **auto-resized profile photos**, and a unified to-do badge. Earlier: full
> proposal lifecycle with Filtering & D&V decisions **anchored on-chain**, proposal
> **editing with versioned diffs**, **comments** (§20.1), the **milestone
> fund-distribution flow** (§11), a dedicated **submission-fee address**, and a
> **configurable block explorer**, plus the funding-round lifecycle, Treasury, board
> actions, and notification badge.

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
  passwords for DAO users. The app **remembers which wallet** you logged in with
  (so later signing re-acquires the same one, e.g. Eternl — not a random injected
  wallet), and **never records an action as signed if you cancel** the wallet prompt
  (the sign call propagates the cancellation). A **treasury approval requires a valid
  signature both client- and server-side** — `treasury.approve` rejects an unsigned
  request (no fund-moving action is ever recorded without a real board signature).
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
- **Entry gate (§14.1, configurable on-chain).** Two independently-toggled groups,
  both **OFF by default** (testnet entry stays open; enable on mainnet). The **JOIN
  DAO** button (`join-dao-button.tsx`, fed by `GET /me/entry-eligibility`) is active
  when eligible, otherwise disabled with a note listing the unmet requirements; the
  same check is enforced server-side in `DrepService.apply` (not just the button).
  **Group A — voting power** (`ENTRY_REQUIRE_VOTING_POWER`): meet `MIN_OWN_VOTING_POWER_ADA`
  (own stake self-delegated) **OR** at least `MIN_DELEGATORS` delegators each ≥
  `MIN_DELEGATOR_STAKE_ADA`. **Group B — activity** (`ENTRY_REQUIRE_ACTIVITY`): voted
  on ≥ `MINIMUM_DREP_ACTIVITY`% of the last `MINIMUM_VOTES_CASTED` governance actions
  (only votes with a rationale if `ONLY_VOTES_WITH_RATIONALE`). Metrics are read live
  from Koios (`CardanoQueryService.drepEntryMetrics` via `/drep_delegators`+`/account_info`;
  `drepActivityMetrics` via `/proposal_list`+`/drep_votes`). Booleans are first-class in
  Platform setup (Enabled/Disabled dropdowns); each gated param is **grouped under its
  switch** (`↳`, left accent) and **shadowed/disabled when the switch is off**, so it's
  clear which switch governs which params and whether they're applied. The same minimums
  also drive an **ongoing health flag**: `listDaoMembers` returns `meetsEntryRequirements`
  per member = passes every **enabled** gate, and the overview shows a **⚠ below minimum**
  badge when false (full voting rights kept — informational). **Power gate** (when
  `ENTRY_REQUIRE_VOTING_POWER` on): own power ≥ min OR ≥ min qualifying delegators — **board
  exempt** (genesis-seated). **Activity gate** (when `ENTRY_REQUIRE_ACTIVITY` on): voted on
  ≥ `MINIMUM_DREP_ACTIVITY`% of the last `MINIMUM_VOTES_CASTED` governance actions —
  **applies to everyone incl. board** (computed via `drepActivityMetricsBatch`, only when
  the gate is on). Both gates off ⇒ no flag.
- **Apply as Expert** (ADA holders without a DRep): board approves; expert
  provides subject-matter input. No on-chain DRep required.
- **Removal**: a member can be voted out (RemovalPanel / RemovalBanner). A resolved
  3-of-5 removal is **anchored on-chain** (`DrepService.anchorRemoval` →
  `GovSubject.REMOVAL`, like admission) so it appears in *On-chain proofs* as
  "Removal of a DAO member".

## 4a. Funding rounds & stage flow (§5/§6/§8)

A round runs **PREPARATION → SUBMISSION → FILTERING → DV → FUNDING → CLOSED**.

- **Creation (board).** Categories are **GRANT** or **RFP**, each with a name,
  allocation, description, **conditions**, and a **min/max funding-request per
  proposal** (§5.2; blank = no bound, min ≤ max enforced). A round can only be created
  once its categories **allocate the full budget** (P4), and any schedule windows must
  run **in order and not overlap** (P7) — validated both client-side and in the API. **The Create
  button stays disabled until everything is complete** (round name, every category's
  name + description + allocation, full budget, and all four stage windows set and
  valid), with a "still needed" hint listing what's missing. The schedule uses a
  **month-name** date+time picker (not numeric `mm/dd`), shows a **red warning** the
  moment an end is at/before its start (or a stage starts before the previous ends),
  and shows the **duration** (days/weeks/months) once a window is valid.
- **Per-round settings (round setup, not platform setup).** Most tunables are set
  **per round** and stored on the round (null column ⇒ the `ROUND_SETTING_DEFAULTS`
  fallback in `@drep-dao/shared`): filtering/milestone **reviewer counts +
  approvals** (an approval count may not exceed its reviewer count — enforced in
  `RoundsService.assertSettings` and capped in the form), the **D&V threshold**,
  submission **fees** (commercial/OSS % + ADA caps, and `feeCapPerRoundAda` which
  caps the filtering reward pool), **quick-poll** settings, **milestone timing**,
  and the **proposer pledge**. Review & approval fields are ordered to the flow
  (Filtering → D&V → Milestone), and every field shows its explanation inline. The
  **reward split** uses **three sliders** — `rewardExpertSharePct` (experts' direct
  cut, subtracted from the pool first; DReps vs experts), then on the DReps' pool
  `rewardDvSharePct` (D&V vs milestone review) and `rewardFixedPct` (within D&V: fixed
  vs bonus) — with a live bar visualising the four-way split (experts / D&V fixed /
  D&V bonus / milestone) in ADA + %.
  `PLATFORM_CONFIG_DEFAULTS` (Platform setup) holds only genuinely global params
  (admission votes, internal thresholds, eligibility minimums, merit cap, anchor
  cron, explorer).
- **Platform-param wiring status.** Saved edits always persist; whether they *do*
  anything depends on the feature. **Wired (applied at runtime):** `ADMISSION_APPROVAL_VOTES`
  (admission + removal threshold), the `ENTRY_REQUIRE_*` gate + its 6 params (§14.1),
  `MERIT_POINT_MAX` (voting-power merit cap — read live in the overview + D&V snapshot),
  `CARDANO_EXPLORER`. **Not yet wired (stored but no consumer — feature pending):**
  `INTERNAL_*_THRESHOLD_PCT` (§10 internal proposals), `AVOID_PERIOD_MAX_DAYS_PER_YEAR`
  (availability), `BOARD_REWARD_DEADLINE_DAYS` (§13 reward penalty), `ANCHOR_SCHEDULE_CRON`
  (informational — anchoring is on-demand). These show a **⏳ not yet wired** note in
  Platform setup so the board isn't misled.
- **Round page shows the round's setup.** Drilling into a round renders its
  resolved per-round settings (value or `(default)`) + the reward-distribution bar
  above its proposal list.
- **Board can enforce anchor submission (§18).** On *On-chain proofs*, board members
  see **Submit on-chain** per pending anchor and **Submit all pending** — for records
  that were computed but never reached the chain (hot wallet unconfigured/offline at
  the time). `AnchorService.submitPending` rebuilds the metadata from the stored
  preimage (same `proofHash`) and posts one tx; board-guarded `POST /admin/proofs/:id/submit`
  + `/submit-all`. **Batch submit chains UTxOs:** the hot wallet usually holds one
  UTxO and Koios's `/submittx` is load-balanced + lags the mempool, so `submitAllPending`
  fetches UTxOs once and threads each tx's change into the next input, with a short
  delay so the parent propagates across relays first (otherwise only the first tx lands).
  Balanced voting power is fractional but tx metadata forbids floats, so
  `buildResultMetadata` rounds every numeric field to an integer (full precision stays
  in the hashed preimage) — this also unblocks D&V anchors that previously failed to submit.
- **Stage transitions are board-confirmed (single board member).** From *My area →
  Round stage controls* a board member, for the next stage, checks the proposal
  counts (readiness), confirms the date, and chooses **auto-start at the planned
  time** or **launch now** (early). The final stage (Funding → CLOSED) is **always
  closed manually** — delays are expected.
- **Delays preserve duration.** When a stage starts off its planned time, its
  window shifts to start now and keeps its planned length (the original start is
  recorded in `prolongedFrom`).
- **Auto-start scheduler.** A dependency-free interval (`RoundsSchedulerService`,
  `setInterval`, disabled by `ROUNDS_SCHEDULER_DISABLED=1` in tests) advances any
  round whose confirmed, auto-start next stage is due. The §5.1 single
  reviewing-stage rule still holds — only one round may be in Filtering **or**
  Debate & Vote at a time (conflicts are retried/left for manual launch).
- **Proposals** move DRAFT → PENDING → ACTIVE → (FILTERING/DEBATE_VOTE) →
  APPROVED/REJECTED → FUNDING/COMPLETE/FAILED. The Rounds overview (list **and**
  `get`) shows **per-status counts for every status, including DRAFT and PENDING**,
  so you can see how a round is filling up. The **content** of a DRAFT/PENDING
  proposal stays **private** — visible only to its submitter (excluded from the
  public proposal listings + detail); a proposal becomes publicly browsable only
  once its fee is confirmed (ACTIVE+). The counts are a tally, not a content leak.

## 4b. Proposal lifecycle — fees, filtering, D&V, editing, milestones (§7/§8/§11/§12/§16/§20)

- **Milestones (§3).** Each milestone has four parts: **title**, **requested budget**
  (the field right under the title), **description**, and **acceptance criteria**
  (`milestone.title`/`acceptanceCriteria` columns). The milestone budgets must sum to the
  requested amount. Title + description are required to submit; acceptance criteria is
  optional. Shown (title + budget + description + acceptance criteria, markdown-rendered)
  on the proposal detail and milestone-review panels.
- **Submission fields (§3.4/§5.2).** A funding proposal captures title, pitch, requested
  amount, commercial flag, milestones (must sum to the request), and the §3.4 detail —
  **cost breakdown, team info, revenue sharing** (markdown, in the existing Json/text
  columns) — plus **expertise tags** (`subcategoryIds`, which drive the §7.1 filtering
  draw). The **requested amount must fit the selected category's min/max ask**: enforced
  in `ProposalsService.createDraft` (and validated client-side, with the range shown in
  the form). The detail view shows the ask range, conditions, and the §3.4 sections.
- **Submission form UX.** The **Category** picker is labelled and appears only once a
  **Round** is chosen; if exactly one round is in Submission it's preselected. The form
  shows a live **"still needed" checklist** (round, category, title, pitch, in-range
  amount, milestone descriptions, milestone sum) and **disables Submit/Save Draft until
  it's clear** — including a live milestone-budget line that flags when the milestones
  don't sum to the requested amount. Long markdown fields (pitch, cost breakdown, team,
  revenue sharing, and each milestone's description + acceptance criteria) use a shared
  **`MarkdownEditor`**: a labelled header, a formatting toolbar
  (heading/bold/italic/bullet+numbered lists/link), a Write/Preview toggle, a
  Taller/Shorter height toggle, and a **Shrink** button that **collapses the field to
  just its name** (content hidden, with a "✓ filled / empty" hint) so a long form stays
  navigable — click the name to expand again. Optional fields start collapsed. Markdown
  is rendered for real in the
  proposal detail via a small **dependency-free, XSS-safe renderer** (`lib/markdown.ts`
  → `<Markdown>`): the source is HTML-escaped first and only a safe tag subset is
  emitted, with link hrefs restricted to http(s)/mailto.
- **Submission fee (§12/§16).** Commercial / open-source fee % comes from the **round's
  settings** (defaults 3% / 1%, capped). The submit form resolves the fee for the chosen
  type and **only shows the fee instructions + tx-hash field when that fee is > 0** — so
  toggling **Commercial** can reveal/hide the tx field. **If the applicable fee is 0%,
  no payment is needed and the proposal goes ACTIVE (public, in Filtering) immediately on
  submit** — no PENDING, no board fee confirmation. Otherwise it needs the on-chain fee
  tx hash and moves to PENDING. The submitter can **change the tx hash while PENDING**;
  every distinct hash entered is kept in **`submissionFeeTxHashes`** so the board reviewer
  sees them all (the tx locks once ACTIVE). **Board fee review** (`reviewFee`,
  `POST /admin/proposals/:id/review-fee`): the panel shows each entered tx with its own
  on-chain `verifyPayment` result; the reviewer **Approves** (→ ACTIVE/Filtering) or
  **Rejects** (→ REJECTED, reason required) with feedback the submitter sees in a red
  **FEEDBACK** box next to the fee tx (`feeReviewFeedback`).
- **Fee integrity + budget changes (§12).** The fee-determining inputs — **requested amount
  + commercial flag — are locked once a fee is quoted** (anything past DRAFT / fee-rejected):
  `updateDraft` rejects changing them, so a submitter can't quote+pay a small fee then raise
  the budget for free (the form disables those inputs while PENDING). A fee-rejected proposal
  (no accepted payment) stays freely editable. **Once ACTIVE**, the submitter changes the
  budget via **`requestBudgetChange`** (`POST /proposals/:id/budget-change`): the amount +
  milestones update immediately and the **fee delta becomes a settlement** — an **increase**
  owes a **TOPUP** (submitter pays more), a **decrease** a **REFUND** (DAO returns) — recorded
  as a `FeeAdjustment` (storing prev/new amount **and** prev/new total fee). The board settles
  it in **My Area → Actions** (alongside treasury approvals + fee confirmations; `GET/POST
  /admin/proposals/payments…`): each item shows the **old → new fee**, the budget change, and —
  for a refund — the submitter's **payout address with a copy button**; the board records the
  on-chain **tx** to mark it SETTLED. Pending settlements count toward the **notification badge**.
  The Actions tab has a **To do / Recent / History** toggle (default *To do*; same control as
  Voting & reviews): *History* lists **settled** settlements + **executed** treasury actions
  (read-only, with tx) for auditing (`?history=1` on `/admin/proposals/payments` +
  `/me/board-actions`); *To do* / *Recent* show the live to-dos (the board-action panels are
  pending/done, so Recent currently mirrors To do).
- **Payout / refund address (§12).** A proposal carries a `payoutAddress` (Cardano address)
  the submitter enters in the form — where the DAO sends **fee refunds** and the **funded
  budget**. It's shown read-only near the bottom of the proposal detail (with a copy button)
  and is editable wherever the proposal is editable.
- **Acceptance anchor (§3/§12).** The moment a proposal first becomes **ACTIVE** — board
  approved the paid fee, or no fee was required — it's assigned a **unique structured
  proposal id** (`publicId`, e.g. `R6-P3`, frozen on the row + shown in the UI) and an
  **on-chain anchor** is written (label 80808081, subject `submission`,
  `AnchorService.anchorSubmission` → `buildSubmissionMetadata`) recording the **proposal id**,
  the **submitter** (their DRep id, or stake/wallet address if not a DRep), the **requested**
  funding amount (ADA, rounded), and the **fee facts** `{ada, txHash}` (the tx that paid the
  fee). Shows in *On-chain proofs* as "Funding proposal accepted"; best-effort + re-submittable
  like every anchor. The proposal detail also shows the **submission date** (`submittedAt`).
  From *My proposals* a draft row has
  **Edit** (reopens the full form pre-filled — all fields incl. milestones, via
  `PATCH /proposals/:id`) and **Submit** (submit later), alongside its "DRAFT · private"
  status. The detail/read view of a private proposal is reachable by its **owner** via
  optional auth (`OptionalJwtAuthGuard` on the public `GET /proposals/:id` passes the
  signed-in user's id to `get()`, which only reveals DRAFT/PENDING to their submitter).
  The **fee tx hash is saved with the draft** (`submissionFeeTxHash` accepted by
  create/update, persisted in DRAFT, prefilled when editing) so it survives a save —
  but it is still only an unverified note until submission: the board's fee-confirmation
  panel runs the on-chain `verifyPayment` check on the PENDING proposal before confirming. The **platform verifies the fee on-chain**: `listPendingFee`
  runs `CardanoQueryService.verifyPayment(txHash, SUBMISSION_FEE_ADDRESS, feeLovelace)`
  (Koios `/tx_info`, sums outputs to the fee address) and shows the board a
  ✓paid / ✗underpaid / ⏳not-found hint in *My area → "Submission fees to confirm"*.
  The board confirms → PENDING → ACTIVE in Filtering, making the proposal public.
- **Filtering (§7).** Reviewers are drawn from the round's admitted DReps; each
  casts 1p1v (NO needs rationale). ≥`FILTER_APPROVAL_VOTES` YES → Debate & Vote,
  ≥ that many NO → REJECTED. **The decision is anchored on-chain** (subject
  `filtering`, with every reviewer's choice + rationale).
- **Debate & Vote (§8).** Balanced voting power (snapshot at open), rationale
  mandatory (≥200 chars), threshold default 67%. The board's **publish/finalize
  anchors the final tally on-chain** (subject `dv`).
- **Editing & versions (§7/§8).** **Pre-public states — DRAFT, PENDING (awaiting fee
  confirmation), and a fee-REJECTED proposal — are edited in the full proposal form** (all
  fields, incl. milestones + the fee tx). The **requested amount + commercial flag lock once
  a fee is quoted** (PENDING) — only DRAFT / fee-rejected can change them; a fee-rejected
  proposal can be fixed and **Re-submitted** (→ PENDING/ACTIVE, clearing the old feedback).
  Edits in these states aren't versioned. Once public (Filtering / Debate & Vote before
  voting opens), the detail editor revises **every descriptive field — title, pitch, cost
  breakdown, team, revenue sharing, expertise tags** (the **budget** is fee-coupled and
  changes via *Request a budget change*); each edit snapshots the prior content into
  `ProposalVersion` and the detail shows an **original-vs-updated line diff**. No edits during
  the D&V voting phase or after a decision.
- **Milestone funding (§11).** After D&V approval the board draws + confirms
  reviewers; the submitter posts a Proof of Achievement per milestone; reviewers
  vote 1p1v (2-of-3 closes; NO needs feedback; resubmission re-opens review).
  **Each milestone decision is anchored on-chain**; when all milestones are
  approved the proposal is COMPLETE; the board can terminate → FAILED. Real ADA
  disbursement is deferred to the on-chain treasury multisig.
- **Comments (§20.1).** Public, one level of replies, 5-minute edit window,
  tombstone delete; attributed by display name + DRep ID.
- **On-chain links** everywhere route through a configurable explorer. There's a
  platform default (`CARDANO_EXPLORER`) **and a per-member preference** set in *My
  area → Preferences* (`GET/PATCH /me/preferences`, stored on `AppUser`); the
  frontend layers the member's choice over the public `GET /config` default.
- **Proposal detail view** shows it all: content, the version diff, Filtering and
  D&V results with **public rationales** + on-chain proof links, milestones (with
  POA + reviewer voting), and comments.

## 4c. Internal proposals (§10)

DAO-governance decisions — process/parameter/board changes, polls — **not tied to a
round**. Left nav: **Internal proposals** (the funding queue is now **Funding
proposals**). `InternalProposalsModule` (`/internal-proposals`); they reuse the unified
`proposal` table (`type=INTERNAL`) + the D&V snapshot/§4.4 tally machinery.

- **Submit → ACTIVE immediately** (no fee/pledge, no PENDING); voting opens at once.
  Structured id **`Internal N`**. Lifecycle DRAFT→**ACTIVE→APPROVED/REJECTED** (we submit
  straight to ACTIVE).
- The submitter sets: **type** (INSTRUCTIVE names actors / INFORMATIVE yes-no / **POLL**
  with options + single-or-multi select); **who votes** (`DREPS_ONLY` non-board /
  `BOARD_ONLY` / `BOTH`); **voting type** (1 member-1 vote *or* adjusted voting power);
  **threshold** (`DEFAULT`=`INTERNAL_DEFAULT_THRESHOLD_PCT` / `IMPORTANT`=`…IMPORTANT…`);
  **voting period (days)** → start+end; and **PUBLIC vs PRIVATE** (board-only visibility,
  which forces board-only scope). Title + content are always present (content too for polls).
- Threshold proposals pass per **§4.4** (`isApproved`); polls tally **per option**. Eligible
  voters + power are **snapshotted at submission**. **Vote change** allowed during the period;
  the submitter may **move the voting end** but never edit the content while voting.
  Auto-concludes when the end passes (on any read/vote).
- **Anchored on-chain** (`anchorResult` subject `internal`, label 80808081) with the
  `publicId` (`Internal N`), each voter's DRep id + choice, and a **date-independent
  `docHash` = sha256(title+content)** (the date is deliberately not hashed, since the end can move).
- Test: `tools/test-internal.cjs`.

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

Left nav: **DAO Member overview · My area · Rounds · Proposals · On-chain
proofs · Treasury · Platform setup** (board-only). Login card on the right shows
the name (top) + role/status (below) + notification badge.

**URL-driven navigation (`lib/use-url-nav.ts`).** The single-page shell syncs its
navigation into the URL query string so every screen has a **shareable link** and the
browser back button works: `?view=` (left menu), `?tab=` (My-area submenu),
`?round=` (Proposals/Rounds round selection), and `?proposal=<id>`. A `?proposal=<id>`
link is rendered at the shell level on top of any view, so a proposal URL shows the
same proposal page for whoever opens it (public proposals are world-readable). Switching
a left-menu item clears the submenu params. `app/page.tsx` wraps the shell in `<Suspense>`
(required for `useSearchParams`).

| View / component | Purpose |
|---|---|
| `dao-overview` | DAO members with CIP-119 name/image, voting power, since. Every column is **click-to-sort** (asc/desc), default adjusted-power desc. When `ENTRY_REQUIRE_VOTING_POWER` is enabled, a member under the §14.1 minimum (own power / qualifying delegators) shows a **⚠ below minimum** badge but stays a full voting member (board exempt); no flag when the gate is off. |
| `member-area` | Personal area: profile, apply/join, board panels, **Actions to sign**, **Round stage controls**, voting panels. |
| `rounds-section` | Rounds list (status, active/complete, per-status proposal counts); click a round → its proposals. |
| `active-proposals` | A round's proposals, picked with a **round combo box** (scales to many rounds) that defaults to the **latest round still in the Submission phase**. Each row shows the proposal title + **submitter** + status. |
| `proposal-detail` | Full read-only view for everyone: title + **submitter**, labelled metadata (**Proposal ID: R5-P1 · Stage: … · Status: …**), category/amount/fee, and **collapsible** sections (pitch, §3.4 cost/team/revenue, category conditions, milestone plan — title/budget/description/acceptance) that shrink/expand like the form. Every section renders for any viewer; only the author additionally sees edit/budget-change/fee controls. |
| `round-stage-controls` | Board-only: confirm/auto-start/launch each next stage + close the round. Also an **Edit round** button (Preparation/Submission only) that opens the round form pre-filled to change name/budget/categories/settings (`PATCH /admin/rounds/:id`); category edits reconcile by id so proposals aren't orphaned, and a category with proposals can't be removed. |
| `proposal-list` / `round-ui` | Shared proposal list + status badges / count chips / date helpers. |
| `treasury-overview` | Balances + per-bucket allocated/spent/remaining bars + totals. |
| `board-actions` | Pending multisig actions; approve via `signData`. |
| `on-chain-proofs` | Anchored decisions + Cardanoscan links. |
| `governance-setup` | Board-only setup: per-parameter descriptions + Platform wallets. Columns: **New value** (editable combo/input) + **Saved** (current persisted value, refreshes after Save, with a `(default …)` hint). Booleans edit as Enabled/Disabled. Params not yet read by any feature show a **⏳ not yet wired** note. |
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

**Unit tests (`vitest`):** `pnpm test` (turbo) runs the package suites — currently
`packages/cardano` (on-chain metadata builders: slim submission anchor + the
post-debate content-fingerprint anchor) and `apps/api` (cross-wallet profile-link
resolution; mandatory Telegram/email contact validation). Spec files live next to
the code as `*.spec.ts` and are excluded from the build/typecheck tsconfigs.

## 12. Key environment config (`.env`)

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CARDANO_NETWORK`, `KOIOS_URL`,
`ANCHOR_MNEMONIC` (hot-wallet key — operator secret), `TREASURY_ADDRESS` (multisig,
display only), `REWARDS_BUDGET_ADA` / `OPERATIONS_BUDGET_ADA` (budget buckets),
optional `REWARDS_ADDRESS` / `OPERATIONS_ADDRESS` (dedicated bucket addresses).

## 13. Status & next steps

- **Done:** wallet login + roles, admission with Model C anchoring (proven on
  Preprod), DAO/expert/removal flows, voting styles + badges, on-chain proofs,
  treasury overview, platform-prepared multisig top-ups + board approvals,
  notification badge, **funding-round lifecycle** (budget/schedule validation,
  board-confirmed stage transitions with auto-start/manual launch + delay shift,
  auto-start scheduler, manual round close), **Rounds list** + **Active-proposals**
  browser with per-status counts.
- **Next on-chain step:** assemble + broadcast the **native-multisig tx** once an
  action reaches `READY` (currently the platform collects 3-of-5 signed approvals;
  building/signing/submitting the actual multisig payment needs the real on-chain
  multisig set up — see `TREASURY.md`).
- **Future hardening:** move the hot-wallet key to KMS/HSM + a signing service.

## 14. Recent additions (2026-06-15)

**On-chain anchoring**
- **Slim accepted-proposal submission anchor** (§3): the `fee` object carries only
  `{ ada, txHash? }` — the boolean-string `required`/`paid` flags, the generic
  `subject`, and the redundant `proofHash` are gone; `title` is the proposal's own
  title. `metadataFromAnchor` + the proofs viewer still read older anchors.
- **Post-debate content fingerprint** (§8.1): when Debate ends (round enters VOTE),
  each frozen proposal's canonical textual form is SHA-256 hashed and anchored
  (`GovSubject.PROPOSAL_DOC`, `buildDocHashMetadata`, `AnchorService.anchorProposalDoc`,
  idempotent). The proposal detail shows the exact text + hash + hash function + the
  on-chain tx so anyone can re-hash and verify.

**Member area (My Area)**
- **Comment colour by author class (§20).** A proposal comment is tinted by who wrote it: **Expert
  → violet**, **DRep / DAO member / board member → grey** (voting-eligibility no longer affects the
  colour); replies stay yellow, deleted neutral. The role labels (Expert / DRep / Board member) are
  unchanged. The classifier is the pure, unit-tested `commentAuthorTone(role)` in `@drep-dao/shared`.
- **Approved experts can always comment (§20).** Fixed a bug where an approved expert was blocked
  from posting comments: the composer gate checked a non-existent `'EXPERT_APPROVED'` role, but an
  approved expert's role is `'EXPERT'` (granted only once the board approves them and they haven't
  left). The rule is now the pure, unit-tested `canCommentOnProposal(roles, isTeamMember)` in
  `@drep-dao/shared` (team + board/DRep/DAO-member/EXPERT may post; viewers read only). The backend
  comment-create endpoint never role-gated, so this was purely the frontend composer.
- **Open all / Shrink all when viewing a proposal:** the read-only proposal detail now has a page-
  level "▣ Shrink all / ▾ Open all" toggle (parity with the edit form), so a DRep/viewer can collapse
  or expand every section (Pitch, Milestones, KPIs, …) at once. `CollapsibleView` listens to the same
  `MarkdownCollapseContext` expand/collapse signals the form's editors use; individual section
  toggles still work between global clicks.
- **Submitter rejection notice (§7.4/§16):** when a proposal is **rejected** in a way the submitter
  can act on — rejected by the filtering jury (while the round is still in FILTERING) or at the fee
  review (during SUBMISSION) — its My-proposals row shows a **red "…revise & resubmit" chip** and the
  **My proposals** tab gets a **notification badge** (which also rolls up into the login-box bell +
  left-nav count). The label-generation is the pure `rejectedProgress` (`proposal-progress.ts`,
  unit-tested); `useTodoCounts` counts red rows whose label contains "resubmit" (filtering / fee /
  rejected-milestone-POA). Final rejections (Debate & Vote, or a filtering rejection after the round
  advanced) show red but aren't badged — nothing to do.
- **Proposal search everywhere:** every proposal list — Voting & reviews, Actions, the round
  proposal list, and Internal proposals — has a search box that filters by **proposal Title**,
  **Proposer name**, or **public Proposal ID** (case-insensitive; each whitespace term must
  match some field, so "tool great" finds "Dave's great tool"). The pure matcher lives in
  `@drep-dao/shared` (`matchesProposalSearch`, unit-tested in `packages/shared`) and is
  re-exported from the web `api.ts`. To carry the proposer name + public id into the
  reviewer-facing lists, `GET /me/assignments/filter` and `/me/assignments/milestone` now
  return `proposer` (+ `publicId` / `proposalPublicId`). Reward-payout board actions carry no
  single proposer/public-id, so they match on title + description + recipient names; the paged
  fee history filters the rows currently loaded.
- **Filtering To do / Recent are disjoint by vote:** *To do* = assignments in an active filtering
  round the reviewer **hasn't** voted on; *Recent* = ones they **have** voted on (still changeable
  while the round stays in filtering); *History* = past-filtering rounds. A "not voted yet" item is
  only ever in To do, never Recent (`FilteringService.myAssignments`).
- **To do / Recent / History** also applies to **Debate & Vote** and the **Actions** tab (replaces
  its old "Show history" checkbox). The bucketing is the pure `matchesDvMode`
  (`@drep-dao/shared/proposal-lifecycle`, unit-tested). For D&V, **both To do and Recent require the
  round to be in VOTE** (ballots open) — the panel is **empty during DEBATE** (the DRep debates/
  comments then, but can't cast or change a ballot, so "voting not open yet" rows would be noise).
  This also prevents double-listing: a proposal passes filtering (→ `stage='DEBATE_VOTE'`) while its
  round may still be in FILTERING — it stays in the **Filtering** panel until the round reaches VOTE.
  **Filtering History is read-only** — once the round leaves FILTERING the filtering vote is final
  (the backend already rejects late votes: `vote()` requires round status FILTERING), so History
  drops the Edit-vote button and the vote box and shows the recorded vote only. D&V *History*
  excludes proposals **rejected at the filtering stage** (`stage==='FILTERING'`, status
  `REJECTED`): those are still changeable in the Filtering panel, so they stay in Filtering
  *Recent* — only proposals that reached Debate & Vote (rejected in the vote → `stage` null;
  approved → `FUNDING`; or a closed round) appear in D&V *History*.
- **Submitter profile portfolio** gains a **Rejected** headline stat (count of the submitter's
  `REJECTED` proposals — turned down at filtering / Debate & Vote), alongside Submitted /
  Requested / Granted budget / Paid so far / Completed / In progress (`submitterPortfolio`).

**Proposals**
- **Title immutability:** once submitted (past DRAFT / fee-reject), the title is locked
  server-side (`updateDraft`) and in both the submit and post-public edit forms.

**Profiles (§2)**
- **Independent submitter vs DAO-member/expert profiles:** a submitter sets their own
  display name (no longer forced from the account profile); the apply/update handler
  stores `dto.displayName` verbatim.
- **Cross-wallet linking:** the same entity may register a DAO-member profile on one
  wallet and a submitter profile on another. Each profile form has an "I'm also a …"
  checkbox + a picker; one-way self-declaration surfaces the link on both profiles
  (resolved same-wallet OR explicit). Board can override from each directory detail
  (`PATCH /admin/submitters/:id/link`, `PATCH /dao/members/:drepId/link`). Columns:
  `SubmitterApplication.linkedDrepIdOnchain`, `Drep.linkedSubmitterUserId`.
- **Mandatory contact (§14.3):** Telegram + a valid email are required on the DAO-member
  (DRep) profile — enforced client-side and in `apply`/`updateMine` (existing rows
  unchanged until next save).
- **DAO-member Activity stats:** the public profile groups governance participation
  across all rounds — admission votes, filtering reviews, funding (D&V) votes,
  milestone reviews, internal-proposal votes — each with its YES/NO(/Abstain) split.
  "Votes on funding" (the board opt-in flag) sits with the headline stats.
- **Larger profile photos:** the picker accepts up to 12 MB and downscales client-side
  to a 640px standard (WebP/JPEG); DTO caps raised to ~700k chars; the API JSON body
  limit raised to 2 MB.

**Rounds**
- **Per-category stats** on the Categories tab, by stage (Submission → Filtering →
  Debate & Vote → Funding): budget asked, submitters, fees collected, pass/reject counts,
  funded allocation, milestones. The **Submission** row shows Submitted / Accepted / Pending /
  **Not accepted** (red) — `notAccepted` counts fee/submission-stage rejections (fee unpaid or
  board-rejected at the fee review; `isFeeStageReject`, unit-tested). "Approved" only appears in
  the Debate & Vote and Funding rows, where a proposal can actually win funding — it's no longer
  shown (always 0) in Submission.
- **Round control** (My area, board): split into a **submenu** — "Round stage control"
  (timeline) and "Round setup" (editable parameters). Stage scheduling now validates
  dates (start in the future, end after start, not before the previous stage's end —
  shown inline), displays each stage's **length**, shows a **Saved / ● Not saved**
  indicator per stage, and confirms **Launch … now** via the in-app dialog.
- **Auto-start & overdue UX (§8).** A background ticker (`RoundsSchedulerService`, every 60 s)
  auto-advances a round into its next stage when that stage is **confirmed + auto-start** and its
  planned start has arrived — the trigger is the pure, unit-tested `isStageDueToAutoStart`. The
  Round-control UI no longer shows contradictory warnings around this: the **current** stage doesn't
  red-flag an *unedited* end date that has merely passed (calm note instead — it only errors when the
  board actually edits the end into the past to extend it), and an **overdue next stage that's already
  confirmed with auto-start** shows a calm "auto-start advances it on the next check (≤1 min); Launch
  now to start immediately" instead of demanding the board move the date. Manual/unconfirmed overdue
  stages still get the loud red call-to-action.

**Notifications**
- The to-do counts (Actions tab badges, My-area left-nav badge, login-box badge) are
  unified behind one shared hook (`lib/use-todo-counts.ts`) so they can't diverge.
