import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { DvService } from './dv.service';
import { DvVoteDto } from './dto';

@Controller()
export class DvController {
  constructor(private readonly dv: DvService) {}

  @Get('proposals/:id/dv-result')
  result(@Param('id', ParseUUIDPipe) id: string) {
    return this.dv.result(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/dv-vote')
  vote(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DvVoteDto) {
    return this.dv.vote(ctx.userId, id, dto.choice, dto.rationale);
  }
}
