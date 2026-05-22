/**
 * E2E-ish role + genesis test. Instantiates the REAL compiled services
 * (UsersService, GenesisService, CardanoQueryService, PrismaService) against
 * live Koios (Preprod) and the dev Postgres — exercising exactly the code paths
 * that decide DRep vs ADA-holder. Skips only the HTTP/CIP-8 signature layer
 * (unchanged by this work).
 *
 *   node tools/test-roles.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

// Load root .env into process.env (DATABASE_URL, CARDANO_NETWORK).
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { PrismaService } = require('../apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require('../apps/api/dist/cardano/cardano-query.service.js');
const { UsersService } = require('../apps/api/dist/users/users.service.js');
const { GenesisService } = require('../apps/api/dist/admin/genesis.service.js');
const { stakeKeyHashFromBech32 } = require('../packages/cardano/dist/index.js');

const config = { get: (k) => process.env[k] };

// In-memory Redis stub matching the GenesisService usage (.client.get/set/del).
const store = new Map();
const redis = { client: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async set(k, v) { store.set(k, v); return 'OK'; },
  async del(k) { return store.delete(k) ? 1 : 0; },
} };
const audit = { log: async () => {} };

const personas = JSON.parse(fs.readFileSync(path.join(__dirname, 'persona-wallets.json'), 'utf8'));
const genesisFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'genesis.json'), 'utf8'));

let failures = 0;
function check(label, cond, detail) {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function loginAndProfile(users, persona) {
  const stakeKeyHash = stakeKeyHashFromBech32(persona.stakeAddress);
  const user = await users.upsertByStakeKey({
    stakeKeyHash,
    stakeAddress: persona.stakeAddress,
    drepKeyHash: persona.drepKeyHash, // undefined for the ADA holder
  });
  return users.getProfile(user.id);
}

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const users = new UsersService(prisma, cardano);

  console.log('\n=== #2/#3  Role recognition (DRep vs ADA holder) ===');

  console.log('\n[regular / library seed] — registered on-chain DRep (Alice)');
  const reg = await loginAndProfile(users, personas.regular);
  console.log('   roles:', reg.roles.join(', '), '| onchainDrep:', JSON.stringify(reg.onchainDrep));
  check('recognised as DREP', reg.roles.includes('DREP'));
  check('onchainDrep.registered = true', reg.onchainDrep.registered === true);

  console.log('\n[board / subway seed] — NOT registered on-chain (Bob)');
  const bob = await loginAndProfile(users, personas.board);
  console.log('   roles:', bob.roles.join(', '), '| onchainDrep:', JSON.stringify(bob.onchainDrep));
  check('NOT a DREP', !bob.roles.includes('DREP'));
  check('is ADA holder (VIEWER+SUBMITTER only)', bob.roles.includes('VIEWER') && bob.roles.includes('SUBMITTER') && !bob.roles.includes('BOARD'));
  check('onchainDrep.registered = false', bob.onchainDrep.registered === false);

  console.log('\n[holder / gesture seed] — no DRep key at all (Carol)');
  const carol = await loginAndProfile(users, personas.holder);
  console.log('   roles:', carol.roles.join(', '), '| onchainDrep:', JSON.stringify(carol.onchainDrep));
  check('NOT a DREP', !carol.roles.includes('DREP'));
  check('is ADA holder', carol.roles.includes('VIEWER') && !carol.roles.includes('BOARD'));

  console.log('\n=== #4  Genesis verification (exists + active, else reject) ===');
  const genesis = new GenesisService(prisma, redis, cardano, audit);
  const admin = await prisma.adminUser.findFirst();
  if (!admin) throw new Error('no admin_user in DB — create one first (pnpm admin:create)');
  const adminId = admin.id;

  console.log('\n[upload genesis.json — registered DRep] should VERIFY');
  try {
    const res = await genesis.upload(adminId, genesisFile);
    check('accepted (verified on-chain)', res.proposedBoard.length === genesisFile.founding_board.length, `${res.proposedBoard.length} member(s)`);
  } catch (e) {
    check('accepted (verified on-chain)', false, e.message);
  }

  console.log('\n[upload genesis with an UNREGISTERED drep] should REJECT');
  const badFile = { founding_board: [{ name: 'Fake', drep_id: 'drep1ytwhq9236d0v0m4xq7nrw6xeqptpk6wchyukwrpk5xmsn2sa3jf6y' }] };
  try {
    await genesis.upload(adminId, badFile);
    check('rejected unregistered DRep', false, 'upload unexpectedly succeeded');
  } catch (e) {
    check('rejected unregistered DRep', /not registered DReps on-chain/i.test(e.message), e.message);
  }

  console.log('\n[approve the valid genesis] should SEAT the registered DRep as board');
  await prisma.boardSeat.deleteMany({}); // start clean so we test real seating
  await genesis.upload(adminId, genesisFile); // re-stash the valid file
  const approved = await genesis.approve(adminId);
  check('seated 1 board member', approved.seated === 1 && approved.boardCount === 1, `seated ${approved.seated}, board ${approved.boardCount}/${approved.maxBoard}`);

  console.log('\n[re-login regular wallet] should now be BOARD + DREP');
  const regAfter = await loginAndProfile(users, personas.regular);
  console.log('   roles:', regAfter.roles.join(', '));
  check('now BOARD', regAfter.roles.includes('BOARD'));
  check('still DREP', regAfter.roles.includes('DREP'));

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('test crashed:', e);
  process.exit(1);
});
