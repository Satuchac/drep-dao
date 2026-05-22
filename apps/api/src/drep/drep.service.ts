import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DRepStatus,
  PLATFORM_CONFIG_DEFAULTS,
  basePower,
  clampMerit,
  meritMultiplier,
} from '@drep-dao/shared';
import { drepIdFromKeyHashHex } from '@drep-dao/cardano';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AdmissionVoteDto, DrepApplicationDto, ExpertApplicationDto, UpdateDrepDto } from './dto';

@Injectable()
export class DrepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
  ) {}

  /**
   * §2/§4 — all DAO members (board + admitted DReps) with balanced voting power.
   * VotingPower = log10(stake_ADA) × (1 + merit/200). Stake is the DRep's
   * on-chain voting power (Koios `amount`); merit is the clamped ledger sum.
   */
  async listDaoMembers() {
    const seats = await this.prisma.boardSeat.findMany({ orderBy: { addedAt: 'asc' } });
    const boardKeys = new Set(seats.map((s) => s.drepKeyHash));
    const admitted = await this.prisma.drep.findMany({
      where: { status: DRepStatus.ADMITTED },
      include: { user: { select: { displayName: true, drepKeyHash: true, drepRegistered: true, stakeAddress: true } } },
    });

    // Union: every board seat is a member (even before first login → no Drep row
    // yet), plus admitted DReps still registered on-chain. Keyed by drep id.
    interface Row { drepId: string; displayName: string; isBoard: boolean; drepRowId?: string; stakeAddress?: string }
    const byId = new Map<string, Row>();
    for (const s of seats) byId.set(s.drepId, { drepId: s.drepId, displayName: s.displayName, isBoard: true });
    for (const d of admitted) {
      const isBoard = d.user.drepKeyHash ? boardKeys.has(d.user.drepKeyHash) : false;
      if (!isBoard && !d.user.drepRegistered) continue; // skip lapsed non-board members
      const existing = byId.get(d.drepIdOnchain);
      if (existing) {
        existing.drepRowId = d.id;
        existing.stakeAddress = d.user.stakeAddress;
        if (d.user.displayName) existing.displayName = d.user.displayName; // prefer self-set name
      } else {
        byId.set(d.drepIdOnchain, {
          drepId: d.drepIdOnchain,
          displayName: d.user.displayName ?? 'DRep',
          isBoard,
          drepRowId: d.id,
          stakeAddress: d.user.stakeAddress,
        });
      }
    }
    const rows = [...byId.values()];

    // §4 — on-chain DRep VOTING power (CIP-1694 vote delegation), live, plus
    // the count of accounts that delegated their vote to each DRep.
    const vp = await this.cardano.drepVotingPower(rows.map((r) => r.drepId));

    const members = await Promise.all(
      rows.map(async (r) => {
        const merit = r.drepRowId ? await this.currentMerit(r.drepRowId) : 0;
        const power = vp.get(r.drepId) ?? { votingPowerLovelace: 0n, delegators: 0 };
        const base = basePower(power.votingPowerLovelace);
        const mult = meritMultiplier(merit);
        return {
          drepId: r.drepId,
          displayName: r.displayName,
          isBoard: r.isBoard,
          votingPowerAda: Math.round(Number(power.votingPowerLovelace) / 1_000_000),
          delegators: power.delegators,
          merit,
          basePower: round(base),
          meritMultiplier: round(mult),
          adjustedPower: round(base * mult),
        };
      }),
    );
    members.sort((a, b) => b.adjustedPower - a.adjustedPower || (b.isBoard ? 1 : 0) - (a.isBoard ? 1 : 0));
    return members;
  }

  /** Current merit = clamped sum of the DRep's merit-ledger deltas (§13). */
  private async currentMerit(drepId: string): Promise<number> {
    const agg = await this.prisma.meritLedger.aggregate({ where: { drepId }, _sum: { delta: true } });
    return clampMerit(agg._sum.delta ? Number(agg._sum.delta) : 0);
  }

  /** §2/§14 — an ADA holder applies to become an Expert (board then approves). */
  async applyExpert(userId: string, dto: ExpertApplicationDto) {
    const existing = await this.prisma.expert.findFirst({ where: { userId } });
    if (existing?.approvedByBoard) throw new ConflictException('you are already an approved Expert');
    const data = {
      displayName: dto.displayName,
      bio: dto.bio ?? null,
      subcategoryIds: dto.subcategoryIds ?? [],
      approvedByBoard: false,
    };
    if (existing) return this.prisma.expert.update({ where: { id: existing.id }, data });
    return this.prisma.expert.create({ data: { userId, ...data } });
  }

  /** The user's own Expert record (application or approval), if any. */
  async getMyExpert(userId: string) {
    return this.prisma.expert.findFirst({ where: { userId } });
  }

  /** Board view — pending Expert applications awaiting approval. */
  async listExpertApplications() {
    const experts = await this.prisma.expert.findMany({
      where: { approvedByBoard: false },
      include: { user: { select: { stakeAddress: true, displayName: true } } },
      orderBy: { displayName: 'asc' },
    });
    return experts.map((e) => ({
      id: e.id,
      displayName: e.displayName,
      bio: e.bio,
      stakeAddress: e.user.stakeAddress,
      subcategoryIds: e.subcategoryIds,
    }));
  }

  /** Board approves a pending Expert application. */
  async approveExpertById(id: string) {
    const expert = await this.prisma.expert.findUnique({ where: { id } });
    if (!expert) throw new NotFoundException('expert application not found');
    return this.prisma.expert.update({ where: { id }, data: { approvedByBoard: true } });
  }

  /** Board rejects (removes) a pending Expert application. */
  async rejectExpertById(id: string) {
    await this.prisma.expert.delete({ where: { id } }).catch(() => undefined);
    return { ok: true };
  }

  /** Approved Experts — listed in the DAO dashboard (§2). */
  async listApprovedExperts() {
    const experts = await this.prisma.expert.findMany({
      where: { approvedByBoard: true },
      orderBy: { displayName: 'asc' },
    });
    return experts.map((e) => ({
      id: e.id,
      displayName: e.displayName,
      bio: e.bio,
      subcategoryIds: e.subcategoryIds,
    }));
  }

  /** The user's own DRep profile + admission progress (votes, rationales, tally). */
  async getMine(userId: string) {
    const drep = await this.prisma.drep.findUnique({
      where: { userId },
      include: {
        admissionVotesReceived: {
          include: { voter: { include: { user: { select: { displayName: true, drepKeyHash: true } } } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!drep) return null;
    const threshold = await this.approvalThreshold();
    const votes = drep.admissionVotesReceived;
    // Fall back to the board-seat name when a board member hasn't set a display name.
    const seats = await this.prisma.boardSeat.findMany();
    const seatName = new Map(seats.map((s) => [s.drepKeyHash, s.displayName]));
    const voterLabel = (v: (typeof votes)[number]) =>
      v.voter.user.displayName ??
      (v.voter.user.drepKeyHash && seatName.get(v.voter.user.drepKeyHash)) ??
      'Board member';
    return {
      id: drep.id,
      status: drep.status,
      drepIdOnchain: drep.drepIdOnchain,
      bio: drep.bio,
      socials: drep.socials,
      contact: drep.contact,
      subcategoryIds: drep.subcategoryIds,
      kycOptin: drep.kycOptin,
      callsOptin: drep.callsOptin,
      admissionCallOptin: drep.admissionCallOptin,
      yes: votes.filter((v) => v.choice === 'YES').length,
      no: votes.filter((v) => v.choice === 'NO').length,
      threshold,
      admissionVotesReceived: votes.map((v) => ({
        choice: v.choice,
        feedback: v.feedback,
        voterName: voterLabel(v),
      })),
    };
  }

  /** §14.2 — a registered on-chain DRep requests to join the DAO (or re-applies
   * after a previous rejection/removal). The DRep ID is taken from the wallet's
   * verified CIP-95 key, never from client input. */
  async apply(userId: string, dto: DrepApplicationDto) {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('user not found');
    if (!user.drepKeyHash || !user.drepRegistered) {
      throw new ForbiddenException(
        'only a registered on-chain DRep can join the DAO — register your DRep key on-chain, then sign in again',
      );
    }
    const drepIdOnchain = drepIdFromKeyHashHex(user.drepKeyHash);

    const existing = await this.prisma.drep.findUnique({ where: { userId } });
    if (existing?.status === DRepStatus.ADMITTED) {
      throw new ConflictException('already an admitted DRep');
    }
    if (existing?.status === DRepStatus.PENDING_ADMISSION) {
      throw new ConflictException('an application is already pending');
    }

    if (dto.displayName !== undefined) {
      await this.prisma.appUser.update({ where: { id: userId }, data: { displayName: dto.displayName } });
    }

    const data = {
      drepIdOnchain,
      status: DRepStatus.PENDING_ADMISSION,
      bio: dto.bio ?? null,
      socials: (dto.socials ?? undefined) as Prisma.InputJsonValue | undefined,
      contact: (dto.contact ?? undefined) as Prisma.InputJsonValue | undefined,
      subcategoryIds: dto.subcategoryIds ?? [],
      kycOptin: dto.kycOptin ?? false,
      callsOptin: dto.callsOptin ?? false,
      admissionCallOptin: dto.admissionCallOptin ?? false,
      admittedAt: null,
      removedAt: null,
    };

    try {
      if (existing) {
        await this.prisma.admissionVote.deleteMany({ where: { drepId: existing.id } });
        return await this.prisma.drep.update({ where: { id: existing.id }, data });
      }
      return await this.prisma.drep.create({ data: { userId, ...data } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('that DRep ID is already registered to another account');
      }
      throw e;
    }
  }

  async updateMine(userId: string, dto: UpdateDrepDto) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new NotFoundException('no DRep profile — apply first');

    if (dto.displayName !== undefined) {
      await this.prisma.appUser.update({ where: { id: userId }, data: { displayName: dto.displayName } });
    }

    return this.prisma.drep.update({
      where: { id: drep.id },
      data: {
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.socials !== undefined ? { socials: dto.socials as Prisma.InputJsonValue } : {}),
        ...(dto.contact !== undefined ? { contact: dto.contact as Prisma.InputJsonValue } : {}),
        ...(dto.subcategoryIds !== undefined ? { subcategoryIds: dto.subcategoryIds } : {}),
        ...(dto.kycOptin !== undefined ? { kycOptin: dto.kycOptin } : {}),
        ...(dto.callsOptin !== undefined ? { callsOptin: dto.callsOptin } : {}),
        ...(dto.admissionCallOptin !== undefined ? { admissionCallOptin: dto.admissionCallOptin } : {}),
      },
    });
  }

  /** §25.5 — board view of pending applications + tally + this board member's own vote. */
  async listApplications(boardUserId: string) {
    const dreps = await this.prisma.drep.findMany({
      where: { status: DRepStatus.PENDING_ADMISSION },
      include: {
        user: { select: { stakeAddress: true, displayName: true, createdAt: true } },
        admissionVotesReceived: true,
      },
      orderBy: { user: { createdAt: 'asc' } },
    });
    const threshold = await this.approvalThreshold();
    // The reviewing board member's own DRep id (to surface "your vote").
    const me = await this.prisma.drep.findUnique({ where: { userId: boardUserId }, select: { id: true } });
    return dreps.map((d) => {
      const myVote = me ? d.admissionVotesReceived.find((v) => v.boardDrepId === me.id) : undefined;
      return {
        drepId: d.id,
        drepIdOnchain: d.drepIdOnchain,
        displayName: d.user.displayName,
        stakeAddress: d.user.stakeAddress,
        bio: d.bio,
        subcategoryIds: d.subcategoryIds,
        socials: d.socials,
        contact: d.contact,
        kycOptin: d.kycOptin,
        callsOptin: d.callsOptin,
        admissionCallOptin: d.admissionCallOptin,
        yes: d.admissionVotesReceived.filter((v) => v.choice === 'YES').length,
        no: d.admissionVotesReceived.filter((v) => v.choice === 'NO').length,
        threshold,
        myVote: myVote ? { choice: myVote.choice, feedback: myVote.feedback } : null,
      };
    });
  }

  /** §14.2 — a board member votes on an application; admit/reject when decided. */
  async voteOnApplication(boardUserId: string, applicantDrepId: string, dto: AdmissionVoteDto) {
    if (!dto.feedback?.trim()) {
      throw new BadRequestException('a written rationale is required for every vote (YES or NO)');
    }

    const applicant = await this.prisma.drep.findUnique({ where: { id: applicantDrepId } });
    if (!applicant) throw new NotFoundException('applicant not found');
    if (applicant.status !== DRepStatus.PENDING_ADMISSION) {
      throw new ConflictException('this application is not pending');
    }

    const board = await this.prisma.drep.findUnique({
      where: { userId: boardUserId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    if (!board) throw new ForbiddenException('board members only');
    if (board.id === applicant.id) throw new BadRequestException('cannot vote on your own application');
    // Enforce board-only here too (defence in depth beyond the controller guard).
    const seat = board.user.drepKeyHash
      ? await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: board.user.drepKeyHash } })
      : null;
    if (!seat) throw new ForbiddenException('only seated board members can vote on admissions');

    await this.prisma.admissionVote.upsert({
      where: { drepId_boardDrepId: { drepId: applicant.id, boardDrepId: board.id } },
      update: { choice: dto.choice, feedback: dto.feedback ?? null },
      create: {
        drepId: applicant.id,
        boardDrepId: board.id,
        choice: dto.choice,
        feedback: dto.feedback ?? null,
      },
    });

    const votes = await this.prisma.admissionVote.findMany({ where: { drepId: applicant.id } });
    const yes = votes.filter((v) => v.choice === 'YES').length;
    const no = votes.filter((v) => v.choice === 'NO').length;
    const threshold = await this.approvalThreshold();
    const boardCount = await this.prisma.boardSeat.count();

    let status: string = applicant.status;
    if (yes >= threshold) {
      status = DRepStatus.ADMITTED;
    } else if (no > boardCount - threshold) {
      // YES can no longer reach the threshold → rejected
      status = DRepStatus.REJECTED;
    }

    if (status !== applicant.status) {
      await this.prisma.drep.update({
        where: { id: applicant.id },
        data: { status, admittedAt: status === DRepStatus.ADMITTED ? new Date() : null },
      });
    }

    return { applicantDrepId: applicant.id, yes, no, threshold, boardCount, status };
  }

  private async approvalThreshold(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({
      where: { key: 'ADMISSION_APPROVAL_VOTES' },
    });
    const v = row?.value;
    return typeof v === 'number' ? v : PLATFORM_CONFIG_DEFAULTS.ADMISSION_APPROVAL_VOTES;
  }
}

/** Round to 2 decimals for display. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
