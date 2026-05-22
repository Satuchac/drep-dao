# DRep DAO — service-level test suite

Integration tests that exercise the real services (`UsersService`, `DrepService`,
`GenesisService`, `CardanoQueryService`) against the **dev Postgres** and **live
Koios (Preprod)** — the realistic seam for this off-chain-source-of-truth +
on-chain platform. Each suite cleans up after itself and the suite leaves the
**5-member board seated** with no leftover test applicants.

## Run

```bash
pnpm infra:up        # Postgres + Redis (once)
pnpm build           # or have `pnpm dev` running — the suite uses the built dist
pnpm test:e2e        # = node tools/test-all.cjs
```

Prereqs: an admin (`pnpm admin:create`), and the fixed cast generated + funded +
registered on-chain (see `docs/ACTORS.md`; `gen-cast` → `fund-cast` →
`register-dreps` → `seat-board` → `delegate-votes`).

## Suites (run in this order by `test-all.cjs`)

| Suite | Covers |
|---|---|
| `test-genesis` | Loading the genesis JSON (array / `founding_board` / name→id map / pairs), **partial load** (keep valid, report invalid), empty/garbage rejection, **manual add/remove** board members, **incremental re-load** (3 then +2 = 5). Leaves the 5-member board seated. |
| `test-cast` | Role recognition for all 10 actors (board → DRep+DAO_MEMBER+BOARD; voting DReps → DREP; ADA holders → Viewer/Submitter) + non-mutating genesis verify. |
| `test-dao` | Board members are DAO members automatically; a non-board DRep joins via the §14.2 **3-of-5 admission vote** (rationale required); applicant sees votes + rationales; overview voting power. |
| `test-overview` | DAO overview **voting power** = log10(on-chain DRep vote-delegation stake) × (1 + merit/200) with delegator counts; **Expert** apply → board approve → listed. |
| `test-removal` | §14.4 board **removal**: propose → 3-of-5 vote → `REMOVED`; removed member can re-apply. |
| `test-rounds` | §6/§3 **round lifecycle**: board creates a round and moves it stage to stage; proposals submit **only** in the `SUBMISSION` stage (blocked in PREPARATION/FILTERING). Board-editable **governance parameters** (get/update/validate). Cleans up the test round + proposal. |

Individual suites can be run directly, e.g. `node tools/test-genesis.cjs`.
