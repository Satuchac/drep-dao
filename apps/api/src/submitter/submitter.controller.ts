import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { SubmitterService } from './submitter.service';
import { RejectSubmitterDto, SubmitterApplicationDto } from './dto';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeSubmitterController {
  constructor(private readonly svc: SubmitterService) {}

  @Post('submitter-application')
  apply(@CurrentUser() ctx: AuthContext, @Body() dto: SubmitterApplicationDto) {
    return this.svc.apply(ctx.userId, dto);
  }

  @Get('submitter')
  mine(@CurrentUser() ctx: AuthContext) {
    return this.svc.mine(ctx.userId);
  }

  // §2.1 — an approved submitter deregisters (blocked while proposals are in flight).
  @Post('submitter/leave')
  leave(@CurrentUser() ctx: AuthContext) {
    return this.svc.leave(ctx.userId);
  }
}

@Controller('dao')
@UseGuards(JwtAuthGuard)
export class DaoSubmittersController {
  constructor(private readonly svc: SubmitterService) {}

  // §2.1 — public (logged-in) directory of approved submitters (+ left ones on demand).
  @Get('submitters')
  list(@Query('includeLeft') includeLeft?: string) {
    return this.svc.listApproved(includeLeft === '1' || includeLeft === 'true');
  }

  // §2.1 — a submitter's funding-proposal portfolio + stats (bottom of the profile).
  @Get('submitters/:id/portfolio')
  portfolio(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submitterPortfolio(id);
  }
}

@Controller('admin/submitters')
@UseGuards(JwtAuthGuard, BoardGuard)
export class BoardSubmittersController {
  constructor(private readonly svc: SubmitterService) {}

  @Get('applications')
  list(@Query('history') history?: string) {
    return this.svc.listApplications(history === '1' || history === 'true');
  }

  @Post(':id/approve')
  approve(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(id, ctx.userId);
  }

  @Post(':id/reject')
  reject(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectSubmitterDto) {
    return this.svc.reject(id, dto.reason, ctx.userId);
  }
}
