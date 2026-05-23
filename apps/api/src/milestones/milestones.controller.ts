import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { MilestonesService } from './milestones.service';

export class PoaDto {
  @IsString() @MinLength(1) @MaxLength(20000) contentMd!: string;
}
export class MilestoneVoteDto {
  @IsIn(['YES', 'NO']) choice!: 'YES' | 'NO';
  @IsOptional() @IsString() @MaxLength(5000) rationale?: string;
}

@Controller()
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  // ---- public read ----
  @Get('proposals/:id/milestones')
  forProposal(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.forProposal(id);
  }

  @Get('milestones/:id/result')
  result(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.result(id);
  }

  // ---- reviewer / submitter ----
  @UseGuards(JwtAuthGuard)
  @Get('me/assignments/milestone')
  mine(@CurrentUser() ctx: AuthContext) {
    return this.milestones.myAssignments(ctx.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('milestones/:id/poa')
  poa(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PoaDto) {
    return this.milestones.submitPoa(ctx.userId, id, dto.contentMd);
  }

  @UseGuards(JwtAuthGuard)
  @Post('milestones/:id/vote')
  vote(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MilestoneVoteDto) {
    return this.milestones.vote(ctx.userId, id, dto.choice, dto.rationale);
  }

  // ---- board ----
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/proposals/:id/draw-milestone-reviewers')
  draw(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.drawReviewers(id);
  }

  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/proposals/:id/terminate')
  terminate(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.terminate(id);
  }
}
