import { Injectable } from '@nestjs/common';
import { Role, DRepStatus } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface UserProfile {
  user: {
    id: string;
    stakeAddress: string;
    stakeKeyHash: string;
    displayName: string | null;
    createdAt: Date;
  };
  roles: Role[];
  drep: { status: string; admittedAt: Date | null } | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** §22.1 — auto-create (or refresh) a user keyed by stake key hash on login.
   * Also records the wallet's CIP-95 DRep key hash (if provided) for role matching. */
  async upsertByStakeKey(params: { stakeKeyHash: string; stakeAddress: string; drepKeyHash?: string }) {
    const drepKeyHash = params.drepKeyHash ?? undefined;
    return this.prisma.appUser.upsert({
      where: { stakeKeyHash: params.stakeKeyHash },
      update: { stakeAddress: params.stakeAddress, ...(drepKeyHash ? { drepKeyHash } : {}) },
      create: { stakeKeyHash: params.stakeKeyHash, stakeAddress: params.stakeAddress, drepKeyHash },
    });
  }

  /** Profile + derived roles (§2). Returns null if the user no longer exists. */
  async getProfile(userId: string): Promise<UserProfile | null> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      include: { drep: { include: { boardMemberships: true } }, experts: true },
    });
    if (!user) return null;

    // §17.5 — board membership is keyed by the wallet's on-chain DRep key hash
    // matching a genesis board seat (NOT by stake address / a DB flag).
    const isBoard = user.drepKeyHash
      ? (await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: user.drepKeyHash } })) !== null
      : false;

    const roles: Role[] = [Role.VIEWER, Role.SUBMITTER];
    const drep = user.drep;
    if (isBoard) roles.push(Role.BOARD);
    if (isBoard || (drep && drep.status === DRepStatus.ADMITTED)) {
      roles.push(Role.DREP);
    }
    // §2 Expert — a non-DRep approved by the board for milestone review.
    if (user.experts.some((e) => e.approvedByBoard)) {
      roles.push(Role.EXPERT);
    }

    return {
      user: {
        id: user.id,
        stakeAddress: user.stakeAddress,
        stakeKeyHash: user.stakeKeyHash,
        displayName: user.displayName,
        createdAt: user.createdAt,
      },
      roles,
      drep: drep ? { status: drep.status, admittedAt: drep.admittedAt } : null,
    };
  }
}
