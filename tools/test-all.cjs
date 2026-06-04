/**
 * Runs the whole DRep DAO service-level test suite, in order, against the dev DB
 * + live Koios (Preprod). Each suite cleans up after itself; the dev DB is left
 * with the 5-member board seated and no leftover test applicants.
 *
 * Prereqs: infra up (pnpm infra:up), an admin (pnpm admin:create), the cast
 * seeded/registered, and the built dist (the dev server keeps it fresh; otherwise
 * run `pnpm build`).
 *
 *   node tools/test-all.cjs   (or: pnpm test:e2e)
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (!fs.existsSync(path.join(__dirname, '..', 'apps/api/dist/drep/drep.service.js'))) {
  console.error('apps/api/dist is missing — run `pnpm build` (or start `pnpm dev`) first.');
  process.exit(1);
}

// Order matters: genesis leaves the 5-board seated; the rest build on it.
// (test-multisig is offline crypto — no DB/Koios — so it runs first, fast.)
const SUITES = [
  ['test-multisig', '§15 native-script 3-of-5 treasury: script/address determinism, 3-of-5 assembly, quorum + membership (offline)'],
  ['test-genesis', 'Genesis: JSON load, partial load, add/remove, incremental'],
  ['test-cast', 'Cast roles: board / voting DRep / ADA holder + genesis verify'],
  ['test-dao', 'DAO membership: board auto-member, join + 3-of-5 admission'],
  ['test-overview', 'DAO overview voting power + Expert apply/approve'],
  ['test-entry-gate', '§14.1 entry gate: config save, eligibility, below-min flag, MERIT cap (self-restoring)'],
  ['test-removal', 'Removal: propose + 3-of-5 vote → REMOVED, re-apply'],
  ['test-rounds', 'Rounds: stage transitions gate submission + governance params'],
  ['test-stage-flow', 'Stage flow: budget/schedule validation, confirm/launch/auto-start/close, proposal counts'],
  ['test-proposal-flow', 'Proposal lifecycle: fee, edit/version, filtering+D&V+milestone anchored, comments'],
  ['test-category-ask', '§5.2 category min/max ask enforced on submit + §3.4 funding fields (self-cleaning)'],
  ['test-round-counts', '§9 round overview per-status counts incl. DRAFT/PENDING, update as status changes (self-cleaning)'],
  ['test-internal', '§10 internal proposals: submit/threshold/poll/extend/scope/private + on-chain anchor (self-cleaning)'],
];

const failed = [];
for (const [file, desc] of SUITES) {
  console.log(`\n████ ${file} — ${desc} ████`);
  const r = spawnSync(process.execPath, [path.join(__dirname, `${file}.cjs`)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(file);
}

console.log('\n==================== SUMMARY ====================');
for (const [file, desc] of SUITES) {
  console.log(`  ${failed.includes(file) ? '❌ FAIL' : '✅ PASS'}  ${file.padEnd(14)} ${desc}`);
}
console.log(failed.length ? `\n❌ ${failed.length} suite(s) failed.` : '\n✅ All suites passed.');
process.exit(failed.length ? 1 : 0);
