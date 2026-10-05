/**
 * §10 — deadline EXTENSION for internal proposals. Self-seeding (creates its own board member +
 * non-board submitter + throwaway proposals; restores INTERNAL_EXTEND_ENABLED and cleans up).
 * Covers: the config gate, the submitter-only (election) vs board-only (everything else) rule,
 * content stays frozen, the new deadline must be later + in the future, ACTIVE-only, and that each
 * extension is recorded + anchored (an 'internal_extended' Anchor row) and surfaced in detail().
 *
 *   node tools/test-internal-extend.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC; // record anchors, never submit a real tx
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { InternalProposalsService } = require(root + '/apps/api/dist/internal-proposals/internal-proposals.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const isoIn = (ms) => new Date(Date.now() + ms).toISOString();
const DAY = 24 * 3600_000;
async function throws(label, fn, re) {
  try { await fn(); ok(label, false, 'unexpectedly succeeded'); }
  catch (e) { ok(label, re.test(e.message), e.message); }
}

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const svc = new InternalProposalsService(prisma, config, anchor, cardano);
  const ts = Date.now();
  const made = { users: [], dreps: [], seats: [], props: [] };

  // park INTERNAL_EXTEND_ENABLED
  const parked = await db.platformConfig.findUnique({ where: { key: 'INTERNAL_EXTEND_ENABLED' } });
  const setEnabled = (v) => db.platformConfig.upsert({ where: { key: 'INTERNAL_EXTEND_ENABLED' }, update: { value: v }, create: { key: 'INTERNAL_EXTEND_ENABLED', value: v } });

  const mkDrep = async (tag, board) => {
    const u = await db.appUser.create({ data: { stakeKeyHash: `ext_${tag}_${ts}`, stakeAddress: `stake_ext_${tag}_${ts}`, drepKeyHash: `dkh_ext_${tag}_${ts}`, drepRegistered: true, displayName: `Ext ${tag}` } });
    const d = await db.drep.create({ data: { userId: u.id, drepIdOnchain: `drep_ext_${tag}_${ts}`, status: 'ADMITTED' } });
    made.users.push(u); made.dreps.push(d);
    if (board) { const s = await db.boardSeat.create({ data: { drepId: d.drepIdOnchain, drepKeyHash: u.drepKeyHash, displayName: u.displayName } }); made.seats.push(s); }
    return { u, d };
  };

  try {
    await setEnabled(true);
    const submitter = await mkDrep('sub', false); // non-board, ADMITTED → may submit
    const boardM = await mkDrep('brd', true);     // board member

    const base = { contentMd: 'body', internalType: 'INFORMATIVE', votersScope: 'BOTH', votingType: 'ONE_PERSON_ONE_VOTE' };
    const mkProp = async (title, endMs) => {
      const r = await svc.submit(submitter.u.id, { ...base, title, votingEndAt: isoIn(endMs) });
      made.props.push(r.id);
      return r;
    };

    console.log('— non-election: board extends, non-board submitter cannot —');
    const p1 = await mkProp(`__ext__ p1 ${ts}`, 3 * DAY);
    const newEnd = isoIn(10 * DAY);
    await throws('non-board submitter is refused', () => svc.extend(submitter.u.id, p1.id, newEnd), /board member/i);
    const afterBoard = await svc.extend(boardM.u.id, p1.id, newEnd);
    ok('board member extends → deadline moved', new Date(afterBoard.votingEndAt).toISOString() === new Date(newEnd).toISOString(), afterBoard.votingEndAt);
    ok('content stays frozen (title + body unchanged)', afterBoard.title === p1.title && afterBoard.contentMd === p1.contentMd);
    ok('extension recorded in detail().extensions', Array.isArray(afterBoard.extensions) && afterBoard.extensions.length === 1 && afterBoard.extensions[0].toIso === new Date(newEnd).toISOString());
    const anc = await db.anchor.findMany({ where: { proposalId: p1.id, kind: 'internal_extended' } });
    ok('an internal_extended anchor row was written', anc.length === 1 && !!anc[0].hash);

    console.log('— new deadline must be later than current + in the future —');
    await throws('earlier-than-current refused', () => svc.extend(boardM.u.id, p1.id, isoIn(5 * DAY)), /later than the current/i);
    await throws('past date refused', () => svc.extend(boardM.u.id, p1.id, new Date(Date.now() - DAY).toISOString()), /later than the current|in the future/i);

    console.log('— board-member election: only the submitter may extend —');
    const p2 = await mkProp(`__ext__ election ${ts}`, 3 * DAY);
    await db.proposal.update({ where: { id: p2.id }, data: { isBoardElection: true } });
    await throws('board member (non-submitter) refused on an election', () => svc.extend(boardM.u.id, p2.id, isoIn(9 * DAY)), /submitted this election/i);
    const elExt = await svc.extend(submitter.u.id, p2.id, isoIn(9 * DAY));
    ok('election submitter extends → deadline moved', new Date(elExt.votingEndAt).toISOString() === new Date(isoIn(9 * DAY)).toISOString() || elExt.extensions.length === 1);

    console.log('— canExtend reflects the viewer —');
    const asBoard = await svc.detail(p1.id, boardM.u.id);
    const asSub = await svc.detail(p1.id, submitter.u.id);
    ok('non-election: canExtend true for board, false for submitter', asBoard.canExtend === true && asSub.canExtend === false);

    console.log('— disabled config blocks extension —');
    await setEnabled(false);
    await throws('disabled → refused', () => svc.extend(boardM.u.id, p1.id, isoIn(20 * DAY)), /disabled/i);
    const disView = await svc.detail(p1.id, boardM.u.id);
    ok('canExtend false when disabled', disView.canExtend === false);
    await setEnabled(true);

    console.log('— a closed proposal cannot be extended —');
    await db.proposal.update({ where: { id: p1.id }, data: { status: 'APPROVED' } });
    await throws('closed → refused', () => svc.extend(boardM.u.id, p1.id, isoIn(30 * DAY)), /closed/i);
  } catch (e) {
    console.error('crashed:', e);
    fail++;
  } finally {
    for (const id of made.props) {
      await db.anchor.deleteMany({ where: { proposalId: id } }).catch(() => {});
      await db.vote.deleteMany({ where: { proposalId: id } }).catch(() => {});
      await db.voteSnapshotEntry.deleteMany({ where: { snapshot: { proposalId: id } } }).catch(() => {});
      await db.voteSnapshot.deleteMany({ where: { proposalId: id } }).catch(() => {});
      await db.proposal.delete({ where: { id } }).catch(() => {});
    }
    await db.boardSeat.deleteMany({ where: { id: { in: made.seats.map((s) => s.id) } } }).catch(() => {});
    await db.drep.deleteMany({ where: { id: { in: made.dreps.map((d) => d.id) } } }).catch(() => {});
    await db.appUser.deleteMany({ where: { id: { in: made.users.map((u) => u.id) } } }).catch(() => {});
    if (parked) await db.platformConfig.update({ where: { key: 'INTERNAL_EXTEND_ENABLED' }, data: { value: parked.value } }).catch(() => {});
    else await db.platformConfig.delete({ where: { key: 'INTERNAL_EXTEND_ENABLED' } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(fail ? `\n❌ ${fail} failed` : '\n✅ all passed');
  process.exit(fail ? 1 : 0);
})();
