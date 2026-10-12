/**
 * §15.3 — the auto hot-wallet top-up must create exactly ONE pending action even under concurrent
 * treasury-status reads (page reloads / multiple tabs). maybePrepareTopUp() used to check-then-create
 * without a lock, so N concurrent calls each created a top-up (observed: 4 duplicates on mainnet).
 * This test drives N concurrent calls and asserts a single action, plus the configured amount.
 *
 *   node tools/test-hot-wallet-topup-race.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC;
process.env.JOBS_DISABLED = '1';
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { TreasuryBucketsService } = require(root + '/apps/api/dist/treasury/treasury-buckets.service.js');
const { PledgeReturnService } = require(root + '/apps/api/dist/treasury/pledge-return.service.js');
const { TreasuryService } = require(root + '/apps/api/dist/treasury/treasury.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const buckets = new TreasuryBucketsService(prisma, config, cardano);
  const pledgeReturn = new PledgeReturnService(prisma, cardano, buckets);
  const treasury = new TreasuryService(prisma, config, cardano, anchor, buckets, pledgeReturn);

  const HOT = 'addr_test1_hotwallet_race_' + Date.now();
  // Stubs: a configured hot wallet that is LOW (10 ₳ < 100), no default bucket.
  anchor.hotWalletAddress = () => HOT;
  cardano.addressBalanceStrict = async () => new Map([[HOT, 10_000_000n]]);
  buckets.defaultBucketFor = async () => null;

  // The auto-topup guard matches any PENDING_SIGS 'hot wallet' action, so start from a clean slate
  // (the test DB is isolated). Set the configured amount to a distinctive 50 ₳.
  await db.multisigAction.deleteMany({ where: { kind: 'OPS', status: 'PENDING_SIGS', description: { contains: 'hot wallet' } } }).catch(() => {});
  const parkedCfg = await db.platformConfig.findUnique({ where: { key: 'PLATFORM_HOT_WALLET_TOPUP_AMOUNT' } });
  await db.platformConfig.upsert({ where: { key: 'PLATFORM_HOT_WALLET_TOPUP_AMOUNT' }, update: { value: 50 }, create: { key: 'PLATFORM_HOT_WALLET_TOPUP_AMOUNT', value: 50 } });

  try {
    const N = 8;
    console.log(`— firing ${N} concurrent maybePrepareTopUp() calls —`);
    await Promise.all(Array.from({ length: N }, () => treasury.maybePrepareTopUp().catch((e) => console.error('   call error:', e.message))));
    const created = await db.multisigAction.findMany({ where: { destAddress: HOT, status: 'PENDING_SIGS' } });
    ok(`exactly ONE top-up created from ${N} concurrent calls (race fixed)`, created.length === 1, `got ${created.length}`);
    ok('the created amount is the configured 50 ₳', created[0] && String(created[0].amountAda) === String(50 * 1_000_000), created[0] && String(created[0].amountAda));

    console.log('— a second concurrent round while one is open → no new ones —');
    await Promise.all(Array.from({ length: N }, () => treasury.maybePrepareTopUp().catch(() => {})));
    const after = await db.multisigAction.findMany({ where: { destAddress: HOT, status: 'PENDING_SIGS' } });
    ok('still exactly ONE while an open top-up exists', after.length === 1, `got ${after.length}`);
  } catch (e) {
    console.error('crashed:', e);
    fail++;
  } finally {
    await db.multisigAction.deleteMany({ where: { destAddress: HOT } }).catch(() => {});
    if (parkedCfg) await db.platformConfig.update({ where: { key: 'PLATFORM_HOT_WALLET_TOPUP_AMOUNT' }, data: { value: parkedCfg.value } }).catch(() => {});
    else await db.platformConfig.delete({ where: { key: 'PLATFORM_HOT_WALLET_TOPUP_AMOUNT' } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(fail ? `\n❌ ${fail} failed` : '\n✅ all passed');
  process.exit(fail ? 1 : 0);
})();
