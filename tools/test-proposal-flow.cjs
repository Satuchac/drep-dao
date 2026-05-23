/**
 * §7/§8/§11/§16/§20 — full proposal lifecycle at the service level (no tADA spent;
 * ANCHOR_MNEMONIC is removed so anchors are recorded but not submitted):
 *   submit (commercial fee) → board confirm-fee → edit (versioned) → filtering
 *   (3 YES, anchored) → D&V (balanced, anchored) → milestones (POA + 2 YES each,
 *   anchored) → COMPLETE, plus comments. Cleans up everything at the end.
 *
 *   node tools/test-proposal-flow.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const root = '/home/satucha/projects/drep-dao';
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC; // record anchors, do not submit on-chain

const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { UsersService } = require(root + '/apps/api/dist/users/users.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { FilteringService } = require(root + '/apps/api/dist/proposals/filtering.service.js');
const { DvService } = require(root + '/apps/api/dist/proposals/dv.service.js');
const { MilestonesService } = require(root + '/apps/api/dist/milestones/milestones.service.js');
const { CommentsService } = require(root + '/apps/api/dist/comments/comments.service.js');
const { stakeKeyHashFromBech32 } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const users = new UsersService(prisma, cardano);
  const anchor = new AnchorService(config, prisma, cardano);
  const rounds = new RoundsService(prisma, config);
  const proposals = new ProposalsService(prisma);
  const filtering = new FilteringService(prisma, anchor);
  const dv = new DvService(prisma, config, anchor);
  const milestones = new MilestonesService(prisma, anchor);
  const comments = new CommentsService(prisma);

  // Reviewers/voters = the seated board (admitted DReps); submitter = a non-board holder.
  const seats = await prisma.boardSeat.findMany();
  const boardDreps = await prisma.drep.findMany({
    where: { user: { drepKeyHash: { in: seats.map((s) => s.drepKeyHash) } } },
    include: { user: { select: { id: true } } },
  });
  ok('have ≥3 board reviewers', boardDreps.length >= 3, `${boardDreps.length} board dreps`);
  const userIdForDrep = (drepId) => boardDreps.find((d) => d.id === drepId)?.user.id;

  const carol = await users.upsertByStakeKey({
    stakeKeyHash: stakeKeyHashFromBech32(personas.holder.stakeAddress),
    stakeAddress: personas.holder.stakeAddress,
    drepKeyHash: personas.holder.drepKeyHash,
  });

  console.log('\n=== Round + submission (commercial fee 3%) ===');
  const round = await rounds.create({ name: 'Flow round', budgetAda: 1_000_000, rewardsPoolAda: 50_000, categories: [{ name: 'Tooling', type: 'GRANT', allocatedAda: 1_000_000 }] });
  await rounds.startStage(round.id, 'SUBMISSION');
  const draft = await proposals.createDraft(carol.id, {
    roundId: round.id, categoryId: round.categories[0].id, title: 'Build a tool',
    contentMd: 'Original pitch.', isCommercial: true, requestedAmountAda: 1000,
    milestones: [{ description: 'M1', amountAda: 600 }, { description: 'M2', amountAda: 400 }],
  });
  const submitted = await proposals.submit(carol.id, draft.id, { submissionFeeTxHash: 'feehash123' });
  ok('commercial fee = 3% of requested', submitted.submissionFeeAda === 30, `${submitted.submissionFeeAda} ₳`);
  ok('status PENDING after submit', submitted.status === 'PENDING');
  ok('appears in board pending-fee list', (await proposals.listPendingFee()).some((x) => x.id === draft.id));
  await proposals.confirmFee(draft.id);
  let det = await proposals.get(draft.id);
  ok('fee confirmed → ACTIVE + FILTERING', det.status === 'ACTIVE' && det.stage === 'FILTERING');

  console.log('\n=== Edit during filtering → versioned + diff ===');
  await proposals.updateDraft(carol.id, draft.id, { contentMd: 'Updated pitch with more detail.' });
  const versions = await proposals.versions(draft.id);
  ok('prior content snapshotted', versions.length === 2 && versions[0].contentMd === 'Original pitch.' && versions[1].current === true);

  console.log('\n=== §7 Filtering: draw + 3 YES → anchored decision ===');
  await filtering.drawReviewers(draft.id);
  const assigns = await prisma.filterAssignment.findMany({ where: { proposalId: draft.id, releasedAt: null } });
  let voted = 0;
  for (const a of assigns) {
    const uid = userIdForDrep(a.drepId);
    if (uid) { await filtering.vote(uid, draft.id, 'YES', 'clear and well-scoped'); if (++voted >= 3) break; }
  }
  det = await proposals.get(draft.id);
  ok('3 YES → advanced to DEBATE_VOTE', det.stage === 'DEBATE_VOTE');
  const fAnchor = await prisma.anchor.findFirst({ where: { proposalId: draft.id, kind: 'filtering' } });
  ok('filtering decision anchored (label 80808081)', !!fAnchor && fAnchor.metadataLabel === 80808081);
  const fres = await filtering.result(draft.id);
  ok('filtering exposes public rationale', fres.votes.some((v) => v.rationale === 'clear and well-scoped'));

  console.log('\n=== §8 Debate & Vote: balanced, anchored ===');
  await dv.openVoting(draft.id);
  const rationale = 'I support this proposal because '.padEnd(220, 'x');
  for (const d of boardDreps) await dv.vote(d.user.id, draft.id, 'YES', rationale);
  const fin = await dv.finalize(draft.id);
  ok('D&V APPROVED → FUNDING', fin.status === 'APPROVED' && fin.stage === 'FUNDING');
  const dAnchor = await prisma.anchor.findFirst({ where: { proposalId: draft.id, kind: 'dv' } });
  ok('D&V result anchored', !!dAnchor);
  ok('D&V exposes rationale + weight', (fin.votes ?? []).some((v) => v.rationale && (v.weight ?? 0) > 0));

  console.log('\n=== §11 Milestones: POA + 2 YES each → COMPLETE ===');
  await milestones.drawReviewers(draft.id);
  for (const m of await milestones.forProposal(draft.id)) {
    await milestones.submitPoa(carol.id, m.id, `Delivered milestone ${m.idx + 1}`);
    const massign = await prisma.milestoneAssignment.findMany({ where: { milestoneId: m.id, releasedAt: null } });
    let mv = 0;
    for (const a of massign) {
      const uid = userIdForDrep(a.reviewerDrepId);
      if (uid) { await milestones.vote(uid, m.id, 'YES', 'looks delivered'); if (++mv >= 2) break; }
    }
  }
  det = await proposals.get(draft.id);
  ok('all milestones approved → proposal COMPLETE', det.status === 'COMPLETE');
  ok('milestone decisions anchored', (await prisma.anchor.count({ where: { proposalId: draft.id, kind: 'milestone' } })) >= 2);

  console.log('\n=== §20 Comments ===');
  await comments.create(carol.id, draft.id, 'Great proposal!');
  const clist = await comments.list(draft.id);
  ok('comment listed', clist.length === 1 && clist[0].contentMd === 'Great proposal!');

  console.log('\n=== Cleanup ===');
  const msIds = (await prisma.milestone.findMany({ where: { proposalId: draft.id }, select: { id: true } })).map((m) => m.id);
  const snapIds = (await prisma.voteSnapshot.findMany({ where: { proposalId: draft.id }, select: { id: true } })).map((s) => s.id);
  await prisma.comment.deleteMany({ where: { proposalId: draft.id } });
  await prisma.vote.deleteMany({ where: { proposalId: draft.id } });
  await prisma.milestonePoa.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestoneAssignment.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestone.deleteMany({ where: { proposalId: draft.id } });
  await prisma.filterAssignment.deleteMany({ where: { proposalId: draft.id } });
  await prisma.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: snapIds } } });
  await prisma.voteSnapshot.deleteMany({ where: { proposalId: draft.id } });
  await prisma.proposalVersion.deleteMany({ where: { proposalId: draft.id } });
  await prisma.anchor.deleteMany({ where: { proposalId: draft.id } });
  await prisma.proposal.delete({ where: { id: draft.id } });
  await prisma.roundDrepEligibility.deleteMany({ where: { roundId: round.id } });
  await prisma.roundSchedule.deleteMany({ where: { roundId: round.id } });
  await prisma.roundCategory.deleteMany({ where: { roundId: round.id } });
  await prisma.round.delete({ where: { id: round.id } });
  ok('cleaned up', (await prisma.proposal.findUnique({ where: { id: draft.id } })) === null);

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
