import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DRepStatus,
  PLATFORM_CONFIG_DEFAULTS,
  basePower,
  clampMerit,
  meritMultiplier,
} from '@drep-dao/shared';
import { SUBJECT_TITLE } from '@drep-dao/cardano';
import { createHash } from 'node:crypto';
import { drepIdFromKeyHashHex, admissionVoteMessage, GovSubject, VotingStyle } from '@drep-dao/cardano';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AnchorService } from '../cardano/anchor.service';
import { verifyCip30Signature } from '../auth/cip30';
import { AdmissionVoteDto, DrepApplicationDto, ExpertApplicationDto, UpdateDrepDto } from './dto';

@Injectable()
export class DrepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
    private readonly anchor: AnchorService,
  ) {}

  /**
   * §2/§4 — all DAO members (board + admitted DReps) with balanced voting power.
   * VotingPower = log10(stake_ADA) × (1 + merit/200). Stake is the DRep's
   * on-chain voting power (Koios `amount`); merit is the clamped ledger sum.
   */
  async listDaoMembers() {
    const seats = await this.prisma.boardSeat.findMany({ orderBy: { addedAt: 'asc' } });
    const boardKeys = new Set(seats.map((s) => s.drepKeyHash));
    const admitted = await this.prisma.drep.findMany({
      where: { status: DRepStatus.ADMITTED },
      include: { user: { select: { displayName: true, drepKeyHash: true, drepRegistered: true, stakeAddress: true } } },
    });

    // Union: every board seat is a member (even before first login → no Drep row
    // yet), plus admitted DReps still registered on-chain. Keyed by drep id.
    // `since` = when they became a member: board install date (board_seat.addedAt)
    // for board members, board-approval date (drep.admittedAt) for admitted DReps.
    interface Row { drepId: string; displayName: string; isBoard: boolean; drepRowId?: string; stakeAddress?: string; since: Date | null; photo: string | null }
    const byId = new Map<string, Row>();
    for (const s of seats) byId.set(s.drepId, { drepId: s.drepId, displayName: s.displayName, isBoard: true, since: s.addedAt, photo: null });
    for (const d of admitted) {
      const isBoard = d.user.drepKeyHash ? boardKeys.has(d.user.drepKeyHash) : false;
      if (!isBoard && !d.user.drepRegistered) continue; // skip lapsed non-board members
      const existing = byId.get(d.drepIdOnchain);
      if (existing) {
        existing.drepRowId = d.id;
        existing.stakeAddress = d.user.stakeAddress;
        if (d.user.displayName) existing.displayName = d.user.displayName; // prefer self-set name
        existing.photo = d.photo;
        // keep the board-install date for board members
      } else {
        byId.set(d.drepIdOnchain, {
          drepId: d.drepIdOnchain,
          displayName: d.user.displayName ?? 'DRep',
          isBoard,
          drepRowId: d.id,
          stakeAddress: d.user.stakeAddress,
          since: d.admittedAt,
          photo: d.photo,
        });
      }
    }
    const rows = [...byId.values()];

    // §14.1 — the membership power minimums (read once; used for the health flag below).
    // The flag only applies when the entry power gate is ENABLED — if the switch is off,
    // the minimum isn't a requirement, so nobody is flagged.
    const cfgRows = await this.prisma.platformConfig.findMany();
    const cfg = new Map(cfgRows.map((c) => [c.key, c.value]));
    const D = PLATFORM_CONFIG_DEFAULTS as Record<string, number | string | boolean>;
    const numCfg = (k: string) => { const v = cfg.get(k); return typeof v === 'number' ? v : (D[k] as number); };
    const boolCfg = (k: string) => { const v = cfg.get(k); return typeof v === 'boolean' ? v : (D[k] as boolean); };
    const requirePower = boolCfg('ENTRY_REQUIRE_VOTING_POWER');
    const requireActivity = boolCfg('ENTRY_REQUIRE_ACTIVITY');
    const minOwn = numCfg('MIN_OWN_VOTING_POWER_ADA');
    const minDelegs = numCfg('MIN_DELEGATORS');
    const minStakeLovelace = BigInt(Math.round(numCfg('MIN_DELEGATOR_STAKE_ADA'))) * 1_000_000n;
    const meritMax = numCfg('MERIT_POINT_MAX'); // §13 merit cap (runtime-configurable)
    const activityWindow = numCfg('MINIMUM_VOTES_CASTED');
    const activityNeed = Math.ceil((activityWindow * numCfg('MINIMUM_DREP_ACTIVITY')) / 100);
    const onlyWithRationale = boolCfg('ONLY_VOTES_WITH_RATIONALE');

    // §4 — on-chain DRep VOTING power (CIP-1694 vote delegation), live: total power +
    // delegator count, plus own power + qualifying delegators for the eligibility flag.
    const vp = await this.cardano.drepEntryMetricsBatch(
      rows.map((r) => ({ drepId: r.drepId, ownStakeAddress: r.stakeAddress })),
      minStakeLovelace,
    );
    // §14.1 activity gate — only query when enabled (1 + N Koios calls); off by default.
    const activity = requireActivity
      ? await this.cardano.drepActivityMetricsBatch(rows.map((r) => r.drepId), activityWindow, onlyWithRationale)
      : null;
    // §CIP-119 — on-chain DRep name + image (else our stored name + a generic avatar).
    const meta = await this.cardano.drepMetadata(rows.map((r) => r.drepId));

    const members = await Promise.all(
      rows.map(async (r) => {
        const merit = r.drepRowId ? await this.currentMerit(r.drepRowId, meritMax) : 0;
        const power = vp.get(r.drepId) ?? { votingPowerLovelace: 0n, delegators: 0, ownVotingPowerLovelace: 0n, qualifyingDelegators: 0 };
        const m = meta.get(r.drepId);
        const base = basePower(power.votingPowerLovelace);
        const mult = meritMultiplier(merit, meritMax);
        // §14.1 — does the member still meet the ENABLED entry gates? A shortfall is shown
        // but the member remains a full voting member.
        // - Power gate: board is exempt (seated via genesis, not the delegation threshold).
        // - Activity gate: applies to EVERYONE incl. board (all DReps should stay active).
        const ownAda = Number(power.ownVotingPowerLovelace) / 1_000_000;
        const meetsPower = !requirePower || r.isBoard || ownAda >= minOwn || power.qualifyingDelegators >= minDelegs;
        const act = activity?.get(r.drepId);
        const meetsActivity = !requireActivity || (!!act?.available && act.votesInWindow >= activityNeed);
        const meetsEntryRequirements = meetsPower && meetsActivity;
        return {
          drepId: r.drepId,
          displayName: m?.name ?? r.displayName,
          // User-uploaded photo overrides the on-chain CIP-119 image when set.
          image: r.photo ?? m?.image ?? null,
          isBoard: r.isBoard,
          votingPowerAda: Math.round(Number(power.votingPowerLovelace) / 1_000_000),
          delegators: power.delegators,
          merit,
          basePower: round(base),
          meritMultiplier: round(mult),
          adjustedPower: round(base * mult),
          since: r.since ? r.since.toISOString() : null,
          meetsEntryRequirements,
        };
      }),
    );
    members.sort((a, b) => b.adjustedPower - a.adjustedPower || (b.isBoard ? 1 : 0) - (a.isBoard ? 1 : 0));
    return members;
  }

  /**
   * Per-DRep public profile for the DAO members directory: the list-row fields, plus
   * the bio / socials / contact and a count of admission votes cast (board members
   * only — non-board members never get to vote on join applications).
   */
  async getDaoMemberDetail(drepIdOnchain: string) {
    const list = await this.listDaoMembers();
    const summary = list.find((m) => m.drepId === drepIdOnchain);
    if (!summary) throw new NotFoundException('not a current DAO member');

    // Bio/socials/contact + the Drep row id (needed for the admission-vote count).
    // A board member without a Drep row (genesis-seated, never logged in) has no
    // bio and no votes to count yet.
    const drep = await this.prisma.drep.findUnique({
      where: { drepIdOnchain },
      select: { id: true, bio: true, socials: true, contact: true, subcategoryIds: true },
    });

    const admissionVotes = drep
      ? await this.prisma.admissionVote.groupBy({
          by: ['choice'],
          where: { boardDrepId: drep.id },
          _count: { _all: true },
        })
      : [];
    const yes = admissionVotes.find((g) => g.choice === 'YES')?._count._all ?? 0;
    const no = admissionVotes.find((g) => g.choice === 'NO')?._count._all ?? 0;

    return {
      ...summary,
      bio: drep?.bio ?? null,
      socials: (drep?.socials as Record<string, string> | null) ?? null,
      contact: (drep?.contact as Record<string, string> | null) ?? null,
      subcategoryIds: drep?.subcategoryIds ?? [],
      // Admission votes the member cast as a board reviewer (only board has any).
      admissionVotesCast: { yes, no, total: yes + no },
    };
  }

  /** Everything the platform has anchored on-chain, newest first, human-readable. */
  async listOnChainProofs() {
    const anchors = await this.prisma.anchor.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    return anchors.map((a) => {
      const p = (a.preimage ?? {}) as {
        subject?: string;
        ref?: string;
        applicant?: string;
        result?: { outcome?: string; yes?: number; no?: number; threshold?: number };
        // submission-anchor preimage
        proposalId?: string;
        submitter?: string;
        submitterType?: string;
        fee?: { required?: boolean; paid?: boolean; ada?: number; txHash?: string | null };
      };
      // Self-describing title/detail for every kind (admission, filtering, dv, milestone, …).
      const subject = (p.subject ?? a.kind) as keyof typeof SUBJECT_TITLE;
      const title = SUBJECT_TITLE[subject] ?? 'On-chain record';
      const ref = p.ref ?? p.applicant;
      // A submission anchor records acceptance facts, not a vote tally.
      if (subject === 'submission') {
        const feeStr = p.fee?.required ? (p.fee.paid ? `fee ${p.fee.ada ?? 0} ₳ paid` : 'fee unpaid') : 'no fee required';
        const detail = `${p.proposalId ?? ''} · by ${(p.submitter ?? '').slice(0, 24)}${(p.submitter ?? '').length > 24 ? '…' : ''} (${p.submitterType ?? 'Wallet'}) · ${feeStr}`;
        return { id: a.id, title, detail, kind: a.kind, label: a.metadataLabel, hash: a.hash, txHash: a.txHash, createdAt: a.createdAt };
      }
      let detail = '';
      if (p.result) {
        const r = p.result;
        detail =
          subject === 'dv'
            ? `${r.outcome} — ${r.yes} power vs ${r.threshold}%`
            : `${r.outcome} — ${r.yes}/${r.threshold} YES`;
      }
      if (ref) detail += `${detail ? ' · ' : ''}${ref.length > 44 ? `${ref.slice(0, 40)}…` : ref}`;
      return {
        id: a.id,
        title,
        detail,
        kind: a.kind,
        label: a.metadataLabel,
        hash: a.hash,
        txHash: a.txHash,
        createdAt: a.createdAt,
      };
    });
  }

  /** Current merit = clamped sum of the DRep's merit-ledger deltas (§13), capped at MERIT_POINT_MAX. */
  private async currentMerit(drepId: string, max?: number): Promise<number> {
    const agg = await this.prisma.meritLedger.aggregate({ where: { drepId }, _sum: { delta: true } });
    const cap = max ?? (await this.numConfig('MERIT_POINT_MAX'));
    return clampMerit(agg._sum.delta ? Number(agg._sum.delta) : 0, cap);
  }

  /** Read a numeric platform_config value (DB override, else the compiled default). */
  private async numConfig(key: keyof typeof PLATFORM_CONFIG_DEFAULTS): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    return typeof row?.value === 'number' ? row.value : (PLATFORM_CONFIG_DEFAULTS[key] as number);
  }

  /** §2/§14 — an ADA holder applies to become an Expert (board then approves). */
  async applyExpert(userId: string, dto: ExpertApplicationDto) {
    const existing = await this.prisma.expert.findFirst({ where: { userId } });
    if (existing?.approvedByBoard) throw new ConflictException('you are already an approved Expert');
    const data = {
      displayName: dto.displayName,
      bio: dto.bio ?? null,
      subcategoryIds: dto.subcategoryIds ?? [],
      approvedByBoard: false,
    };
    if (existing) return this.prisma.expert.update({ where: { id: existing.id }, data });
    return this.prisma.expert.create({ data: { userId, ...data } });
  }

  /** The user's own Expert record (application or approval), if any. */
  async getMyExpert(userId: string) {
    return this.prisma.expert.findFirst({ where: { userId } });
  }

  /**
   * Board view of Expert applications. Default: pending (awaiting approval). `history` also
   * includes already-approved experts (the done items). Note: rejected applications are deleted,
   * so they leave no history.
   */
  async listExpertApplications(history = false) {
    const experts = await this.prisma.expert.findMany({
      where: history ? {} : { approvedByBoard: false },
      include: { user: { select: { stakeAddress: true, displayName: true } } },
      orderBy: [{ approvedByBoard: 'asc' }, { displayName: 'asc' }],
    });
    return experts.map((e) => ({
      id: e.id,
      displayName: e.displayName,
      bio: e.bio,
      stakeAddress: e.user.stakeAddress,
      subcategoryIds: e.subcategoryIds,
      approved: e.approvedByBoard,
    }));
  }

  /** Board approves a pending Expert application. */
  async approveExpertById(id: string) {
    const expert = await this.prisma.expert.findUnique({ where: { id } });
    if (!expert) throw new NotFoundException('expert application not found');
    return this.prisma.expert.update({ where: { id }, data: { approvedByBoard: true } });
  }

  /** Board rejects (removes) a pending Expert application. */
  async rejectExpertById(id: string) {
    await this.prisma.expert.delete({ where: { id } }).catch(() => undefined);
    return { ok: true };
  }

  /** Approved Experts — listed in the DAO dashboard (§2). */
  async listApprovedExperts() {
    const experts = await this.prisma.expert.findMany({
      where: { approvedByBoard: true },
      orderBy: { displayName: 'asc' },
    });
    return experts.map((e) => ({
      id: e.id,
      displayName: e.displayName,
      bio: e.bio,
      subcategoryIds: e.subcategoryIds,
    }));
  }

  /** The user's own DRep profile + admission progress (votes, rationales, tally). */
  async getMine(userId: string) {
    const drep = await this.prisma.drep.findUnique({
      where: { userId },
      include: {
        admissionVotesReceived: {
          include: { voter: { include: { user: { select: { displayName: true, drepKeyHash: true } } } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!drep) return null;
    const threshold = await this.approvalThreshold();
    const votes = drep.admissionVotesReceived;
    // §C — latest on-chain anchor of this applicant's admission decision, if any.
    const anchor = await this.prisma.anchor.findFirst({
      where: { kind: 'admission', proposalId: drep.id },
      orderBy: { createdAt: 'desc' },
      select: { txHash: true },
    });
    // Fall back to the board-seat name when a board member hasn't set a display name.
    const seats = await this.prisma.boardSeat.findMany();
    const seatName = new Map(seats.map((s) => [s.drepKeyHash, s.displayName]));
    const voterLabel = (v: (typeof votes)[number]) =>
      v.voter.user.displayName ??
      (v.voter.user.drepKeyHash && seatName.get(v.voter.user.drepKeyHash)) ??
      'Board member';
    return {
      id: drep.id,
      status: drep.status,
      drepIdOnchain: drep.drepIdOnchain,
      bio: drep.bio,
      photo: drep.photo,
      socials: drep.socials,
      contact: drep.contact,
      subcategoryIds: drep.subcategoryIds,
      kycOptin: drep.kycOptin,
      callsOptin: drep.callsOptin,
      admissionCallOptin: drep.admissionCallOptin,
      yes: votes.filter((v) => v.choice === 'YES').length,
      no: votes.filter((v) => v.choice === 'NO').length,
      threshold,
      admissionVotesReceived: votes.map((v) => ({
        choice: v.choice,
        feedback: v.feedback,
        voterName: voterLabel(v),
      })),
      anchorTxHash: anchor?.txHash ?? null,
    };
  }

  /** §14.2 — a registered on-chain DRep requests to join the DAO (or re-applies
   * after a previous rejection/removal). The DRep ID is taken from the wallet's
   * verified CIP-95 key, never from client input. */
  async apply(userId: string, dto: DrepApplicationDto) {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('user not found');
    if (!user.drepKeyHash || !user.drepRegistered) {
      throw new ForbiddenException(
        'only a registered on-chain DRep can join the DAO — register your DRep key on-chain, then sign in again',
      );
    }
    const drepIdOnchain = drepIdFromKeyHashHex(user.drepKeyHash);

    const existing = await this.prisma.drep.findUnique({ where: { userId } });
    if (existing?.status === DRepStatus.ADMITTED) {
      throw new ConflictException('already an admitted DRep');
    }
    if (existing?.status === DRepStatus.PENDING_ADMISSION) {
      throw new ConflictException('an application is already pending');
    }

    // §14.1 — enforce the (configurable) on-chain entry gate, not just the disabled button.
    const elig = await this.entryEligibility(userId);
    if (!elig.eligible) {
      const why = elig.requirements.filter((r) => !r.met).map((r) => `${r.label}: ${r.detail}`).join('; ');
      throw new ForbiddenException(`you don't yet meet the DAO entry requirements — ${why}`);
    }

    if (dto.displayName !== undefined) {
      await this.prisma.appUser.update({ where: { id: userId }, data: { displayName: dto.displayName } });
    }

    const data = {
      drepIdOnchain,
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

  /**
   * §14 — a DAO member voluntarily leaves (status → REMOVED). A board member who
   * leaves also resigns their board seat, so they truly stop being on the board
   * (an admin re-seats a replacement from genesis). Idempotent-ish; can re-apply.
   */
  async leaveDao(userId: string) {
    const drep = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    if (!drep) throw new NotFoundException('no DRep profile');
    if (drep.status !== DRepStatus.ADMITTED) throw new ConflictException('you are not an active DAO member');
    const seat = drep.user.drepKeyHash
      ? await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: drep.user.drepKeyHash } })
      : null;
    await this.prisma.$transaction(async (tx) => {
      if (seat) await tx.boardSeat.delete({ where: { drepKeyHash: seat.drepKeyHash } }); // board member resigns
      await tx.drep.update({ where: { id: drep.id }, data: { status: DRepStatus.REMOVED } });
    });
    return { status: DRepStatus.REMOVED, resignedBoardSeat: !!seat };
  }

  async updateMine(userId: string, dto: UpdateDrepDto) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new NotFoundException('no DRep profile — apply first');

    if (dto.displayName !== undefined) {
      await this.prisma.appUser.update({ where: { id: userId }, data: { displayName: dto.displayName } });
    }

    if (dto.photo !== undefined && dto.photo !== '' && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(dto.photo)) {
      throw new ConflictException('photo must be a data URL (data:image/<type>;base64,…)');
    }

    return this.prisma.drep.update({
      where: { id: drep.id },
      data: {
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.photo !== undefined ? { photo: dto.photo === '' ? null : dto.photo } : {}),
        ...(dto.socials !== undefined ? { socials: dto.socials as Prisma.InputJsonValue } : {}),
        ...(dto.contact !== undefined ? { contact: dto.contact as Prisma.InputJsonValue } : {}),
        ...(dto.subcategoryIds !== undefined ? { subcategoryIds: dto.subcategoryIds } : {}),
        ...(dto.kycOptin !== undefined ? { kycOptin: dto.kycOptin } : {}),
        ...(dto.callsOptin !== undefined ? { callsOptin: dto.callsOptin } : {}),
        ...(dto.admissionCallOptin !== undefined ? { admissionCallOptin: dto.admissionCallOptin } : {}),
      },
    });
  }

  /**
   * §25.5 — board view of DRep applications + tally + this board member's own vote.
   * `history` includes resolved (ADMITTED/REJECTED) applications for auditing; the default
   * is only those still pending a decision.
   */
  async listApplications(boardUserId: string, history = false) {
    const dreps = await this.prisma.drep.findMany({
      where: history
        ? { status: { in: [DRepStatus.PENDING_ADMISSION, DRepStatus.ADMITTED, DRepStatus.REJECTED] } }
        : { status: DRepStatus.PENDING_ADMISSION },
      include: {
        user: { select: { stakeAddress: true, displayName: true, createdAt: true } },
        admissionVotesReceived: true,
      },
      orderBy: { user: { createdAt: 'asc' } },
    });
    const threshold = await this.approvalThreshold();
    // The reviewing board member's own DRep id (to surface "your vote").
    const me = await this.prisma.drep.findUnique({ where: { userId: boardUserId }, select: { id: true } });
    // In history, show only DReps that actually went through a board vote — exclude genesis-seated
    // board members (auto-ADMITTED with no admission votes), who never "applied".
    const visible = history
      ? dreps.filter((d) => d.status === DRepStatus.PENDING_ADMISSION || d.admissionVotesReceived.length > 0)
      : dreps;
    return visible.map((d) => {
      const myVote = me ? d.admissionVotesReceived.find((v) => v.boardDrepId === me.id) : undefined;
      return {
        drepId: d.id,
        drepIdOnchain: d.drepIdOnchain,
        displayName: d.user.displayName,
        stakeAddress: d.user.stakeAddress,
        bio: d.bio,
        subcategoryIds: d.subcategoryIds,
        socials: d.socials,
        contact: d.contact,
        kycOptin: d.kycOptin,
        callsOptin: d.callsOptin,
        admissionCallOptin: d.admissionCallOptin,
        yes: d.admissionVotesReceived.filter((v) => v.choice === 'YES').length,
        no: d.admissionVotesReceived.filter((v) => v.choice === 'NO').length,
        threshold,
        status: d.status, // PENDING_ADMISSION | ADMITTED | REJECTED
        myVote: myVote ? { choice: myVote.choice, feedback: myVote.feedback } : null,
      };
    });
  }

  /** §14.2 — a board member votes on an application; admit/reject when decided. */
  async voteOnApplication(boardUserId: string, applicantDrepId: string, dto: AdmissionVoteDto) {
    if (!dto.feedback?.trim()) {
      throw new BadRequestException('a written rationale is required for every vote (YES or NO)');
    }

    const applicant = await this.prisma.drep.findUnique({ where: { id: applicantDrepId } });
    if (!applicant) throw new NotFoundException('applicant not found');
    if (applicant.status !== DRepStatus.PENDING_ADMISSION) {
      throw new ConflictException('this application is not pending');
    }

    const board = await this.prisma.drep.findUnique({
      where: { userId: boardUserId },
      include: { user: { select: { drepKeyHash: true, stakeAddress: true } } },
    });
    if (!board) throw new ForbiddenException('board members only');
    if (board.id === applicant.id) throw new BadRequestException('cannot vote on your own application');
    // Enforce board-only here too (defence in depth beyond the controller guard).
    const seat = board.user.drepKeyHash
      ? await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: board.user.drepKeyHash } })
      : null;
    if (!seat) throw new ForbiddenException('only seated board members can vote on admissions');

    // §C — verify the voter's CIP-30 signData over the canonical vote message (free, no tx).
    let signature: string | null = null;
    let signingKey: string | null = null;
    let signedAt: Date | null = null;
    if (dto.signature && dto.signingKey && dto.ts) {
      const message = admissionVoteMessage({
        applicantDrepId: applicant.drepIdOnchain,
        voterStakeAddress: board.user.stakeAddress,
        choice: dto.choice,
        rationale: dto.feedback,
        ts: dto.ts,
      });
      if (!verifyCip30Signature(dto.signature, dto.signingKey, message, board.user.stakeAddress)) {
        throw new BadRequestException('vote signature verification failed');
      }
      signature = dto.signature;
      signingKey = dto.signingKey;
      signedAt = new Date(dto.ts);
    }

    await this.prisma.admissionVote.upsert({
      where: { drepId_boardDrepId: { drepId: applicant.id, boardDrepId: board.id } },
      update: { choice: dto.choice, feedback: dto.feedback ?? null, signature, signingKey, signedAt },
      create: {
        drepId: applicant.id,
        boardDrepId: board.id,
        choice: dto.choice,
        feedback: dto.feedback ?? null,
        signature,
        signingKey,
        signedAt,
      },
    });

    const votes = await this.prisma.admissionVote.findMany({ where: { drepId: applicant.id } });
    const yes = votes.filter((v) => v.choice === 'YES').length;
    const no = votes.filter((v) => v.choice === 'NO').length;
    const threshold = await this.approvalThreshold();
    const boardCount = await this.prisma.boardSeat.count();

    let status: string = applicant.status;
    if (yes >= threshold) {
      status = DRepStatus.ADMITTED;
    } else if (no > boardCount - threshold) {
      // YES can no longer reach the threshold → rejected
      status = DRepStatus.REJECTED;
    }

    let anchorTxHash: string | null = null;
    if (status !== applicant.status) {
      await this.prisma.drep.update({
        where: { id: applicant.id },
        data: { status, admittedAt: status === DRepStatus.ADMITTED ? new Date() : null },
      });
      // §C — on a decision, anchor the full signed vote set + tally on-chain (one tx).
      if (status === DRepStatus.ADMITTED || status === DRepStatus.REJECTED) {
        anchorTxHash = await this.anchorAdmission(applicant.id, applicant.drepIdOnchain, status, yes, no, threshold);
      }
    }

    return { applicantDrepId: applicant.id, yes, no, threshold, boardCount, status, anchorTxHash };
  }

  /** Build the signed-vote preimage and anchor the decision on-chain (best-effort). */
  private async anchorAdmission(
    applicantRowId: string,
    applicantDrepId: string,
    outcome: string,
    yes: number,
    no: number,
    threshold: number,
  ): Promise<string | null> {
    try {
      const all = await this.prisma.admissionVote.findMany({
        where: { drepId: applicantRowId },
        include: { voter: { select: { drepIdOnchain: true } } },
      });
      const voteEvents = all.map((v) => ({
        v: 1 as const,
        t: 'vote' as const,
        subject: GovSubject.ADMISSION,
        style: VotingStyle.ONE_PERSON_ONE_VOTE,
        ts: (v.signedAt ?? v.createdAt).toISOString(),
        ref: applicantDrepId,
        voter: v.voter.drepIdOnchain,
        choice: v.choice as 'YES' | 'NO',
        rh: v.feedback ? createHash('sha256').update(v.feedback).digest('hex') : undefined,
        signature: v.signature,
        signingKey: v.signingKey,
      }));
      const res = await this.anchor.anchorAdmissionResult({
        applicantDrepRowId: applicantRowId,
        applicantDrepId,
        votes: voteEvents,
        outcome: outcome === DRepStatus.ADMITTED ? 'ADMITTED' : 'REJECTED',
        yes,
        no,
        threshold,
      });
      return res.txHash;
    } catch {
      return null; // never fail the vote because anchoring hiccuped
    }
  }

  // ── §14.4 Removal of a DAO member (3-of-5 board vote) ──────────────────────

  /** A board member proposes removing a DAO member. */
  async proposeRemoval(boardUserId: string, targetDrepId: string, reason?: string) {
    const board = await this.requireBoardDrep(boardUserId);
    const target = await this.prisma.drep.findUnique({
      where: { id: targetDrepId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    if (!target || target.status !== DRepStatus.ADMITTED) {
      throw new NotFoundException('target is not an active DAO member');
    }
    if (target.id === board.id) throw new BadRequestException('cannot propose your own removal');
    const targetIsBoard = target.user.drepKeyHash
      ? (await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: target.user.drepKeyHash } })) !== null
      : false;
    if (targetIsBoard) throw new BadRequestException('board members are managed via genesis, not removal votes');
    const open = await this.prisma.drepRemoval.findFirst({ where: { targetDrepId, status: 'PENDING' } });
    if (open) throw new ConflictException('a removal is already pending for this member');
    return this.prisma.drepRemoval.create({
      data: { targetDrepId, proposedBy: board.id, reason: reason ?? null, status: 'PENDING' },
    });
  }

  /** A board member votes on a removal; 3-of-5 YES removes the member. */
  async voteRemoval(boardUserId: string, removalId: string, choice: 'YES' | 'NO', rationale?: string) {
    if (!rationale?.trim()) throw new BadRequestException('a written rationale is required for every vote');
    const board = await this.requireBoardDrep(boardUserId);
    const removal = await this.prisma.drepRemoval.findUnique({ where: { id: removalId } });
    if (!removal || removal.status !== 'PENDING') throw new ConflictException('this removal is not pending');

    await this.prisma.drepRemovalVote.upsert({
      where: { removalId_boardDrepId: { removalId, boardDrepId: board.id } },
      update: { choice, rationale },
      create: { removalId, boardDrepId: board.id, choice, rationale },
    });

    const votes = await this.prisma.drepRemovalVote.findMany({ where: { removalId } });
    const yes = votes.filter((v) => v.choice === 'YES').length;
    const no = votes.filter((v) => v.choice === 'NO').length;
    const threshold = await this.approvalThreshold();
    const boardCount = await this.prisma.boardSeat.count();

    let status = 'PENDING';
    if (yes >= threshold) status = 'APPROVED';
    else if (no > boardCount - threshold) status = 'REJECTED';

    let anchorTxHash: string | null = null;
    if (status !== 'PENDING') {
      await this.prisma.drepRemoval.update({ where: { id: removalId }, data: { status, resolvedAt: new Date() } });
      if (status === 'APPROVED') {
        await this.prisma.drep.update({
          where: { id: removal.targetDrepId },
          data: { status: DRepStatus.REMOVED, removedAt: new Date() },
        });
      }
      // §C — anchor the removal decision on-chain (like admission), so it has a proof.
      anchorTxHash = await this.anchorRemoval(removalId, removal.targetDrepId, status, yes, no, threshold);
    }
    return { status, yes, no, threshold, anchorTxHash };
  }

  /** Anchor a resolved removal decision on-chain (best-effort; never blocks the vote). */
  private async anchorRemoval(
    removalId: string,
    targetDrepRowId: string,
    outcome: string,
    yes: number,
    no: number,
    threshold: number,
  ): Promise<string | null> {
    try {
      const target = await this.prisma.drep.findUnique({
        where: { id: targetDrepRowId },
        select: { drepIdOnchain: true },
      });
      if (!target) return null;
      const votes = await this.prisma.drepRemovalVote.findMany({ where: { removalId } });
      const voters = await this.prisma.drep.findMany({
        where: { id: { in: votes.map((v) => v.boardDrepId) } },
        select: { id: true, drepIdOnchain: true },
      });
      const onchain = new Map(voters.map((d) => [d.id, d.drepIdOnchain]));
      const voteList = votes.map((v) => ({
        drep: onchain.get(v.boardDrepId) ?? v.boardDrepId,
        choice: v.choice,
        rationale: v.rationale ?? null,
      }));
      const res = await this.anchor.anchorResult({
        kind: 'removal',
        subject: GovSubject.REMOVAL,
        style: VotingStyle.ONE_PERSON_ONE_VOTE,
        ref: target.drepIdOnchain,
        proposalId: targetDrepRowId,
        votes: voteList.map((v) => ({ drep: v.drep, vote: v.choice })),
        preimageVotes: voteList,
        outcome: outcome === 'APPROVED' ? 'REMOVED' : 'KEPT',
        yes,
        no,
        threshold,
      });
      return res.txHash;
    } catch {
      return null; // anchoring must never undo the decision
    }
  }

  /**
   * Board view of removals (with this board member's own vote). Default: pending; `history`
   * also includes resolved removals (APPROVED = removed / REJECTED = kept) for auditing.
   */
  async listActiveRemovals(boardUserId: string, history = false) {
    const me = await this.prisma.drep.findUnique({ where: { userId: boardUserId }, select: { id: true } });
    const removals = await this.prisma.drepRemoval.findMany({
      where: history ? {} : { status: 'PENDING' },
      include: { votes: true },
      orderBy: { createdAt: 'asc' },
    });
    const threshold = await this.approvalThreshold();
    const names = await this.drepNames(removals.flatMap((r) => [r.targetDrepId, r.proposedBy, ...r.votes.map((v) => v.boardDrepId)]));
    return removals.map((r) => ({
      id: r.id,
      reason: r.reason,
      targetDrepId: r.targetDrepId,
      targetName: names.get(r.targetDrepId) ?? '?',
      proposedByName: names.get(r.proposedBy) ?? '?',
      yes: r.votes.filter((v) => v.choice === 'YES').length,
      no: r.votes.filter((v) => v.choice === 'NO').length,
      threshold,
      status: r.status, // PENDING | APPROVED (removed) | REJECTED (kept)
      resolvedAt: r.resolvedAt,
      myVote: me ? r.votes.find((v) => v.boardDrepId === me.id)?.choice ?? null : null,
      votes: r.votes.map((v) => ({ choice: v.choice, rationale: v.rationale, voterName: names.get(v.boardDrepId) ?? 'Board member' })),
    }));
  }

  /** The pending removal targeting this user (so My area can warn them). */
  async getMyActiveRemoval(userId: string) {
    const me = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } });
    if (!me) return null;
    const r = await this.prisma.drepRemoval.findFirst({
      where: { targetDrepId: me.id, status: 'PENDING' },
      include: { votes: true },
    });
    if (!r) return null;
    const threshold = await this.approvalThreshold();
    const names = await this.drepNames([r.proposedBy, ...r.votes.map((v) => v.boardDrepId)]);
    return {
      reason: r.reason,
      proposedByName: names.get(r.proposedBy) ?? '?',
      yes: r.votes.filter((v) => v.choice === 'YES').length,
      no: r.votes.filter((v) => v.choice === 'NO').length,
      threshold,
      votes: r.votes.map((v) => ({ choice: v.choice, rationale: v.rationale, voterName: names.get(v.boardDrepId) ?? 'Board member' })),
    };
  }

  /** Admitted non-board DReps that the board may propose to remove. */
  async listRemovableMembers() {
    const seats = await this.prisma.boardSeat.findMany();
    const boardKeys = new Set(seats.map((s) => s.drepKeyHash));
    const dreps = await this.prisma.drep.findMany({
      where: { status: DRepStatus.ADMITTED },
      include: { user: { select: { displayName: true, drepKeyHash: true } } },
    });
    return dreps
      .filter((d) => !(d.user.drepKeyHash && boardKeys.has(d.user.drepKeyHash)))
      .map((d) => ({ drepId: d.id, displayName: d.user.displayName ?? d.drepIdOnchain, drepIdOnchain: d.drepIdOnchain }));
  }

  /** Resolve drep ids → display names (self-set, else board-seat name, else short id). */
  private async drepNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    const dreps = await this.prisma.drep.findMany({
      where: { id: { in: unique } },
      include: { user: { select: { displayName: true, drepKeyHash: true } } },
    });
    const seats = await this.prisma.boardSeat.findMany();
    const seatName = new Map(seats.map((s) => [s.drepKeyHash, s.displayName]));
    const out = new Map<string, string>();
    for (const d of dreps) {
      out.set(
        d.id,
        d.user.displayName ?? (d.user.drepKeyHash && seatName.get(d.user.drepKeyHash)) ?? `${d.drepIdOnchain.slice(0, 12)}…`,
      );
    }
    return out;
  }

  /** Resolve + verify a seated board member by their wallet user id. */
  private async requireBoardDrep(boardUserId: string): Promise<{ id: string; drepKeyHash: string }> {
    const d = await this.prisma.drep.findUnique({
      where: { userId: boardUserId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    if (!d || !d.user.drepKeyHash) throw new ForbiddenException('board members only');
    const seat = await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: d.user.drepKeyHash } });
    if (!seat) throw new ForbiddenException('only seated board members');
    return { id: d.id, drepKeyHash: d.user.drepKeyHash };
  }

  private async approvalThreshold(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({
      where: { key: 'ADMISSION_APPROVAL_VOTES' },
    });
    const v = row?.value;
    return typeof v === 'number' ? v : PLATFORM_CONFIG_DEFAULTS.ADMISSION_APPROVAL_VOTES;
  }

  /**
   * §14.1 — can this registered DRep request DAO entry? Two independently-toggled
   * gates: voting power/delegators, and past on-chain voting activity. When both
   * switches are OFF (testnet default) entry is open. Returns per-requirement reasons
   * so the UI can enable/disable the Join button and explain any shortfall.
   */
  async entryEligibility(userId: string): Promise<{
    gatingEnabled: boolean;
    eligible: boolean;
    requirements: { group: 'power' | 'activity'; label: string; met: boolean; detail: string }[];
  }> {
    const rows = await this.prisma.platformConfig.findMany();
    const overrides = new Map(rows.map((r) => [r.key, r.value]));
    const D = PLATFORM_CONFIG_DEFAULTS as Record<string, number | string | boolean>;
    const num = (k: string) => { const v = overrides.get(k); return typeof v === 'number' ? v : (D[k] as number); };
    const bool = (k: string) => { const v = overrides.get(k); return typeof v === 'boolean' ? v : (D[k] as boolean); };

    const requirePower = bool('ENTRY_REQUIRE_VOTING_POWER');
    const requireActivity = bool('ENTRY_REQUIRE_ACTIVITY');
    const gatingEnabled = requirePower || requireActivity;
    const requirements: { group: 'power' | 'activity'; label: string; met: boolean; detail: string }[] = [];
    if (!gatingEnabled) return { gatingEnabled: false, eligible: true, requirements };

    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user?.drepKeyHash || !user.drepRegistered) {
      return {
        gatingEnabled,
        eligible: false,
        requirements: [{ group: 'power', label: 'Registered DRep', met: false, detail: 'register your DRep key on-chain, then sign in again' }],
      };
    }
    const drepId = drepIdFromKeyHashHex(user.drepKeyHash);

    if (requirePower) {
      const minOwn = num('MIN_OWN_VOTING_POWER_ADA');
      const minDelegs = num('MIN_DELEGATORS');
      const minStake = num('MIN_DELEGATOR_STAKE_ADA');
      const m = await this.cardano.drepEntryMetrics(drepId, user.stakeAddress, BigInt(Math.round(minStake)) * 1_000_000n);
      const ownAda = Number(m.ownVotingPowerLovelace) / 1_000_000;
      const met = m.available && (ownAda >= minOwn || m.qualifyingDelegators >= minDelegs);
      requirements.push({
        group: 'power',
        label: 'Voting power',
        met,
        detail: !m.available
          ? "couldn't read your on-chain delegation right now — try again"
          : `own ${Math.round(ownAda).toLocaleString()} ₳ (need ${minOwn.toLocaleString()}), or ${m.qualifyingDelegators} delegators ≥ ${minStake.toLocaleString()} ₳ (need ${minDelegs})`,
      });
    }

    if (requireActivity) {
      const window = num('MINIMUM_VOTES_CASTED');
      const activityPct = num('MINIMUM_DREP_ACTIVITY');
      const onlyRationale = bool('ONLY_VOTES_WITH_RATIONALE');
      const need = Math.ceil((window * activityPct) / 100);
      const a = await this.cardano.drepActivityMetrics(drepId, window, onlyRationale);
      const met = a.available && a.votesInWindow >= need;
      requirements.push({
        group: 'activity',
        label: 'Voting activity',
        met,
        detail: !a.available
          ? "couldn't read your on-chain voting history right now — try again"
          : `voted on ${a.votesInWindow} of the last ${window} governance actions${onlyRationale ? ' (with rationale)' : ''} — need ${need}`,
      });
    }

    return { gatingEnabled, eligible: requirements.every((r) => r.met), requirements };
  }
}

/** Round to 2 decimals for display. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
