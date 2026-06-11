import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ROUND_SETTING_DEFAULTS } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DvService } from './dv.service';
import { MeritService } from '../merit/merit.service';

/**
 * §9.2 — Quick Poll tie-break. Auto-created by finalizeRound when equal scores collide at the
 * budget cliff; the board confirms with one click; eligible DReps (frozen at creation, same as
 * D&V) vote with balanced power for 48 h (configurable). 51% participation required — else
 * extend (≤3×); final fallback: neither tied proposal is funded.
 */
@Injectable()
export class QuickPollService {
  private readonly logger = new Logger(QuickPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dv: DvService,
    @Optional() private readonly merit?: MeritService,
  ) {}

  private async settings(roundId: string) {
    const r = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: { quickPollParticipationPct: true, quickPollDurationHours: true, quickPollMaxExtensions: true },
    });
    return {
      participationPct: r?.quickPollParticipationPct ?? ROUND_SETTING_DEFAULTS.quickPollParticipationPct,
      durationHours: r?.quickPollDurationHours ?? ROUND_SETTING_DEFAULTS.quickPollDurationHours,
      maxExtensions: r?.quickPollMaxExtensions ?? ROUND_SETTING_DEFAULTS.quickPollMaxExtensions,
    };
  }

  async listForRound(roundId: string, userId?: string) {
    const polls = await this.prisma.quickPoll.findMany({
      where: { roundId },
      include: { votes: true, category: { select: { name: true } } },
      orderBy: { startsAt: 'desc' },
    });
    const myDrep = userId ? await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } }) : null;
    const candidates = await this.prisma.proposal.findMany({
      where: { id: { in: polls.flatMap((p) => p.candidates) } },
      select: { id: true, title: true, publicId: true, requestedAmountAda: true },
    });
    const candById = new Map(candidates.map((c) => [c.id, c]));
    return polls.map((p) => ({
      id: p.id,
      categoryName: p.category?.name ?? null,
      status: p.status,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      extensions: p.extensions,
      winnerId: p.winnerId,
      eligibleCount: p.eligibleDrepIds.length,
      votedCount: p.votes.length,
      myChoice: myDrep ? p.votes.find((v) => v.drepId === myDrep.id)?.choice ?? null : null,
      iAmEligible: !!myDrep && p.eligibleDrepIds.includes(myDrep.id),
      candidates: p.candidates.map((id) => ({
        id,
        title: candById.get(id)?.title ?? '?',
        publicId: candById.get(id)?.publicId ?? null,
        requestedAmountAda: Number(candById.get(id)?.requestedAmountAda ?? 0n) / 1e6,
        power: p.votes.filter((v) => v.choice === id).reduce((s, v) => s + v.power, 0),
      })),
    }));
  }

  /** Board's one-click confirm — opens voting for the configured window. */
  async launch(pollId: string) {
    const poll = await this.prisma.quickPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException('quick poll not found');
    if (poll.status !== 'PENDING_BOARD') throw new ConflictException('this poll has already been launched');
    const s = await this.settings(poll.roundId);
    const now = new Date();
    await this.prisma.quickPoll.update({
      where: { id: pollId },
      data: { status: 'ACTIVE', startsAt: now, endsAt: new Date(now.getTime() + s.durationHours * 3600_000) },
    });
    return this.listOne(pollId);
  }

  async vote(userId: string, pollId: string, choiceProposalId: string) {
    const poll = await this.prisma.quickPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException('quick poll not found');
    if (poll.status !== 'ACTIVE') throw new ConflictException('this poll is not open for voting');
    if (poll.endsAt && poll.endsAt <= new Date()) throw new ConflictException('this poll has ended');
    if (!poll.candidates.includes(choiceProposalId)) throw new BadRequestException('not a candidate of this poll');
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } });
    if (!drep || !poll.eligibleDrepIds.includes(drep.id)) throw new ForbiddenException('you are not eligible to vote in this poll');
    const power = (await this.dv.liveBalancedPower([drep.id])).get(drep.id) ?? 0;
    await this.prisma.quickPollVote.upsert({
      where: { quickPollId_drepId: { quickPollId: pollId, drepId: drep.id } },
      update: { choice: choiceProposalId, power, castAt: new Date() },
      create: { quickPollId: pollId, drepId: drep.id, choice: choiceProposalId, power },
    });
    await this.merit?.tryAward(drep.id, 'QUICK_POLL_VOTE', pollId);
    return this.listOne(pollId, userId);
  }

  /** §9.2 — resolve every ACTIVE poll whose window ended (called by the jobs scheduler). */
  async resolveDue(): Promise<number> {
    const due = await this.prisma.quickPoll.findMany({
      where: { status: 'ACTIVE', endsAt: { lte: new Date() } },
      include: { votes: true },
    });
    for (const poll of due) {
      try {
        await this.resolve(poll.id);
      } catch (e) {
        this.logger.warn(`quick poll ${poll.id} resolution failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return due.length;
  }

  async resolve(pollId: string) {
    const poll = await this.prisma.quickPoll.findUnique({ where: { id: pollId }, include: { votes: true } });
    if (!poll) throw new NotFoundException('quick poll not found');
    if (poll.status !== 'ACTIVE') throw new ConflictException('poll is not active');
    const s = await this.settings(poll.roundId);

    // Participation = voted power / total eligible power (computed live for the frozen voters).
    const allPower = await this.dv.liveBalancedPower(poll.eligibleDrepIds);
    const totalEligible = [...allPower.values()].reduce((a, b) => a + b, 0);
    const votedPower = poll.votes.reduce((sum, v) => sum + v.power, 0);
    const participationPct = totalEligible > 0 ? (votedPower / totalEligible) * 100 : 0;

    if (participationPct < s.participationPct) {
      if (poll.extensions < s.maxExtensions) {
        const endsAt = new Date((poll.endsAt ?? new Date()).getTime() + s.durationHours * 3600_000);
        await this.prisma.quickPoll.update({ where: { id: pollId }, data: { extensions: poll.extensions + 1, endsAt } });
        this.logger.log(`quick poll ${pollId}: participation ${participationPct.toFixed(1)}% < ${s.participationPct}% — extended (${poll.extensions + 1}/${s.maxExtensions})`);
        return { status: 'ACTIVE', extended: true };
      }
      // Final fallback — neither tied proposal is funded.
      await this.prisma.quickPoll.update({ where: { id: pollId }, data: { status: 'FAILED' } });
      for (const id of poll.candidates) {
        await this.dv.finalize(id, { forcedOutcome: 'REJECTED', note: 'budget-cut (quick poll failed — participation too low)' }).catch(() => undefined);
      }
      return { status: 'FAILED' };
    }

    // Winner: highest summed power; ties broken by earliest submission.
    const powerByChoice = new Map<string, number>();
    for (const v of poll.votes) powerByChoice.set(v.choice, (powerByChoice.get(v.choice) ?? 0) + v.power);
    const subs = await this.prisma.proposal.findMany({
      where: { id: { in: poll.candidates } },
      select: { id: true, submittedAt: true, createdAt: true },
    });
    const subAt = new Map(subs.map((p) => [p.id, (p.submittedAt ?? p.createdAt).getTime()]));
    const winner = [...poll.candidates].sort((a, b) =>
      (powerByChoice.get(b) ?? 0) - (powerByChoice.get(a) ?? 0) || (subAt.get(a) ?? 0) - (subAt.get(b) ?? 0),
    )[0];

    await this.prisma.quickPoll.update({ where: { id: pollId }, data: { status: 'RESOLVED', winnerId: winner } });
    await this.dv.finalize(winner, { forcedOutcome: 'APPROVED', note: 'quick-poll winner' }).catch(() => undefined);
    for (const id of poll.candidates.filter((c) => c !== winner)) {
      await this.dv.finalize(id, { forcedOutcome: 'REJECTED', note: 'budget-cut (lost quick poll)' }).catch(() => undefined);
    }
    return { status: 'RESOLVED', winner };
  }

  /** Polls awaiting THIS DRep's vote (drives the voting to-do badge). */
  async myPendingCount(userId: string): Promise<number> {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } });
    if (!drep) return 0;
    const polls = await this.prisma.quickPoll.findMany({
      where: { status: 'ACTIVE', eligibleDrepIds: { has: drep.id } },
      include: { votes: { where: { drepId: drep.id }, select: { drepId: true } } },
    });
    return polls.filter((p) => p.votes.length === 0).length;
  }

  private async listOne(pollId: string, userId?: string) {
    const poll = await this.prisma.quickPoll.findUnique({ where: { id: pollId }, select: { roundId: true } });
    const list = await this.listForRound(poll?.roundId ?? '', userId);
    return list.find((p) => p.id === pollId) ?? null;
  }
}
