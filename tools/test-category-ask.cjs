/**
 * §5.2 — a category's min/max funding-request bounds are enforced when a proposal is
 * created: a request below the min or above the max is rejected; an in-range request
 * is accepted, and the proposal detail exposes the category's ask range. Also checks
 * the §3.4 funding fields (team info, cost breakdown, revenue sharing) round-trip.
 *
 * Creates a throwaway round + proposals and deletes them at the end.
 *
 *   node tools/test-category-ask.cjs
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
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => { try { await fn(); ok(l, false, 'did not throw'); } catch (e) { ok(l, re.test(e.message), e.message); } };

(async () => {
  const prisma = new PrismaService(config);
  const rounds = new RoundsService(prisma, config);
  const proposals = new ProposalsService(prisma, config, new CardanoQueryService(config));
  const u = await db.appUser.findFirst({ select: { id: true } });
  if (!u) { console.error('need at least one app_user'); process.exit(1); }

  // A round with a category bounded to a 10,000–100,000 ₳ ask per proposal.
  const r = await rounds.create({
    name: '__category_ask_test__', budgetAda: 500000, rewardsPoolAda: 1000,
    categories: [{ name: 'Bounded', type: 'GRANT', allocatedAda: 500000, minAda: 10000, maxAda: 100000, conditions: 'OSS only' }],
  });
  const catId = r.categories[0].id;
  await db.round.update({ where: { id: r.id }, data: { status: 'SUBMISSION' } });
  const mk = (amt, extra = {}) => ({ roundId: r.id, categoryId: catId, title: 't', contentMd: 'c', isCommercial: false, requestedAmountAda: amt, milestones: [{ description: 'm', amountAda: amt }], ...extra });

  try {
    await throws('request below min (5,000) rejected', () => proposals.createDraft(u.id, mk(5000)), /below.*minimum/);
    await throws('request above max (200,000) rejected', () => proposals.createDraft(u.id, mk(200000)), /exceeds.*maximum/);
    const good = await proposals.createDraft(u.id, mk(50000, {
      teamInfoMd: 'Core team', costBreakdownMd: 'Dev 40k', revenueSharingMd: '5% to DAO',
      // §3 milestone parts: title + description + acceptance criteria + budget.
      milestones: [{ title: 'MVP', description: 'Build the MVP', acceptanceCriteria: 'Demo on Preprod', amountAda: 50000 }],
    }));
    ok('in-range request (50,000) accepted', good.requestedAmountAda === 50000, String(good.requestedAmountAda));
    ok('detail exposes category ask range + conditions', good.categoryAsk?.minAda === 10000 && good.categoryAsk?.maxAda === 100000 && good.categoryAsk?.conditions === 'OSS only');
    ok('detail exposes §3.4 fields', good.teamInfoMd === 'Core team' && good.costBreakdownMd === 'Dev 40k' && good.revenueSharingMd === '5% to DAO');
    const m0 = good.milestones?.[0];
    ok('milestone keeps title + acceptance criteria + budget', m0?.title === 'MVP' && m0?.acceptanceCriteria === 'Demo on Preprod' && m0?.description === 'Build the MVP' && m0?.amountAda === 50000, JSON.stringify(m0));
    // Editing a draft: the frontend PATCH carries categoryId (allowed) but NOT roundId
    // (immutable). updateDraft must accept that shape and persist the change.
    const edited = await proposals.updateDraft(u.id, good.id, {
      categoryId: catId, title: 't', contentMd: 'changed pitch', isCommercial: false, requestedAmountAda: 50000,
      submissionFeeTxHash: 'tx12345',
      milestones: [{ title: 'MVP', description: 'Build the MVP', acceptanceCriteria: 'Demo on Preprod', amountAda: 50000 }],
    });
    ok('editing a draft (categoryId, no roundId) persists', edited.contentMd === 'changed pitch', edited.contentMd);
    ok('fee tx hash persists on a saved draft', edited.submissionFeeTxHash === 'tx12345', String(edited.submissionFeeTxHash));
    const reread = await proposals.get(good.id, u.id);
    ok('fee tx hash survives reload', reread.submissionFeeTxHash === 'tx12345', String(reread.submissionFeeTxHash));
  } finally {
    const props = await db.proposal.findMany({ where: { roundId: r.id }, select: { id: true } });
    await db.milestone.deleteMany({ where: { proposalId: { in: props.map((p) => p.id) } } });
    await db.proposal.deleteMany({ where: { roundId: r.id } });
    await db.roundCategory.deleteMany({ where: { roundId: r.id } });
    await db.roundDrepEligibility.deleteMany({ where: { roundId: r.id } });
    await db.roundSchedule.deleteMany({ where: { roundId: r.id } });
    await db.round.delete({ where: { id: r.id } });
  }

  await prisma.$disconnect();
  await db.$disconnect();
  console.log(fail ? `\n❌ ${fail} check(s) failed.` : '\n✅ All category-ask checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
