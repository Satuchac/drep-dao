import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DRepStatus } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from './current-user.decorator';

/**
 * Authorizes board-only ("admin", §25.5) endpoints: the current user must be an
 * ADMITTED DRep with an active board_membership. Run AFTER JwtAuthGuard.
 */
@Injectable()
export class BoardGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: AuthContext }>();
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedException('not authenticated');

    const membership = await this.prisma.boardMembership.findFirst({
      where: { endedAt: null, drep: { userId, status: DRepStatus.ADMITTED } },
    });
    if (!membership) throw new ForbiddenException('board members only');
    return true;
  }
}
