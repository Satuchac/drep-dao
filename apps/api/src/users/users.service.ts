import { Injectable, Logger } from '@nestjs/common';
import { Role, DRepStatus } from '@drep-dao/shared';
import { drepIdFromKeyHashHex } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';

export interface UserProfile {
  user: {
    id: string;
    stakeAddress: string;
    stakeKeyHash: string;
    displayName: string | null;
    createdAt: Date;
  };
  roles: Role[];
  /** On-chain DRep identity — the source of truth for the DREP role (§22.4). */
  onchainDrep: { registered: boolean; drepId: string | null };
  /** DAO membership (admission) status — separate from on-chain registration. */
  daoMembership: { status: string; admittedAt: Date | null } | null;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
  ) {}

  /** §22.1 — auto-create (or refresh) a user keyed by stake key hash on login.
   * Records the wallet's CIP-95 DRep key hash (if provided) and, if present,
   * checks on-chain whether that DRep is registered + active (§22.4). */
  async upsertByStakeKey(params: { stakeKeyHash: string; stakeAddress: string; drepKeyHash?: string }) {
    const drepKeyHash = params.drepKeyHash ?? undefined;
    // undefined = couldn't determine (no key, or chain query failed) → preserve prior value.
    const registered = drepKeyHash ? await this.checkOnchainRegistration(drepKeyHash) : undefined;
    return this.prisma.appUser.upsert({
      where: { stakeKeyHash: params.stakeKeyHash },
      update: {
        stakeAddress: params.stakeAddress,
        ...(drepKeyHash ? { drepKeyHash } : {}),
        ...(registered !== undefined ? { drepRegistered: registered } : {}),
      },
      create: {
        stakeKeyHash: params.stakeKeyHash,
        stakeAddress: params.stakeAddress,
        drepKeyHash,
        drepRegistered: registered ?? false,
      },
    });
  }

  /** Board members are admitted DAO members by definition — give them a profile row. */
  private async ensureBoardMembershipRow(userId: string, drepKeyHash: string) {
    const drepId = safeDrepId(drepKeyHash);
    if (!drepId) return null;
    try {
      return await this.prisma.drep.create({
        data: {
          userId,
          drepIdOnchain: drepId,
          status: DRepStatus.ADMITTED,
          admittedAt: new Date(),
          subcategoryIds: [],
        },
      });
    } catch {
      // race / unique conflict — re-fetch whatever exists now.
      return this.prisma.drep.findUnique({ where: { userId } });
    }
  }

  /** Is this CIP-95 DRep key a registered + active on-chain DRep? undefined if unknown. */
  private async checkOnchainRegistration(drepKeyHash: string): Promise<boolean | undefined> {
    try {
      const drepId = drepIdFromKeyHashHex(drepKeyHash);
      const statuses = await this.cardano.verifyDReps([drepId]);
      return statuses.get(drepId)?.registered ?? false;
    } catch (e) {
      this.logger.warn(`on-chain DRep check failed for ${drepKeyHash}: ${e instanceof Error ? e.message : e}`);
      return undefined;
    }
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

    // §22.4 — DREP is an on-chain role: the wallet IS a registered+active DRep
    // (verified via Koios at login), NOT a status we grant in our DB. Wallets
    // that aren't registered on-chain are plain ADA holders (viewer/submitter).
    const isRegisteredDRep = user.drepRegistered;

    // §2/§14 — board members are DAO members by definition; they don't apply.
    // Ensure they have a profile row (ADMITTED) so they can edit bio/etc. and
    // appear in the members overview.
    let drep: { status: string; admittedAt: Date | null } | null = user.drep;
    if (isBoard && !drep && user.drepKeyHash) {
      drep = await this.ensureBoardMembershipRow(user.id, user.drepKeyHash);
    }

    // A non-board DAO member must still be a registered on-chain DRep; if their
    // registration lapses they fall back to ADA holder (board seats are exempt).
    const isDaoMember = isBoard || (drep?.status === DRepStatus.ADMITTED && isRegisteredDRep);

    const roles: Role[] = [Role.VIEWER, Role.SUBMITTER];
    if (isRegisteredDRep || isBoard) roles.push(Role.DREP);
    if (isDaoMember) roles.push(Role.DAO_MEMBER);
    if (isBoard) roles.push(Role.BOARD);
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
      onchainDrep: {
        registered: isRegisteredDRep,
        drepId: user.drepKeyHash ? safeDrepId(user.drepKeyHash) : null,
      },
      daoMembership: drep ? { status: drep.status, admittedAt: drep.admittedAt } : null,
    };
  }
}

/** CIP-129 drep1… from a stored 28-byte DRep key hash; null on malformed input. */
function safeDrepId(drepKeyHash: string): string | null {
  try {
    return drepIdFromKeyHashHex(drepKeyHash);
  } catch {
    return null;
  }
}
