import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { drepKeyHashFromId, isDRepId } from '@drep-dao/cardano';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AdminAuditService } from './admin-audit.service';

const PROPOSED_KEY = 'admin:genesis:proposed';
const MAX_BOARD = 5;

interface FoundingMember {
  name: string;
  drep_id: string;
}
export interface GenesisFile {
  founding_board: FoundingMember[];
}

@Injectable()
export class GenesisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cardano: CardanoQueryService,
    private readonly audit: AdminAuditService,
  ) {}

  private async ensureState() {
    return this.prisma.platformState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }

  /** Accept `[{name,drep_id}]` or `{founding_board:[{name,drep_id}]}`. Only name + drep_id. */
  private parse(payload: unknown): FoundingMember[] {
    const arr = Array.isArray(payload)
      ? payload
      : (payload as GenesisFile)?.founding_board;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new BadRequestException('file must contain founding_board entries ({ name, drep_id })');
    }
    return arr.map((m) => {
      const name = (m as FoundingMember)?.name;
      const drepId = (m as FoundingMember)?.drep_id;
      if (!name || typeof name !== 'string') throw new BadRequestException('each member needs a name');
      if (!drepId || !isDRepId(drepId)) {
        throw new BadRequestException(`invalid drep_id: ${drepId ?? '(missing)'} — must be drep1...`);
      }
      return { name, drep_id: drepId };
    });
  }

  /** Verify on-chain registration; throws if any drep_id is not a registered DRep. */
  private async verifyOrThrow(members: FoundingMember[]) {
    const statuses = await this.cardano.verifyDReps(members.map((m) => m.drep_id));
    const invalid = members.filter((m) => !statuses.get(m.drep_id)?.registered);
    if (invalid.length > 0) {
      throw new BadRequestException(
        `file invalid — not registered DReps on-chain: ${invalid.map((m) => m.drep_id).join(', ')}`,
      );
    }
    return statuses;
  }

  async getState() {
    const state = await this.ensureState();
    const seats = await this.prisma.boardSeat.findMany({ orderBy: { addedAt: 'asc' } });
    const proposedRaw = await this.redis.client.get(PROPOSED_KEY);
    const proposed = proposedRaw ? (JSON.parse(proposedRaw) as FoundingMember[]) : null;
    return {
      boardCount: seats.length,
      maxBoard: MAX_BOARD,
      canAddMore: seats.length < MAX_BOARD,
      board: seats.map((s) => ({ displayName: s.displayName, drepId: s.drepId })),
      genesisApprovedAt: state.genesisApprovedAt,
      maintenanceMode: state.maintenanceMode,
      paused: state.paused,
      proposedBoard: proposed,
    };
  }

  /** Validate + verify on-chain + stash for review. Surfaces invalid files to the admin. */
  async upload(adminId: string, payload: unknown) {
    const members = this.parse(payload);
    await this.verifyOrThrow(members); // throws BadRequest if any not registered
    await this.redis.client.set(PROPOSED_KEY, JSON.stringify(members), 'EX', 86400);
    await this.audit.log({ adminId, action: 'GENESIS_UPLOADED', target: `${members.length} members` });
    return { proposedBoard: members, verified: true };
  }

  /** Seat the proposed members as board (keyed by on-chain DRep key hash). Incremental, cap 5. */
  async approve(adminId: string, ip?: string, userAgent?: string) {
    await this.ensureState();
    const raw = await this.redis.client.get(PROPOSED_KEY);
    if (!raw) throw new BadRequestException('no genesis file uploaded — upload it first');
    const members = this.parse(JSON.parse(raw));
    const statuses = await this.verifyOrThrow(members);

    const current = await this.prisma.boardSeat.count();
    let seated = 0;
    for (const m of members) {
      const keyHash = statuses.get(m.drep_id)?.keyHashHex ?? drepKeyHashFromId(m.drep_id);
      const exists = await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: keyHash } });
      if (exists) continue; // incremental: skip already-seated
      if (current + seated >= MAX_BOARD) {
        throw new ConflictException(`board is capped at ${MAX_BOARD} members`);
      }
      await this.prisma.boardSeat.create({
        data: { drepKeyHash: keyHash, drepId: m.drep_id, displayName: m.name },
      });
      seated++;
    }

    await this.prisma.platformState.update({
      where: { id: 1 },
      data: {
        genesisApprovedAt: new Date(),
        genesisApprovedBy: adminId,
        genesisPayload: { founding_board: members } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.redis.client.del(PROPOSED_KEY);
    await this.audit.log({
      adminId,
      action: 'GENESIS_APPROVED',
      target: `+${seated} board (now ${current + seated})`,
      payload: { founding_board: members } as unknown as Prisma.InputJsonValue,
      ip,
      userAgent,
    });
    return { seated, boardCount: current + seated, maxBoard: MAX_BOARD };
  }

  async reject(adminId: string) {
    await this.redis.client.del(PROPOSED_KEY);
    await this.audit.log({ adminId, action: 'GENESIS_REJECTED' });
    return { ok: true };
  }
}
