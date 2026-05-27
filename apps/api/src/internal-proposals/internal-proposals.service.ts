import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  basePower,
  clampMerit,
  isApproved,
  approvalRatio,
  meritMultiplier,
  PLATFORM_CONFIG_DEFAULTS,
  ProposalStage,
  ProposalStatus,
  VoteChoice,
  VotePhase,
  VotersScope,
  VotingType,
  InternalType,
  ProposalType,
} from '@drep-dao/shared';
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorService } from '../cardano/anchor.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { CreateInternalProposalDto, VoteInternalDto } from './dto';

const LOVELACE = 1_000_000n;
const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

interface Ctx {
  userId: string;
  isBoard: boolean;
}

/**
 * §10 — Internal proposals: DAO-governance decisions (process changes, polls, board changes…).
 * Not tied to a round; voting opens immediately on submission. Lifecycle DRAFT→ACTIVE→APPROVED|
 * REJECTED (we submit straight to ACTIVE). Threshold proposals (INSTRUCTIVE/INFORMATIVE) use the
 * §4.4 tally; POLLs tally votes per option. Decisions are anchored on-chain with a date-independent
 * document hash and the structured id "Internal N".
 */
@Injectable()
export class InternalProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly anchor: AnchorService,
    private readonly cardano: CardanoQueryService,
  ) {}

  // ---- submission -----------------------------------------------------------

  async submit(userId: string, dto: CreateInternalProposalDto) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep || drep.status !== 'ADMITTED') {
      throw new ForbiddenException('only admitted DReps (board members included) can submit internal proposals');
    }
    if (dto.internalType === InternalType.POLL && (!dto.pollOptions || dto.pollOptions.length < 2)) {
      throw new BadRequestException('a poll needs at least two options');
    }
    // PRIVATE proposals are visible + votable to board members only.
    const scope = dto.isPrivate ? VotersScope.BOARD_ONLY : dto.votersScope;
    const thresholdPct = await this.thresholdPct(dto.thresholdKind);
    const now = new Date();
    const end = new Date(now.getTime() + dto.votingPeriodDays * DAY_MS);
    const publicId = await this.nextPublicId();

    const proposal = await this.prisma.proposal.create({
      data: {
        type: ProposalType.INTERNAL,
        status: ProposalStatus.ACTIVE,
        stage: ProposalStage.VOTING,
        publicId,
        submitterUserId: userId,
        submitterDrepId: drep.id,
        title: dto.title.trim(),
        contentMd: dto.contentMd,
        internalType: dto.internalType,
        votersScope: scope,
        thresholdKind: dto.thresholdKind,
        isPrivate: !!dto.isPrivate,
        pollOptions:
          dto.internalType === InternalType.POLL
            ? { multiple: !!dto.pollMultiple, options: dto.pollOptions }
            : undefined,
        actors: dto.internalType === InternalType.INSTRUCTIVE && dto.actors?.length ? dto.actors : undefined,
        deliveryDate:
          dto.internalType === InternalType.INSTRUCTIVE && dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
        votingType: dto.votingType,
        approvalThresholdPct: thresholdPct,
        votingStartAt: now,
        votingEndAt: end,
        submittedAt: now,
      },
    });
    // Freeze the eligible-voter set + power now, so voting can start immediately.
    await this.buildSnapshot(proposal.id, scope, dto.votingType);
    return this.detail(proposal.id, userId);
  }

  /** "Internal 1", "Internal 2", … — the structured public id used in the UI + on-chain. */
  private async nextPublicId(): Promise<string> {
    const n = await this.prisma.proposal.count({ where: { type: ProposalType.INTERNAL, publicId: { not: null } } });
    return `Internal ${n + 1}`;
  }

  private async thresholdPct(kind: string): Promise<number> {
    const key = kind === 'IMPORTANT' ? 'INTERNAL_IMPORTANT_THRESHOLD_PCT' : 'INTERNAL_DEFAULT_THRESHOLD_PCT';
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    return typeof row?.value === 'number'
      ? row.value
      : ((PLATFORM_CONFIG_DEFAULTS as Record<string, unknown>)[key] as number);
  }

  // ---- eligibility + snapshot ----------------------------------------------

  /** Admitted DReps in scope: BOARD_ONLY → board seats; DREPS_ONLY → non-board; BOTH → everyone. */
  private async eligibleDreps(scope: string) {
    const dreps = await this.prisma.drep.findMany({
      where: { status: 'ADMITTED' },
      select: { id: true, drepIdOnchain: true, user: { select: { drepKeyHash: true } } },
    });
    const boardHashes = new Set(
      (await this.prisma.boardSeat.findMany({ select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    const board = (d: (typeof dreps)[number]) => (d.user?.drepKeyHash ? boardHashes.has(d.user.drepKeyHash) : false);
    if (scope === VotersScope.BOARD_ONLY) return dreps.filter(board);
    if (scope === VotersScope.DREPS_ONLY) return dreps.filter((d) => !board(d));
    return dreps;
  }

  private async buildSnapshot(proposalId: string, scope: string, votingType: string) {
    const voters = await this.eligibleDreps(scope);
    const snapshot = await this.prisma.voteSnapshot.create({ data: { proposalId } });
    const balanced = votingType === VotingType.BALANCED;
    const power = balanced ? await this.realVotingPower(voters.map((v) => v.drepIdOnchain)) : new Map<string, bigint>();
    for (const v of voters) {
      if (balanced) {
        await this.addBalancedEntry(snapshot.id, v.id, power.get(v.drepIdOnchain) ?? 0n);
      } else {
        // 1 member = 1 vote: everyone carries equal weight 1.
        await this.prisma.voteSnapshotEntry.create({
          data: { snapshotId: snapshot.id, drepId: v.id, stakeLovelace: 0n, meritPoints: 0, basePower: 1, meritMultiplier: 1, finalPower: 1 },
        });
      }
    }
  }

  private async realVotingPower(drepIds: string[]): Promise<Map<string, bigint>> {
    const fallback = BigInt(Math.round(Number(this.config.get('DV_SNAPSHOT_STAKE_ADA') ?? 1_000_000))) * LOVELACE;
    const out = new Map<string, bigint>();
    try {
      const vp = await this.cardano.drepVotingPower(drepIds);
      for (const id of drepIds) {
        const lovelace = vp.get(id)?.votingPowerLovelace ?? 0n;
        out.set(id, lovelace > 0n ? lovelace : fallback);
      }
    } catch {
      for (const id of drepIds) out.set(id, fallback);
    }
    return out;
  }

  private async addBalancedEntry(snapshotId: string, drepId: string, stakeLovelace: bigint) {
    const max = await this.meritMax();
    const merit = await this.currentMerit(drepId, max);
    const bp = basePower(stakeLovelace);
    const mm = meritMultiplier(merit, max);
    await this.prisma.voteSnapshotEntry.create({
      data: { snapshotId, drepId, stakeLovelace, meritPoints: merit, basePower: bp, meritMultiplier: mm, finalPower: bp * mm },
    });
  }

  private async meritMax(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'MERIT_POINT_MAX' } });
    return typeof row?.value === 'number' ? row.value : PLATFORM_CONFIG_DEFAULTS.MERIT_POINT_MAX;
  }

  private async currentMerit(drepId: string, max: number): Promise<number> {
    const rows = await this.prisma.meritLedger.aggregate({ where: { drepId }, _sum: { delta: true } });
    return clampMerit(rows._sum.delta ? Number(rows._sum.delta) : 0, max);
  }

  // ---- voting ---------------------------------------------------------------

  async vote(userId: string, proposalId: string, dto: VoteInternalDto) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.type !== ProposalType.INTERNAL) throw new NotFoundException('internal proposal not found');
    await this.maybeFinalize(proposal);
    const fresh = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!fresh || fresh.status !== ProposalStatus.ACTIVE) throw new ConflictException('voting is closed for this proposal');

    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new ForbiddenException('DReps only');
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    const entry = snapshot
      ? await this.prisma.voteSnapshotEntry.findUnique({ where: { snapshotId_drepId: { snapshotId: snapshot.id, drepId: drep.id } } })
      : null;
    if (!entry) throw new ForbiddenException('you are not eligible to vote on this proposal');

    const rationale = dto.rationale?.trim() || null;
    // Validate the selection BEFORE touching prior votes, so a rejected re-vote can't wipe a
    // voter's existing valid vote. Vote change is allowed during the period.
    if (fresh.internalType === InternalType.POLL) {
      const cfg = (fresh.pollOptions ?? {}) as { multiple?: boolean; options?: string[] };
      const options = cfg.options ?? [];
      const chosen = dto.options ?? [];
      if (chosen.length === 0) throw new BadRequestException('select at least one option');
      if (!cfg.multiple && chosen.length !== 1) throw new BadRequestException('this poll allows exactly one option');
      for (const o of chosen) if (!options.includes(o)) throw new BadRequestException(`unknown option: ${o}`);
      await this.prisma.vote.deleteMany({ where: { proposalId, drepId: drep.id, phase: VotePhase.INTERNAL } });
      for (const o of chosen) {
        await this.prisma.vote.create({ data: { proposalId, drepId: drep.id, phase: VotePhase.INTERNAL, choice: o, rationale } });
      }
    } else {
      const choice = dto.choice;
      if (!choice || ![VoteChoice.YES, VoteChoice.NO, VoteChoice.ABSTAIN].includes(choice as VoteChoice)) {
        throw new BadRequestException('choice must be YES, NO or ABSTAIN');
      }
      await this.prisma.vote.deleteMany({ where: { proposalId, drepId: drep.id, phase: VotePhase.INTERNAL } });
      await this.prisma.vote.create({ data: { proposalId, drepId: drep.id, phase: VotePhase.INTERNAL, choice, rationale } });
    }
    return this.detail(proposalId, userId);
  }

  /** §10 — the submitter moves the voting end (extend or shorten); content stays frozen. */
  async extendVoting(userId: string, proposalId: string, votingEndAt: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.type !== ProposalType.INTERNAL) throw new NotFoundException('internal proposal not found');
    if (proposal.submitterUserId !== userId) throw new ForbiddenException('only the submitter can change the voting end');
    if (proposal.status !== ProposalStatus.ACTIVE) throw new ConflictException('voting has already concluded');
    const end = new Date(votingEndAt);
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) throw new BadRequestException('the new end must be in the future');
    await this.prisma.proposal.update({ where: { id: proposalId }, data: { votingEndAt: end } });
    return this.detail(proposalId, userId);
  }

  // ---- listing + detail -----------------------------------------------------

  async list(viewerUserId: string) {
    const isBoard = await this.isBoardUser(viewerUserId);
    const all = await this.prisma.proposal.findMany({
      where: { type: ProposalType.INTERNAL },
      orderBy: { createdAt: 'desc' },
      include: { submitterUser: { select: { displayName: true } } },
    });
    const out = [];
    for (const p of all) {
      await this.maybeFinalize(p);
      if (p.isPrivate && !isBoard) continue; // PRIVATE → board only
      out.push(await this.summary(p.id, { userId: viewerUserId, isBoard }));
    }
    return out;
  }

  /** Public entry: resolve the viewer's board status, then build the detail. */
  async detail(proposalId: string, viewerUserId: string) {
    return this.build(proposalId, { userId: viewerUserId, isBoard: await this.isBoardUser(viewerUserId) });
  }

  private async build(proposalId: string, ctx: Ctx) {
    const p = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { submitterUser: { select: { displayName: true } }, submitterDrep: { select: { drepIdOnchain: true } } },
    });
    if (!p || p.type !== ProposalType.INTERNAL) throw new NotFoundException('internal proposal not found');
    await this.maybeFinalize(p);
    if (p.isPrivate && !ctx.isBoard) throw new ForbiddenException('this internal proposal is private to the board');

    const fresh = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    const tally = await this.tally(proposalId);
    const myDrep = await this.prisma.drep.findUnique({ where: { userId: ctx.userId }, select: { id: true } });
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    const eligibleEntry = myDrep && snapshot
      ? await this.prisma.voteSnapshotEntry.findUnique({ where: { snapshotId_drepId: { snapshotId: snapshot.id, drepId: myDrep.id } } })
      : null;
    const myVotes = myDrep
      ? (await this.prisma.vote.findMany({ where: { proposalId, drepId: myDrep.id, phase: VotePhase.INTERNAL } })).map((v) => v.choice)
      : [];
    const anchor = await this.prisma.anchor.findFirst({ where: { proposalId, kind: 'internal' }, orderBy: { createdAt: 'desc' } });
    const pollCfg = (p.pollOptions ?? null) as { multiple?: boolean; options?: string[] } | null;

    return {
      id: p.id,
      publicId: p.publicId,
      title: p.title,
      contentMd: p.contentMd,
      internalType: p.internalType,
      votersScope: p.votersScope,
      thresholdKind: p.thresholdKind,
      votingType: p.votingType,
      isPrivate: p.isPrivate,
      status: fresh?.status ?? p.status,
      submitter: p.submitterUser?.displayName ?? null,
      submitterDrepId: p.submitterDrep?.drepIdOnchain ?? null,
      isMine: p.submitterUserId === ctx.userId,
      actors: (p.actors as string[] | null) ?? null,
      deliveryDate: p.deliveryDate,
      poll: pollCfg ? { multiple: !!pollCfg.multiple, options: pollCfg.options ?? [] } : null,
      thresholdPct: p.approvalThresholdPct ? Number(p.approvalThresholdPct) : null,
      votingStartAt: p.votingStartAt,
      votingEndAt: p.votingEndAt,
      resultFinalizedAt: p.resultFinalizedAt,
      canVote: !!eligibleEntry && (fresh?.status ?? p.status) === ProposalStatus.ACTIVE,
      myVotes,
      tally,
      anchorTxHash: anchor?.txHash ?? null,
      anchorHash: anchor?.hash ?? null,
    };
  }

  private async summary(proposalId: string, ctx: Ctx) {
    const d = await this.build(proposalId, ctx);
    return {
      id: d.id,
      publicId: d.publicId,
      title: d.title,
      internalType: d.internalType,
      votersScope: d.votersScope,
      votingType: d.votingType,
      thresholdKind: d.thresholdKind,
      isPrivate: d.isPrivate,
      status: d.status,
      submitter: d.submitter,
      votingEndAt: d.votingEndAt,
      thresholdPct: d.thresholdPct,
      tally: d.tally,
    };
  }

  // ---- tally + finalize -----------------------------------------------------

  /** §4.4 for threshold proposals; per-option counts for polls. */
  private async tally(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId }, include: { entries: true } });
    const votes = await this.prisma.vote.findMany({ where: { proposalId, phase: VotePhase.INTERNAL } });
    const powerByDrep = new Map((snapshot?.entries ?? []).map((e) => [e.drepId, Number(e.finalPower ?? 0)]));
    const eligible = snapshot?.entries.length ?? 0;
    const thresholdPct = proposal?.approvalThresholdPct ? Number(proposal.approvalThresholdPct) : 67;

    if (proposal?.internalType === InternalType.POLL) {
      const cfg = (proposal.pollOptions ?? {}) as { options?: string[] };
      const counts = new Map<string, { power: number; voters: number }>();
      for (const o of cfg.options ?? []) counts.set(o, { power: 0, voters: 0 });
      const votersSet = new Set<string>();
      for (const v of votes) {
        votersSet.add(v.drepId);
        const c = counts.get(v.choice) ?? { power: 0, voters: 0 };
        c.power += powerByDrep.get(v.drepId) ?? 0;
        c.voters += 1;
        counts.set(v.choice, c);
      }
      return {
        kind: 'POLL' as const,
        eligible,
        voted: votersSet.size,
        options: [...counts.entries()].map(([option, c]) => ({ option, power: round2(c.power), voters: c.voters })),
      };
    }

    // INSTRUCTIVE / INFORMATIVE — §4.4 threshold tally.
    const choiceByDrep = new Map(votes.map((v) => [v.drepId, v.choice]));
    let yesPower = 0;
    let abstainPower = 0;
    let totalPower = 0;
    let cast = 0;
    for (const e of snapshot?.entries ?? []) {
      const fp = Number(e.finalPower ?? 0);
      totalPower += fp;
      const c = choiceByDrep.get(e.drepId);
      if (c) cast++;
      if (c === VoteChoice.YES) yesPower += fp;
      else if (c === VoteChoice.ABSTAIN) abstainPower += fp;
    }
    const t = { yesPower, totalPower, abstainPower, thresholdPct };
    return {
      kind: 'THRESHOLD' as const,
      eligible,
      cast,
      yesPower: round2(yesPower),
      abstainPower: round2(abstainPower),
      totalPower: round2(totalPower),
      denominator: round2(totalPower - abstainPower),
      ratioPct: round2(approvalRatio(t) * 100),
      thresholdPct,
      approved: isApproved(t),
    };
  }

  /** Auto-conclude once the voting period ends (called on every read + vote). */
  private async maybeFinalize(p: { id: string; status: string; votingEndAt: Date | null; type: string }) {
    if (p.type !== ProposalType.INTERNAL) return;
    if (p.status !== ProposalStatus.ACTIVE) return;
    if (!p.votingEndAt || p.votingEndAt.getTime() > Date.now()) return;
    await this.finalize(p.id);
  }

  /** Conclude voting → APPROVED/REJECTED (threshold) or APPROVED (poll), and anchor on-chain. */
  async finalize(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.type !== ProposalType.INTERNAL) throw new NotFoundException('internal proposal not found');
    if (proposal.status !== ProposalStatus.ACTIVE) {
      return { id: proposalId, publicId: proposal.publicId, status: proposal.status, tally: await this.tally(proposalId) };
    }
    const t = await this.tally(proposalId);
    // A poll has no pass/fail — it concludes (APPROVED). Threshold proposals pass iff §4.4 met.
    const approved = t.kind === 'POLL' ? true : t.approved;
    const status = approved ? ProposalStatus.APPROVED : ProposalStatus.REJECTED;
    await this.prisma.proposal.update({ where: { id: proposalId }, data: { status, resultFinalizedAt: new Date() } });
    await this.anchorResult(proposalId, status, t).catch(() => undefined); // anchoring never blocks the conclusion
    return { id: proposalId, publicId: proposal.publicId, status, tally: t };
  }

  private async anchorResult(proposalId: string, status: string, t: Awaited<ReturnType<InternalProposalsService['tally']>>) {
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!p) return;
    const voteList = await this.voteList(proposalId);
    // Date-independent: hash the title + content only (the voting end can move).
    const docHash = sha256hex(`${p.title}\n${p.contentMd}`);
    const balanced = p.votingType === VotingType.BALANCED;
    const outcome =
      t.kind === 'POLL'
        ? `CONCLUDED — ${t.options.map((o) => `${o.option}: ${balanced ? o.power : o.voters}`).join(', ')}`
        : status;
    await this.anchor.anchorResult({
      kind: 'internal',
      subject: GovSubject.INTERNAL,
      style: balanced ? VotingStyle.BALANCED : VotingStyle.ONE_PERSON_ONE_VOTE,
      ref: p.title,
      publicId: p.publicId,
      docHash,
      proposalId,
      roundId: null,
      votes: voteList.map((v) => ({ drep: v.drep, vote: v.choice, power: balanced ? v.weight : undefined })),
      preimageVotes: voteList,
      outcome,
      yes: t.kind === 'THRESHOLD' ? round2(t.yesPower) : 0,
      no: t.kind === 'THRESHOLD' ? round2(t.totalPower - t.yesPower - t.abstainPower) : 0,
      threshold: t.kind === 'THRESHOLD' ? t.thresholdPct : 0,
      totalPower: t.kind === 'THRESHOLD' ? round2(t.totalPower) : undefined,
    });
  }

  /** Each internal vote: on-chain DRep id, the choice (or poll option), weight, rationale. */
  private async voteList(proposalId: string) {
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId }, include: { entries: true } });
    const powerByDrep = new Map((snapshot?.entries ?? []).map((e) => [e.drepId, Number(e.finalPower ?? 0)]));
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.INTERNAL },
      include: { drep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } },
      orderBy: { castAt: 'asc' },
    });
    return votes.map((v) => ({
      drep: v.drep.drepIdOnchain,
      displayName: v.drep.user?.displayName ?? null,
      choice: v.choice,
      weight: round2(powerByDrep.get(v.drepId) ?? 0),
      rationale: v.rationale ?? null,
    }));
  }

  private async isBoardUser(userId: string): Promise<boolean> {
    const u = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { drepKeyHash: true } });
    if (!u?.drepKeyHash) return false;
    return !!(await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: u.drepKeyHash } }));
  }
}
