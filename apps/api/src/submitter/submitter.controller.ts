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
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectSubmitterDto) {
    return this.svc.reject(id, dto.reason);
  }
}
