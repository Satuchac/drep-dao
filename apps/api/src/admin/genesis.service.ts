import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DRepStatus } from '@drep-dao/shared';
import { isStakeAddress, stakeKeyHashFromBech32 } from '@drep-dao/cardano';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AdminAuditService } from './admin-audit.service';

const PROPOSED_KEY = 'admin:genesis:proposed';

interface FoundingMember {
  display_name: string;
  stake_address: string;
  drep_id: string;
}
export interface GenesisFile {
  deployment?: { name?: string; network?: string; deployed_at?: string };
  founding_board: FoundingMember[];
  multisig_native_script?: unknown;
  anchor_hot_wallet_pubkeyhash?: string;
}

@Injectable()
export class GenesisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AdminAuditService,
  ) {}

  private async ensureState() {
    return this.prisma.platformState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }

  private validate(payload: unknown): GenesisFile {
    const g = payload as GenesisFile;
    if (!g || !Array.isArray(g.founding_board) || g.founding_board.length === 0) {
      throw new BadRequestException('genesis.json must contain a non-empty founding_board[]');
    }
    if (g.founding_board.length > 9) {
      throw new BadRequestException('founding_board too large');
    }
    for (const m of g.founding_board) {
      if (!m.stake_address || !isStakeAddress(m.stake_address)) {
        throw new BadRequestException(`invalid stake_address: ${m.stake_address}`);
      }
      if (!m.drep_id || typeof m.drep_id !== 'string') {
        throw new BadRequestException(`missing drep_id for ${m.stake_address}`);
      }
    }
    return g;
  }

  /** Current genesis/platform state + any proposed (uploaded, not approved) file. */
  async getState() {
    const state = await this.ensureState();
    const proposedRaw = await this.redis.client.get(PROPOSED_KEY);
    const proposed = proposedRaw ? (JSON.parse(proposedRaw) as GenesisFile) : null;
    return {
      genesisApproved: state.genesisApprovedAt !== null,
      genesisApprovedAt: state.genesisApprovedAt,
      genesisAvailable: state.genesisApprovedAt === null,
      maintenanceMode: state.maintenanceMode,
      paused: state.paused,
      proposedBoard: proposed?.founding_board ?? null,
    };
  }

  /** Upload a genesis.json for review (stored until approve/reject). */
  async upload(adminId: string, payload: unknown) {
    const state = await this.ensureState();
    if (state.genesisApprovedAt) throw new ConflictException('genesis already approved for this deployment');
    const g = this.validate(payload);
    await this.redis.client.set(PROPOSED_KEY, JSON.stringify(g), 'EX', 86400);
    await this.audit.log({ adminId, action: 'GENESIS_UPLOADED', target: `${g.founding_board.length} members` });
    return { proposedBoard: g.founding_board };
  }

  /** Approve and install the founding board (one-time, irreversible). Idempotent on members. */
  async approve(adminId: string, ip?: string, userAgent?: string) {
    const state = await this.ensureState();
    if (state.genesisApprovedAt) throw new ConflictException('genesis already approved for this deployment');

    const raw = await this.redis.client.get(PROPOSED_KEY);
    if (!raw) throw new BadRequestException('no genesis.json uploaded — upload it first');
    const g = this.validate(JSON.parse(raw));

    let seated = 0;
    for (const m of g.founding_board) {
      const stakeKeyHash = stakeKeyHashFromBech32(m.stake_address);
      const user = await this.prisma.appUser.upsert({
        where: { stakeKeyHash },
        update: { stakeAddress: m.stake_address, displayName: m.display_name },
        create: { stakeKeyHash, stakeAddress: m.stake_address, displayName: m.display_name },
      });
      const drep = await this.prisma.drep.upsert({
        where: { userId: user.id },
        update: { status: DRepStatus.ADMITTED, drepIdOnchain: m.drep_id, admittedAt: new Date() },
        create: {
          userId: user.id,
          drepIdOnchain: m.drep_id,
          status: DRepStatus.ADMITTED,
          admittedAt: new Date(),
        },
      });
      const active = await this.prisma.boardMembership.findFirst({
        where: { drepId: drep.id, endedAt: null },
      });
      if (!active) {
        await this.prisma.boardMembership.create({ data: { drepId: drep.id, startedAt: new Date() } });
        seated++;
      }
    }

    await this.prisma.platformState.update({
      where: { id: 1 },
      data: {
        genesisApprovedAt: new Date(),
        genesisApprovedBy: adminId,
        genesisPayload: g as unknown as Prisma.InputJsonValue,
      },
    });
    await this.redis.client.del(PROPOSED_KEY);
    await this.audit.log({
      adminId,
      action: 'GENESIS_APPROVED',
      target: `${g.founding_board.length} members`,
      payload: { founding_board: g.founding_board } as unknown as Prisma.InputJsonValue,
      ip,
      userAgent,
    });

    const boardCount = await this.prisma.boardMembership.count({ where: { endedAt: null } });
    return { installed: g.founding_board.length, newlySeated: seated, boardCount };
  }

  async reject(adminId: string) {
    await this.redis.client.del(PROPOSED_KEY);
    await this.audit.log({ adminId, action: 'GENESIS_REJECTED' });
    return { ok: true };
  }
}
