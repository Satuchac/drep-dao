import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EDIT_WINDOW_MS = 5 * 60 * 1000; // §20.1 — editable for 5 minutes after posting

const authorSelect = {
  select: { id: true, displayName: true, drep: { select: { drepIdOnchain: true } } },
} as const;

/** §20.1 — public proposal comments: threaded one level, 5-min edit, tombstone delete. */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Threaded list (top-level comments with one level of replies). Tombstones shown as [deleted]. */
  async list(proposalId: string) {
    const rows = await this.prisma.comment.findMany({
      where: { proposalId },
      orderBy: { createdAt: 'asc' },
      include: { author: authorSelect },
    });
    const view = (c: (typeof rows)[number]) => ({
      id: c.id,
      parentId: c.parentId,
      author: { displayName: c.author.displayName, drepId: c.author.drep?.drepIdOnchain ?? null },
      contentMd: c.deletedAt ? null : c.contentMd,
      deleted: !!c.deletedAt,
      createdAt: c.createdAt,
    });
    const tops = rows.filter((c) => !c.parentId).map(view);
    const repliesByParent = new Map<string, ReturnType<typeof view>[]>();
    for (const c of rows.filter((c) => c.parentId)) {
      const arr = repliesByParent.get(c.parentId!) ?? [];
      arr.push(view(c));
      repliesByParent.set(c.parentId!, arr);
    }
    return tops.map((t) => ({ ...t, replies: repliesByParent.get(t.id) ?? [] }));
  }

  async create(userId: string, proposalId: string, contentMd: string, parentId?: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: { id: true } });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: parentId } });
      if (!parent || parent.proposalId !== proposalId) throw new BadRequestException('parent comment not found on this proposal');
      if (parent.parentId) throw new BadRequestException('replies are only one level deep');
    }
    const c = await this.prisma.comment.create({
      data: { proposalId, authorUserId: userId, contentMd, parentId: parentId ?? null },
    });
    return { id: c.id };
  }

  async edit(userId: string, commentId: string, contentMd: string) {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c) throw new NotFoundException('comment not found');
    if (c.authorUserId !== userId) throw new ForbiddenException('not your comment');
    if (c.deletedAt) throw new ConflictException('comment was deleted');
    if (Date.now() - c.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new ConflictException('the 5-minute edit window has closed');
    }
    await this.prisma.comment.update({ where: { id: commentId }, data: { contentMd } });
    return { ok: true };
  }

  /** Tombstone delete (the row remains so threads stay intact; content hidden). */
  async remove(userId: string, commentId: string) {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c) throw new NotFoundException('comment not found');
    if (c.authorUserId !== userId) throw new ForbiddenException('not your comment');
    if (!c.deletedAt) await this.prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}
