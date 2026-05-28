import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { InternalProposalsService } from './internal-proposals.service';
import { CreateInternalProposalDto, ExtendInternalDto, VoteInternalDto } from './dto';

// §10 — internal proposals (threshold voting / polls). Any authenticated user reads the public
// ones; PRIVATE ones are filtered to board members inside the service.
@Controller('internal-proposals')
@UseGuards(JwtAuthGuard)
export class InternalProposalsController {
  constructor(private readonly internal: InternalProposalsService) {}

  @Get()
  list(@CurrentUser() c: AuthContext) {
    return this.internal.list(c.userId);
  }

  // Static route must come BEFORE @Get(':id') (UUID pipe would reject 'pending-count').
  @Get('pending-count')
  pendingCount(@CurrentUser() c: AuthContext) {
    return this.internal.pendingCount(c.userId);
  }

  @Get(':id')
  get(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.internal.detail(id, c.userId);
  }

  @Post()
  submit(@CurrentUser() c: AuthContext, @Body() dto: CreateInternalProposalDto) {
    return this.internal.submit(c.userId, dto);
  }

  @Post(':id/vote')
  vote(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoteInternalDto) {
    return this.internal.vote(c.userId, id, dto);
  }

  @Post(':id/extend')
  extend(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendInternalDto) {
    return this.internal.extendVoting(c.userId, id, dto.votingEndAt);
  }

  @Post(':id/finalize')
  finalize(@Param('id', ParseUUIDPipe) id: string) {
    return this.internal.finalize(id);
  }
}
