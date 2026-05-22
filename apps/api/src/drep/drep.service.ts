import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DRepStatus, PLATFORM_CONFIG_DEFAULTS } from '@drep-dao/shared';
import { isStakeAddress, stakeKeyHashFromBech32 } from '@drep-dao/cardano';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { AdmissionVoteDto, DrepApplicationDto, UpdateDrepDto } from './dto';

@Injectable()
export class DrepService {
  constructor(private readonly prisma: PrismaService) {}

  /** §2/§25.5 — board approves an Expert (a non-DRep ADA holder) by stake address. */
  async approveExpert(stakeAddress: string, displayName?: string, subcategoryIds?: string[]) {
    if (!isStakeAddress(stakeAddress)) {
      throw new BadRequestException('stakeAddress must be a bech32 stake address');
    }
    const stakeKeyHash = stakeKeyHashFromBech32(stakeAddress);
    const user = await this.prisma.appUser.upsert({
      where: { stakeKeyHash },
      update: { stakeAddress },
      create: { stakeKeyHash, stakeAddress },
    });
    const existing = await this.prisma.expert.findFirst({ where: { userId: user.id } });
    if (existing) {
      return this.prisma.expert.update({
        where: { id: existing.id },
        data: {
          approvedByBoard: true,
          ...(displayName ? { displayName } : {}),
          ...(subcategoryIds ? { subcategoryIds } : {}),
        },
      });
    }
    return this.prisma.expert.create({
      data: {
        userId: user.id,
        displayName: displayName ?? 'Expert',
        subcategoryIds: subcategoryIds ?? [],
        approvedByBoard: true,
      },
    });
  }

  async listExperts() {
    const experts = await this.prisma.expert.findMany({
      include: { user: { select: { stakeAddress: true } } },
      orderBy: { displayName: 'asc' },
    });
    return experts.map((e) => ({
      id: e.id,
      displayName: e.displayName,
      stakeAddress: e.user.stakeAddress,
      subcategoryIds: e.subcategoryIds,
      approvedByBoard: e.approvedByBoard,
    }));
  }

  async getMine(userId: string) {
    return this.prisma.drep.findUnique({
      where: { userId },
      include: { admissionVotesReceived: true },
    });
  }

  /** §14.2 — submit (or re-submit, if previously rejected/removed) an application. */
  async apply(userId: string, dto: DrepApplicationDto) {
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
      drepIdOnchain: dto.drepIdOnchain,
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

  /** §25.5 — board view of pending applications with each one's running tally. */
  async listApplications() {
    const dreps = await this.prisma.drep.findMany({
      where: { status: DRepStatus.PENDING_ADMISSION },
      include: {
        user: { select: { stakeAddress: true, displayName: true, createdAt: true } },
        admissionVotesReceived: true,
      },
      orderBy: { user: { createdAt: 'asc' } },
    });
    const threshold = await this.approvalThreshold();
    return dreps.map((d) => ({
      drepId: d.id,
      drepIdOnchain: d.drepIdOnchain,
      displayName: d.user.displayName,
      stakeAddress: d.user.stakeAddress,
      bio: d.bio,
      subcategoryIds: d.subcategoryIds,
      socials: d.socials,
      contact: d.contact,
      yes: d.admissionVotesReceived.filter((v) => v.choice === 'YES').length,
      no: d.admissionVotesReceived.filter((v) => v.choice === 'NO').length,
      threshold,
    }));
  }

  /** §14.2 — a board member votes on an application; admit/reject when decided. */
  async voteOnApplication(boardUserId: string, applicantDrepId: string, dto: AdmissionVoteDto) {
    if (dto.choice === 'NO' && !dto.feedback?.trim()) {
      throw new BadRequestException('written feedback is required for a NO vote');
    }

    const applicant = await this.prisma.drep.findUnique({ where: { id: applicantDrepId } });
    if (!applicant) throw new NotFoundException('applicant not found');
    if (applicant.status !== DRepStatus.PENDING_ADMISSION) {
      throw new ConflictException('this application is not pending');
    }

    const board = await this.prisma.drep.findUnique({ where: { userId: boardUserId } });
    if (!board) throw new ForbiddenException('board members only');
    if (board.id === applicant.id) throw new BadRequestException('cannot vote on your own application');

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
    const boardCount = await this.prisma.boardMembership.count({ where: { endedAt: null } });

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
