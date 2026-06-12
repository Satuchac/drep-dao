import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { MeritService } from '../merit/merit.service';
import { AnchorService } from '../cardano/anchor.service';
import { GovSubject } from '@drep-dao/cardano';
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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly merit?: MeritService,
    @Optional() private readonly anchor?: AnchorService,
  ) {}

  /** §13.2 — reviewing a submitter application is board work: +1 merit, once per application. */
  private async awardReviewMerit(reviewerUserId: string | undefined, applicationId: string) {
    if (!reviewerUserId) return;
    const drep = await this.prisma.drep.findUnique({ where: { userId: reviewerUserId }, select: { id: true } });
    if (drep) await this.merit?.tryAward(drep.id, 'APPLICATION_REVIEW', applicationId);
  }

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
    // §2.1 — applying means consenting to profile persistence (it stays even after leaving).
    const prior = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { status: true } });
    if (prior?.status !== 'APPROVED' && !dto.agreePersist) {
      throw new BadRequestException('you must agree that the profile will be persisted by the platform');
    }
    if (!country) throw new BadRequestException('country is required');
    if (!description) throw new BadRequestException('description is required');
    // §2.1 — disclosure + contact (the board must be able to reach the team).
    const conflictOfInterest = (dto.conflictOfInterest ?? '').trim();
    if (!conflictOfInterest) throw new BadRequestException('the conflict-of-interest disclosure is required (write "none" if you have none)');
    const telegram = (dto.telegram ?? '').trim();
    if (!telegram) throw new BadRequestException('a Telegram handle is required');
    const email = (dto.email ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('a valid email is required');
    const previousFunding = (dto.previousFunding ?? '').trim();
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
      existing.email !== email ||
      existing.previousFunding !== previousFunding
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
          previousFunding: existing.previousFunding,
        },
      });
    }
    const data = { status, displayName, description, githubUrls, socialLinks, logoDataUrl, country, conflictOfInterest, noSelfVotePledge: !!dto.noSelfVotePledge, telegram, email, previousFunding, rejectionReason: null };
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
      previousFunding: h.previousFunding,
      snapshotAt: h.snapshotAt,
    }));
  }

  async mine(userId: string) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId } });
    if (!a) return null;
    return {
      id: a.id,
      status: a.status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'LEFT',
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
      previousFunding: a.previousFunding,
      rejectionReason: a.rejectionReason,
      leftAt: a.leftAt,
      history: await this.historyFor(userId),
    };
  }

  /**
   * §2.1 — an approved submitter deregisters. Blocked while any of their proposals is still
   * in flight (PENDING / ACTIVE / APPROVED): finish it, or the board cancels it. The profile
   * row is KEPT (status LEFT + leftAt) — it stays visible in the directory's history view.
   */
  async leave(userId: string) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { id: true, status: true } });
    if (!a || a.status !== 'APPROVED') throw new ConflictException('only an approved submitter can leave');
    const active = await this.prisma.proposal.count({
      where: { submitterUserId: userId, status: { in: ['PENDING', 'ACTIVE', 'APPROVED'] } },
    });
    if (active > 0) {
      throw new ConflictException(
        `you cannot leave while you have ${active} active proposal${active === 1 ? '' : 's'} — finish ${active === 1 ? 'it' : 'them'} first, or ask the board to cancel ${active === 1 ? 'it' : 'them'}`,
      );
    }
    await this.prisma.submitterApplication.update({ where: { id: a.id }, data: { status: 'LEFT', leftAt: new Date() } });
    return { ok: true };
  }

  async isApproved(userId: string): Promise<boolean> {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { status: true } });
    return a?.status === 'APPROVED';
  }

  /** §2.1 — public directory of APPROVED submitters; flags those who are also DAO members. */
  async listApproved(includeLeft = false) {
    const rows = await this.prisma.submitterApplication.findMany({
      where: { status: includeLeft ? { in: ['APPROVED', 'LEFT'] } : 'APPROVED' },
      orderBy: { displayName: 'asc' },
      include: { user: { select: { id: true, displayName: true, stakeAddress: true, drepKeyHash: true, drep: { select: { status: true, drepIdOnchain: true } } } } },
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
      telegram: a.telegram,
      email: a.email,
      previousFunding: a.previousFunding,
      // The platform knows the wallet — expose it (and the DRep identity when they have one).
      stakeAddress: a.user.stakeAddress,
      drepIdOnchain: a.user.drep?.drepIdOnchain ?? null,
      // §2.1 — important context: this submitter also votes (DAO member / board).
      isDaoMember: a.user.drep?.status === 'ADMITTED' || (!!a.user.drepKeyHash && boardKeys.has(a.user.drepKeyHash)),
      status: a.status as 'APPROVED' | 'LEFT',
      leftAt: a.leftAt,
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
      return { displayName: h.displayName, description: h.description, githubUrls: h.githubUrls, socialLinks: h.socialLinks, logoDataUrl: h.logoDataUrl, country: h.country, conflictOfInterest: h.conflictOfInterest, noSelfVotePledge: h.noSelfVotePledge, telegram: h.telegram, email: h.email, previousFunding: h.previousFunding, snapshotAt: h.snapshotAt };
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
      previousFunding: a.previousFunding,
      rejectionReason: a.rejectionReason,
      stakeAddress: a.user.stakeAddress,
      history: histByUser.get(a.userId) ?? [],
    }));
  }

  async approve(id: string, reviewerUserId?: string) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { id }, include: { user: { select: { id: true, displayName: true } } } });
    if (!a) throw new NotFoundException('application not found');
    // §2.1 — nobody reviews their own application (self-approval + merit farming).
    if (reviewerUserId && a.userId === reviewerUserId) {
      throw new ForbiddenException('you cannot review your own application — another board member must decide it');
    }
    await this.prisma.submitterApplication.update({ where: { id }, data: { status: 'APPROVED', rejectionReason: null, reviewedAt: new Date() } });
    await this.awardReviewMerit(reviewerUserId, id);
    // §24.1 — anchor the admission on-chain: short proof with name + wallet identity
    // (DRep ID when they have one, else the stake address). Best-effort.
    try {
      const who = await this.prisma.appUser.findUnique({
        where: { id: a.user.id },
        select: { stakeAddress: true, displayName: true, drep: { select: { drepIdOnchain: true } } },
      });
      await this.anchor?.anchorMembership({
        kind: GovSubject.SUBMITTER_ADMISSION,
        event: 'new submitter admitted',
        name: who?.displayName ?? a.displayName,
        walletKind: who?.drep ? 'drep_id' : 'stake_address',
        walletId: who?.drep?.drepIdOnchain ?? who?.stakeAddress ?? '',
      });
    } catch { /* anchoring never blocks the approval */ }
    // Give the user a display name from the application if they don't have one yet — so their
    // proposals show a name instead of a stake id.
    if (!a.user.displayName) {
      await this.prisma.appUser.update({ where: { id: a.user.id }, data: { displayName: a.displayName } });
    }
    return { ok: true };
  }

  async reject(id: string, reason: string, reviewerUserId?: string) {
    const r = (reason ?? '').trim();
    if (!r) throw new BadRequestException('a reason is required to reject — the applicant will see it');
    const a = await this.prisma.submitterApplication.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!a) throw new NotFoundException('application not found');
    if (reviewerUserId && a.userId === reviewerUserId) {
      throw new ForbiddenException('you cannot review your own application — another board member must decide it');
    }
    await this.prisma.submitterApplication.update({ where: { id }, data: { status: 'REJECTED', rejectionReason: r, reviewedAt: new Date() } });
    await this.awardReviewMerit(reviewerUserId, id);
    return { ok: true };
  }

  /** Guard helper for proposal create/submit. */
  async assertApproved(userId: string) {
    if (!(await this.isApproved(userId))) {
      throw new ForbiddenException('you must be an approved submitter to submit proposals — apply for the submitter role first');
    }
  }
}
