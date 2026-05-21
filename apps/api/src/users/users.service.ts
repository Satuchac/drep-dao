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

  /** §22.1 — auto-create (or refresh) a user keyed by stake key hash on login. */
  async upsertByStakeKey(params: { stakeKeyHash: string; stakeAddress: string }) {
    return this.prisma.appUser.upsert({
      where: { stakeKeyHash: params.stakeKeyHash },
      update: { stakeAddress: params.stakeAddress },
      create: { stakeKeyHash: params.stakeKeyHash, stakeAddress: params.stakeAddress },
    });
  }

  /** Profile + derived roles (§2). Returns null if the user no longer exists. */
  async getProfile(userId: string): Promise<UserProfile | null> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      include: { drep: { include: { boardMemberships: true } } },
    });
    if (!user) return null;

    const roles: Role[] = [Role.VIEWER, Role.SUBMITTER];
    const drep = user.drep;
    if (drep && drep.status === DRepStatus.ADMITTED) {
      roles.push(Role.DREP);
      if (drep.boardMemberships.some((m) => m.endedAt === null)) {
        roles.push(Role.BOARD);
      }
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
