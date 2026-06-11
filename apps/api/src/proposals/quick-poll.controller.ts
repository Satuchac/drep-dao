import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { QuickPollService } from './quick-poll.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class QuickPollController {
  constructor(private readonly polls: QuickPollService) {}

  // §9.2 — all quick polls of a round (with my vote/eligibility when logged in).
  @Get('rounds/:roundId/quick-polls')
  list(@CurrentUser() ctx: AuthContext, @Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.polls.listForRound(roundId, ctx.userId);
  }

  // Board's one-click confirm — opens the 48h voting window.
  @Post('admin/quick-polls/:id/launch')
  @UseGuards(BoardGuard)
  launch(@Param('id', ParseUUIDPipe) id: string) {
    return this.polls.launch(id);
  }

  // Eligible DRep casts/changes their tie-break vote.
  @Post('quick-polls/:id/vote')
  vote(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: { choice: string }) {
    return this.polls.vote(ctx.userId, id, body?.choice);
  }

  // Polls awaiting MY vote (badge).
  @Get('me/pending-quick-polls')
  async mine(@CurrentUser() ctx: AuthContext) {
    return { count: await this.polls.myPendingCount(ctx.userId) };
  }
}
