import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SubmitterApplicationDto } from './dto';

const MIN_DESCRIPTION_WORDS = 100;

/**
 * §2.1 — submitter role. A user applies with a profile form; a board member approves or rejects
 * (with a reason). Only an APPROVED submitter may create/submit proposals. Any account type
 * (viewer, DAO member, board) needs it.
 */
@Injectable()
export class SubmitterService {
  constructor(private readonly prisma: PrismaService) {}

  private wordCount(s: string): number {
    return s.trim().split(/\s+/).filter(Boolean).length;
  }

  async apply(userId: string, dto: SubmitterApplicationDto) {
    const displayName = (dto.displayName ?? '').trim();
    const description = (dto.description ?? '').trim();
    const country = (dto.country ?? '').trim();
    if (!displayName) throw new BadRequestException('display name is required');
    if (!country) throw new BadRequestException('country is required');
    if (this.wordCount(description) < MIN_DESCRIPTION_WORDS) {
      throw new BadRequestException(`description must be at least ${MIN_DESCRIPTION_WORDS} words`);
    }
    const socialLinks = (dto.socialLinks ?? []).map((s) => s.trim()).filter(Boolean);
    const existing = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { status: true } });
    // Approved members can edit their profile without losing the role; everyone else (new or
    // previously rejected) goes back to PENDING for board review.
    const status = existing?.status === 'APPROVED' ? 'APPROVED' : 'PENDING';
    const data = {
      status,
      displayName,
      description,
      githubUrl: dto.githubUrl?.trim() || null,
      socialLinks,
      logoDataUrl: dto.logoDataUrl?.trim() || null,
      country,
      rejectionReason: null,
    };
    await this.prisma.submitterApplication.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    return this.mine(userId);
  }

  async mine(userId: string) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId } });
    if (!a) return null;
    return {
      id: a.id,
      status: a.status as 'PENDING' | 'APPROVED' | 'REJECTED',
      displayName: a.displayName,
      description: a.description,
      githubUrl: a.githubUrl,
      socialLinks: a.socialLinks,
      logoDataUrl: a.logoDataUrl,
      country: a.country,
      rejectionReason: a.rejectionReason,
    };
  }

  async isApproved(userId: string): Promise<boolean> {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { status: true } });
    return a?.status === 'APPROVED';
  }

  /** Board to-do: applications awaiting review (or all, with history). */
  async listApplications(history = false) {
    const rows = await this.prisma.submitterApplication.findMany({
      where: history ? {} : { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { stakeAddress: true, displayName: true } } },
    });
    return rows.map((a) => ({
      id: a.id,
      status: a.status as 'PENDING' | 'APPROVED' | 'REJECTED',
      displayName: a.displayName,
      description: a.description,
      githubUrl: a.githubUrl,
      socialLinks: a.socialLinks,
      logoDataUrl: a.logoDataUrl,
      country: a.country,
      rejectionReason: a.rejectionReason,
      stakeAddress: a.user.stakeAddress,
    }));
  }

  async approve(id: string) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { id }, include: { user: { select: { id: true, displayName: true } } } });
    if (!a) throw new NotFoundException('application not found');
    await this.prisma.submitterApplication.update({ where: { id }, data: { status: 'APPROVED', rejectionReason: null, reviewedAt: new Date() } });
    // Give the user a display name from the application if they don't have one yet — so their
    // proposals show a name instead of a stake id.
    if (!a.user.displayName) {
      await this.prisma.appUser.update({ where: { id: a.user.id }, data: { displayName: a.displayName } });
    }
    return { ok: true };
  }

  async reject(id: string, reason: string) {
    const r = (reason ?? '').trim();
    if (!r) throw new BadRequestException('a reason is required to reject — the applicant will see it');
    const a = await this.prisma.submitterApplication.findUnique({ where: { id }, select: { id: true } });
    if (!a) throw new NotFoundException('application not found');
    await this.prisma.submitterApplication.update({ where: { id }, data: { status: 'REJECTED', rejectionReason: r, reviewedAt: new Date() } });
    return { ok: true };
  }

  /** Guard helper for proposal create/submit. */
  async assertApproved(userId: string) {
    if (!(await this.isApproved(userId))) {
      throw new ForbiddenException('you must be an approved submitter to submit proposals — apply for the submitter role first');
    }
  }
}
