/**
 * Tests the forgiving genesis parser + manual add/remove against the REAL
 * GenesisService (live Koios + dev DB). Leaves the board EMPTY at the end so
 * the admin can drive the upload flow manually.
 *
 *   node tools/test-genesis.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { PrismaService } = require('../apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require('../apps/api/dist/cardano/cardano-query.service.js');
const { GenesisService } = require('../apps/api/dist/admin/genesis.service.js');
const { drepIdFromKeyHashHex } = require('../packages/cardano/dist/index.js');
const personas = require('./persona-wallets.json');

const config = { get: (k) => process.env[k] };
const store = new Map();
const redis = { client: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async set(k, v) { store.set(k, v); return 'OK'; },
  async del(k) { return store.delete(k) ? 1 : 0; },
} };
const audit = { log: async () => {} };

const id = (key) => drepIdFromKeyHashHex(personas[key].drepKeyHash);

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};
async function expectVerifies(svc, adminId, label, payload, n) {
  try {
    const res = await svc.upload(adminId, payload);
    check(label, res.proposedBoard.length === n, `${res.proposedBoard.length} parsed`);
  } catch (e) {
    check(label, false, e.message);
  }
}
async function expectThrows(svc, adminId, label, payload, re) {
  try {
    await svc.upload(adminId, payload);
    check(label, false, 'unexpectedly accepted');
  } catch (e) {
    check(label, re.test(e.message), e.message);
  }
}

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const svc = new GenesisService(prisma, redis, cardano, audit);
  const admin = await prisma.adminUser.findFirst();
  const A = admin.id;

  // Start clean.
  await prisma.boardSeat.deleteMany({});
  await prisma.platformState.update({ where: { id: 1 }, data: { genesisApprovedAt: null, genesisApprovedBy: null, genesisPayload: null } }).catch(() => {});

  console.log('\n=== Forgiving parser accepts multiple formats (3 registered DReps) ===');
  const three = ['regular', 'dave', 'erin'];
  await expectVerifies(svc, A, 'array of {name, drep_id}', three.map((k) => ({ name: k, drep_id: id(k) })), 3);
  await expectVerifies(svc, A, '{ founding_board: [...] }', { founding_board: three.map((k) => ({ name: k, drep_id: id(k) })) }, 3);
  await expectVerifies(svc, A, 'name → drep_id map', Object.fromEntries(three.map((k) => [k, id(k)])), 3);
  await expectVerifies(svc, A, 'array of [name, drep_id] pairs', three.map((k) => [k, id(k)]), 3);

  console.log('\n=== Rejections ===');
  await expectThrows(svc, A, 'rejects unregistered DRep', [{ name: 'Bad', drep_id: 'drep1ytwhq9236d0v0m4xq7nrw6xeqptpk6wchyukwrpk5xmsn2sa3jf6y' }], /not registered/i);
  await expectThrows(svc, A, 'rejects missing drep_id', [{ name: 'NoId' }], /invalid drep_id/i);
  await expectThrows(svc, A, 'rejects garbage id', [{ name: 'X', drep_id: 'notadrep' }], /invalid drep_id/i);

  console.log('\n=== Manual add / remove (one at a time) ===');
  await svc.removeBoardMember(A, id('regular')).catch(() => {}); // ensure absent
  let st = await svc.addBoardMember(A, 'Alice', id('regular'));
  check('add Alice → board 1', st.boardCount === 1);
  st = await svc.addBoardMember(A, 'Dave', id('dave'));
  check('add Dave → board 2', st.boardCount === 2);
  try { await svc.addBoardMember(A, 'Alice again', id('regular')); check('duplicate add rejected', false); }
  catch (e) { check('duplicate add rejected', /already a board member/i.test(e.message)); }
  try { await svc.addBoardMember(A, 'Fake', 'drep1ytwhq9236d0v0m4xq7nrw6xeqptpk6wchyukwrpk5xmsn2sa3jf6y'); check('add unregistered rejected', false); }
  catch (e) { check('add unregistered rejected', /not registered/i.test(e.message)); }
  st = await svc.removeBoardMember(A, id('regular'));
  check('remove Alice → board 1', st.boardCount === 1);
  try { await svc.removeBoardMember(A, id('regular')); check('remove-again rejected', false); }
  catch (e) { check('remove-again rejected', /not a current board member/i.test(e.message)); }

  console.log('\n=== Incremental file re-load (3 then +2 = 5) ===');
  await prisma.boardSeat.deleteMany({});
  await svc.upload(A, three.map((k) => ({ name: k, drep_id: id(k) })));
  let ap = await svc.approve(A);
  check('first load seats 3', ap.seated === 3 && ap.boardCount === 3);
  const five = [...three, 'frank', 'grace'];
  await svc.upload(A, five.map((k) => ({ name: k, drep_id: id(k) }))); // 3 existing + 2 new
  ap = await svc.approve(A);
  check('re-load adds only the 2 new', ap.seated === 2 && ap.boardCount === 5, `seated ${ap.seated}, board ${ap.boardCount}`);

  // Leave board EMPTY for manual admin testing.
  await prisma.boardSeat.deleteMany({});
  await prisma.platformState.update({ where: { id: 1 }, data: { genesisApprovedAt: null, genesisApprovedBy: null, genesisPayload: null } }).catch(() => {});
  await redis.client.del('admin:genesis:proposed');

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} FAILED`} (board left empty for manual testing)`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('crashed:', e);
  process.exit(1);
});
