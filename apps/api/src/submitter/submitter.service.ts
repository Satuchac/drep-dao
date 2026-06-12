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
    // §2.1 — never ask for a name the platform already knows: members (board / DAO / DRep)
    // use their profile display name; a member WITHOUT one must set it in the profile first.
    // Only viewers (no profile) provide a name here.
    const me = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { displayName: true, drepKeyHash: true, drep: { select: { id: true } } },
    });
    const isMember = !!me?.drep || (!!me?.drepKeyHash && !!(await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: me.drepKeyHash } })));
    let displayName = (me?.displayName ?? '').trim() || (dto.displayName ?? '').trim();
    if (me?.displayName?.trim()) displayName = me.displayName.trim(); // profile name always wins
    else if (isMember) {
      throw new BadRequestException('set your display name in your profile first — the submitter role reuses it');
    }
    const description = (dto.description ?? '').trim();
    const country = (dto.country ?? '').trim();
    if (!displayName) throw new BadRequestException('display name is required');
    if (!country) throw new BadRequestException('country is required');
    if (!description) throw new BadRequestException('description is required');
    // §2.1 — disclosure + contact (the board must be able to reach the team).
    const conflictOfInterest = (dto.conflictOfInterest ?? '').trim();
    if (!conflictOfInterest) throw new BadRequestException('the conflict-of-interest disclosure is required (write "none" if you have none)');
    const telegram = (dto.telegram ?? '').trim();
    if (!telegram) throw new BadRequestException('a Telegram handle is required');
    const email = (dto.email ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('a valid email is required');
    const socialLinks = (dto.socialLinks ?? []).map((s) => s.trim()).filter(Boolean);
    const githubUrls = (dto.githubUrls ?? []).map((s) => s.trim()).filter(Boolean);
    const logoDataUrl = dto.logoDataUrl?.trim() || null;
    const existing = await this.prisma.submitterApplication.findUnique({ where: { userId } });
    // The 100-word minimum is for applications the board still has to review. An already-approved
    // member can refine their profile without re-meeting it (e.g. grandfathered placeholder text).
    if (existing?.status !== 'APPROVED' && this.wordCount(description) < MIN_DESCRIPTION_WORDS) {
      throw new BadRequestException(`description must be at least ${MIN_DESCRIPTION_WORDS} words`);
    }
    // Approved members can edit their profile without losing the role; everyone else (new or
    // previously rejected) goes back to PENDING for board review.
    const status = existing?.status === 'APPROVED' ? 'APPROVED' : 'PENDING';
    // Preserve the change history: snapshot the previous APPROVED profile before overwriting it.
    const changed = !!existing && (
      existing.displayName !== displayName ||
      existing.description !== description ||
      JSON.stringify(existing.githubUrls) !== JSON.stringify(githubUrls) ||
      JSON.stringify(existing.socialLinks) !== JSON.stringify(socialLinks) ||
      (existing.logoDataUrl ?? null) !== logoDataUrl ||
      existing.country !== country ||
      existing.conflictOfInterest !== conflictOfInterest ||
      existing.noSelfVotePledge !== !!dto.noSelfVotePledge ||
      existing.telegram !== telegram ||
      existing.email !== email
    );
    if (existing && existing.status === 'APPROVED' && changed) {
      await this.prisma.submitterApplicationHistory.create({
        data: {
          userId,
          displayName: existing.displayName,
          description: existing.description,
          githubUrls: existing.githubUrls,
          socialLinks: existing.socialLinks,
          logoDataUrl: existing.logoDataUrl,
          country: existing.country,
          conflictOfInterest: existing.conflictOfInterest,
          noSelfVotePledge: existing.noSelfVotePledge,
          telegram: existing.telegram,
          email: existing.email,
        },
      });
    }
    const data = { status, displayName, description, githubUrls, socialLinks, logoDataUrl, country, conflictOfInterest, noSelfVotePledge: !!dto.noSelfVotePledge, telegram, email, rejectionReason: null };
    await this.prisma.submitterApplication.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    // Viewers: sync the name to the account so it shows in the login section + on proposals.
    // (Members already had it — never overwrite the profile from here.)
    if (!me?.displayName?.trim()) {
      await this.prisma.appUser.update({ where: { id: userId }, data: { displayName } });
    }
    return this.mine(userId);
  }

  private async historyFor(userId: string) {
    const rows = await this.prisma.submitterApplicationHistory.findMany({ where: { userId }, orderBy: { snapshotAt: 'desc' } });
    return rows.map((h) => ({
      displayName: h.displayName,
      description: h.description,
      githubUrls: h.githubUrls,
      socialLinks: h.socialLinks,
      logoDataUrl: h.logoDataUrl,
      country: h.country,
      conflictOfInterest: h.conflictOfInterest,
      noSelfVotePledge: h.noSelfVotePledge,
      telegram: h.telegram,
      email: h.email,
      snapshotAt: h.snapshotAt,
    }));
  }

  async mine(userId: string) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId } });
    if (!a) return null;
    return {
      id: a.id,
      status: a.status as 'PENDING' | 'APPROVED' | 'REJECTED',
      displayName: a.displayName,
      description: a.description,
      githubUrls: a.githubUrls,
      socialLinks: a.socialLinks,
      logoDataUrl: a.logoDataUrl,
      country: a.country,
      conflictOfInterest: a.conflictOfInterest,
      noSelfVotePledge: a.noSelfVotePledge,
      telegram: a.telegram,
      email: a.email,
      rejectionReason: a.rejectionReason,
      history: await this.historyFor(userId),
    };
  }

  async isApproved(userId: string): Promise<boolean> {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { status: true } });
    return a?.status === 'APPROVED';
  }

  /** §2.1 — public directory of APPROVED submitters; flags those who are also DAO members. */
  async listApproved() {
    const rows = await this.prisma.submitterApplication.findMany({
      where: { status: 'APPROVED' },
      orderBy: { displayName: 'asc' },
      include: { user: { select: { id: true, displayName: true, drepKeyHash: true, drep: { select: { status: true } } } } },
    });
    const boardKeys = new Set(
      (await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    return rows.map((a) => ({
      id: a.id,
      displayName: a.user.displayName ?? a.displayName,
      description: a.description,
      country: a.country,
      githubUrls: a.githubUrls,
      socialLinks: a.socialLinks,
      logoDataUrl: a.logoDataUrl,
      noSelfVotePledge: a.noSelfVotePledge,
      conflictOfInterest: a.conflictOfInterest,
      // §2.1 — important context: this submitter also votes (DAO member / board).
      isDaoMember: a.user.drep?.status === 'ADMITTED' || (!!a.user.drepKeyHash && boardKeys.has(a.user.drepKeyHash)),
      since: a.reviewedAt,
    }));
  }

  /** Board to-do: applications awaiting review (or all, with showAll). Each carries its change history. */
  async listApplications(showAll = false) {
    const rows = await this.prisma.submitterApplication.findMany({
      where: showAll ? {} : { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { stakeAddress: true } } },
    });
    const hist = await this.prisma.submitterApplicationHistory.findMany({
      where: { userId: { in: rows.map((r) => r.userId) } },
      orderBy: { snapshotAt: 'desc' },
    });
    const histByUser = new Map<string, ReturnType<typeof mapHist>[]>();
    function mapHist(h: (typeof hist)[number]) {
      return { displayName: h.displayName, description: h.description, githubUrls: h.githubUrls, socialLinks: h.socialLinks, logoDataUrl: h.logoDataUrl, country: h.country, conflictOfInterest: h.conflictOfInterest, noSelfVotePledge: h.noSelfVotePledge, telegram: h.telegram, email: h.email, snapshotAt: h.snapshotAt };
    }
    for (const h of hist) {
      if (!histByUser.has(h.userId)) histByUser.set(h.userId, []);
      histByUser.get(h.userId)!.push(mapHist(h));
    }
    return rows.map((a) => ({
      id: a.id,
      status: a.status as 'PENDING' | 'APPROVED' | 'REJECTED',
      displayName: a.displayName,
      description: a.description,
      githubUrls: a.githubUrls,
      socialLinks: a.socialLinks,
      logoDataUrl: a.logoDataUrl,
      country: a.country,
      conflictOfInterest: a.conflictOfInterest,
      noSelfVotePledge: a.noSelfVotePledge,
      telegram: a.telegram,
      email: a.email,
      rejectionReason: a.rejectionReason,
      stakeAddress: a.user.stakeAddress,
      history: histByUser.get(a.userId) ?? [],
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
