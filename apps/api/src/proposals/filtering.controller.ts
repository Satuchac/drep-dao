import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { FilteringService } from './filtering.service';
import { FilterVoteDto } from './dto';

@Controller()
export class FilteringController {
  constructor(private readonly filtering: FilteringService) {}

  @Get('proposals/:id/filter-result')
  result(@Param('id', ParseUUIDPipe) id: string) {
    return this.filtering.result(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/assignments/filter')
  mine(@CurrentUser() ctx: AuthContext) {
    return this.filtering.myAssignments(ctx.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/filter-vote')
  vote(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FilterVoteDto) {
    return this.filtering.vote(ctx.userId, id, dto.choice, dto.rationale);
  }
}
