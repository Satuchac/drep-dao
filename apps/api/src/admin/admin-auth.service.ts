import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import { AdminStatus } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  generateRecoveryCodes,
  hashSecret,
  newTotpSecret,
  verifySecret,
  verifyTotp,
} from './admin-crypto';

export const ADMIN_SESSION_COOKIE = 'admin_session';
export const ADMIN_SESSION_TTL_HOURS = 4;
export const MAX_ADMINS = 3;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

export interface AdminIdentity {
  adminId: string;
  username: string;
  email: string;
}

export type LoginResult =
  | { kind: 'session'; sessionToken: string; admin: AdminIdentity }
  | { kind: '2fa_required'; pendingToken: string };

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Create an admin (CLI bootstrap or, later, invite-accept). Enrolls 2FA + recovery codes. */
  async createAdmin(params: {
    username: string;
    email: string;
    password: string;
    createdById?: string | null;
  }): Promise<{ adminId: string; totpUri: string; totpBase32: string; recoveryCodes: string[] }> {
    const activeCount = await this.prisma.adminUser.count({ where: { status: AdminStatus.ACTIVE } });
    const isFirst = activeCount === 0;
    if (!isFirst && activeCount >= MAX_ADMINS) {
      throw new ConflictException(`admin cap reached (${MAX_ADMINS}); remove one first`);
    }

    const passwordHash = await hashSecret(params.password);
    const required2fa = this.requires2fa();
    const totp = newTotpSecret(params.username);
    const recoveryCodes = generateRecoveryCodes();
    const recoveryHashes = await Promise.all(recoveryCodes.map((c) => hashSecret(c)));

    const admin = await this.prisma.adminUser.create({
      data: {
        username: params.username,
        email: params.email,
        passwordHash,
        status: AdminStatus.ACTIVE,
        createdById: params.createdById ?? null,
        twoFa: { create: { totpSecret: totp.base32, enrolledAt: new Date(), required: required2fa } },
        recoveryCodes: { create: recoveryHashes.map((codeHash) => ({ codeHash })) },
      },
    }).catch((e: unknown) => {
      // unique username
      throw new ConflictException(`could not create admin: ${(e as Error).message}`);
    });

    return { adminId: admin.id, totpUri: totp.uri, totpBase32: totp.base32, recoveryCodes };
  }

  /** §18.5 — invite a new admin. Returns a one-time token (24h). */
  async createInvitation(createdById: string, username: string, email: string) {
    const active = await this.prisma.adminUser.count({ where: { status: AdminStatus.ACTIVE } });
    if (active >= MAX_ADMINS) {
      throw new ConflictException(`admin cap reached (${MAX_ADMINS}); remove one first`);
    }
    const existing = await this.prisma.adminUser.findUnique({ where: { username } });
    if (existing && existing.status !== AdminStatus.REMOVED) {
      throw new ConflictException('username already in use');
    }
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    await this.prisma.adminInvitation.create({
      data: { username, email, tokenHash: this.sha256(token), createdById, expiresAt },
    });
    return { token, expiresAt };
  }

  /** §18.5 — consume an invitation: set password, enroll 2FA. No auth (invitee). */
  async acceptInvitation(token: string, password: string) {
    const invite = await this.prisma.adminInvitation.findFirst({
      where: { tokenHash: this.sha256(token), consumedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!invite) throw new UnauthorizedException('invalid or expired invitation');

    const created = await this.createAdmin({
      username: invite.username,
      email: invite.email,
      password,
      createdById: invite.createdById,
    });
    await this.prisma.adminInvitation.update({
      where: { id: invite.id },
      data: { consumedAt: new Date() },
    });
    const totpQrDataUrl = await QRCode.toDataURL(created.totpUri);
    return { ...created, totpQrDataUrl };
  }

  /** §18.5 — remove an admin (status REMOVED, sessions revoked). Refuses to leave 0 active. */
  async removeAdmin(targetId: string): Promise<void> {
    const target = await this.prisma.adminUser.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('admin not found');
    if (target.status === AdminStatus.ACTIVE) {
      const active = await this.prisma.adminUser.count({ where: { status: AdminStatus.ACTIVE } });
      if (active <= 1) throw new BadRequestException('cannot remove the last active admin');
    }
    await this.prisma.adminUser.update({
      where: { id: targetId },
      data: { status: AdminStatus.REMOVED, removedAt: new Date() },
    });
    await this.revokeAllSessions(targetId);
  }

  async disableAdmin(targetId: string): Promise<void> {
    const target = await this.prisma.adminUser.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('admin not found');
    if (target.status === AdminStatus.ACTIVE) {
      const active = await this.prisma.adminUser.count({ where: { status: AdminStatus.ACTIVE } });
      if (active <= 1) throw new BadRequestException('cannot disable the last active admin');
    }
    await this.prisma.adminUser.update({ where: { id: targetId }, data: { status: AdminStatus.DISABLED } });
    await this.revokeAllSessions(targetId);
  }

  private async revokeAllSessions(adminId: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private sha256(s: string): string {
    return createHash('sha256').update(s).digest('hex');
  }

  /** Step 1: username + password. Returns a session, or a 2FA challenge. */
  async login(username: string, password: string, ip?: string): Promise<LoginResult> {
    await this.assertNotLockedOut(username, ip);

    const admin = await this.prisma.adminUser.findUnique({
      where: { username },
      include: { twoFa: true },
    });
    const ok = admin?.status === AdminStatus.ACTIVE && (await verifySecret(admin.passwordHash, password));
    await this.prisma.adminLoginAttempt.create({
      data: { username, ip: ip ?? '0.0.0.0', success: !!ok },
    });
    if (!ok || !admin) throw new UnauthorizedException('invalid credentials');

    if (admin.twoFa?.required) {
      const pendingToken = randomBytes(24).toString('hex');
      await this.redis.client.set(`admin:pending2fa:${pendingToken}`, admin.id, 'EX', 300);
      return { kind: '2fa_required', pendingToken };
    }
    return { kind: 'session', ...(await this.issueSession(admin.id)) };
  }

  /** Step 2: complete a 2FA challenge with a TOTP code. */
  async complete2fa(pendingToken: string, code: string): Promise<{ sessionToken: string; admin: AdminIdentity }> {
    const adminId = await this.redis.client.getdel(`admin:pending2fa:${pendingToken}`);
    if (!adminId) throw new UnauthorizedException('2FA challenge expired — log in again');
    const twoFa = await this.prisma.admin2fa.findUnique({ where: { adminId } });
    if (!twoFa || !verifyTotp(twoFa.totpSecret, code)) {
      throw new UnauthorizedException('invalid 2FA code');
    }
    return this.issueSession(adminId);
  }

  /** Alternative step 2: a one-time recovery code. */
  async loginRecovery(pendingToken: string, code: string): Promise<{ sessionToken: string; admin: AdminIdentity }> {
    const adminId = await this.redis.client.getdel(`admin:pending2fa:${pendingToken}`);
    if (!adminId) throw new UnauthorizedException('challenge expired — log in again');
    const candidates = await this.prisma.adminRecoveryCode.findMany({
      where: { adminId, usedAt: null },
    });
    for (const rc of candidates) {
      if (await verifySecret(rc.codeHash, code.trim())) {
        await this.prisma.adminRecoveryCode.update({ where: { id: rc.id }, data: { usedAt: new Date() } });
        return this.issueSession(adminId);
      }
    }
    throw new UnauthorizedException('invalid recovery code');
  }

  /** Validate an admin_session cookie. Returns identity or null. */
  async verifySession(sessionToken: string): Promise<AdminIdentity | null> {
    const session = await this.prisma.adminSession.findUnique({
      where: { id: sessionToken },
      include: { admin: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    if (session.admin.status !== AdminStatus.ACTIVE) return null;
    return { adminId: session.admin.id, username: session.admin.username, email: session.admin.email };
  }

  async revokeSession(sessionToken: string): Promise<void> {
    await this.prisma.adminSession
      .update({ where: { id: sessionToken }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  private async issueSession(adminId: string): Promise<{ sessionToken: string; admin: AdminIdentity }> {
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_HOURS * 3600 * 1000);
    const session = await this.prisma.adminSession.create({ data: { adminId, expiresAt } });
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { lastLoginAt: new Date() } });
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    return {
      sessionToken: session.id,
      admin: { adminId: admin.id, username: admin.username, email: admin.email },
    };
  }

  private async assertNotLockedOut(username: string, ip?: string): Promise<void> {
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000);
    const fails = await this.prisma.adminLoginAttempt.count({
      where: {
        success: false,
        attemptedAt: { gte: since },
        OR: [{ username }, ...(ip ? [{ ip }] : [])],
      },
    });
    if (fails >= LOCKOUT_THRESHOLD) {
      throw new UnauthorizedException(`too many attempts — locked out for ${LOCKOUT_WINDOW_MINUTES} minutes`);
    }
  }

  /** Whether 2FA is mandatory: always on mainnet, else env ADMIN_REQUIRE_2FA. */
  private requires2fa(): boolean {
    if (this.config.get('CARDANO_NETWORK') === 'Mainnet') return true;
    return this.config.get('ADMIN_REQUIRE_2FA') === 'true';
  }
}
