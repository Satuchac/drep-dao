/**
 * §6/§3 round lifecycle + governance setup: a board member creates a round and
 * moves it stage to stage; proposals can be submitted ONLY while the round is in
 * the SUBMISSION stage. Plus board-editable governance parameters. Cleans up the
 * test round/proposal at the end.
 *
 *   node tools/test-rounds.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const root = '/home/satucha/projects/drep-dao';
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { UsersService } = require(root + '/apps/api/dist/users/users.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { GovernanceService } = require(root + '/apps/api/dist/governance/governance.service.js');
const { stakeKeyHashFromBech32 } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => {
  try { await fn(); ok(l, false, 'did not throw'); }
  catch (e) { ok(l, re.test(e.message), e.message); }
};

(async () => {
  const prisma = new PrismaService(config);
  const users = new UsersService(prisma, new CardanoQueryService(config));
  const rounds = new RoundsService(prisma, config);
  const proposals = new ProposalsService(prisma);
  const gov = new GovernanceService(prisma);

  console.log('\n=== Governance parameters (board-editable) ===');
  const params = await gov.getParams();
  ok('returns governance params with defaults', params.some((p) => p.key === 'DV_APPROVAL_THRESHOLD_PCT'));
  const admin = await prisma.appUser.findFirst(); // any user id for updatedBy
  await gov.updateParam(admin.id, 'DV_APPROVAL_THRESHOLD_PCT', 70);
  const after = (await gov.getParams()).find((p) => p.key === 'DV_APPROVAL_THRESHOLD_PCT');
  ok('update reflected', Number(after.value) === 70, `value=${after.value}`);
  await throws('unknown param rejected', () => gov.updateParam(admin.id, 'NOPE', 1), /unknown governance parameter/i);
  await prisma.platformConfig.delete({ where: { key: 'DV_APPROVAL_THRESHOLD_PCT' } }).catch(() => {}); // restore default

  console.log('\n=== Round lifecycle gates proposal submission ===');
  const round = await rounds.create({
    name: 'E2E test round',
    budgetAda: 1_000_000,
    rewardsPoolAda: 50_000,
    categories: [{ name: 'Test', allocatedAda: 1_000_000 }],
  });
  const categoryId = round.categories[0].id;
  ok('round created in PREPARATION', round.status === 'PREPARATION');

  const bob = await users.upsertByStakeKey({
    stakeKeyHash: stakeKeyHashFromBech32(personas.board.stakeAddress),
    stakeAddress: personas.board.stakeAddress,
    drepKeyHash: personas.board.drepKeyHash,
  });
  const draft = (rid) => ({
    roundId: rid,
    categoryId,
    title: 'My proposal',
    contentMd: 'Pitch.',
    isCommercial: false,
    requestedAmountAda: 1000,
    milestones: [{ description: 'Deliver', amountAda: 1000 }],
  });

  await throws('submit blocked in PREPARATION', () => proposals.createDraft(bob.id, draft(round.id)), /not accepting submissions/i);

  await rounds.startStage(round.id, 'SUBMISSION');
  let created;
  try {
    created = await proposals.createDraft(bob.id, draft(round.id));
    ok('submit allowed in SUBMISSION', created.status === 'DRAFT');
  } catch (e) {
    ok('submit allowed in SUBMISSION', false, e.message);
  }

  await rounds.startStage(round.id, 'FILTERING');
  await throws('submit blocked again in FILTERING', () => proposals.createDraft(bob.id, draft(round.id)), /not accepting submissions/i);

  console.log('\n=== Cleanup ===');
  if (created) {
    await prisma.milestone.deleteMany({ where: { proposalId: created.id } });
    await prisma.proposal.delete({ where: { id: created.id } }).catch(() => {});
  }
  await prisma.roundDrepEligibility.deleteMany({ where: { roundId: round.id } });
  await prisma.roundSchedule.deleteMany({ where: { roundId: round.id } });
  await prisma.proposal.deleteMany({ where: { roundId: round.id } });
  await prisma.roundCategory.deleteMany({ where: { roundId: round.id } });
  await prisma.round.delete({ where: { id: round.id } });
  ok('test round removed', (await prisma.round.findUnique({ where: { id: round.id } })) === null);

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
