import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { ProposalsService } from './proposals.service';
import { FilteringService } from './filtering.service';
import { DvService } from './dv.service';

// §26.5 — board overrides for proposals.
@Controller('admin/proposals')
@UseGuards(JwtAuthGuard, BoardGuard)
export class AdminProposalsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly filtering: FilteringService,
    private readonly dv: DvService,
  ) {}

  @Post(':id/confirm-fee')
  confirmFee(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.confirmFee(id);
  }

  // §7.1 — draw filtering reviewers (normally automatic at submission-stage end).
  @Post(':id/draw-reviewers')
  drawReviewers(@Param('id', ParseUUIDPipe) id: string) {
    return this.filtering.drawReviewers(id);
  }

  // §4.3/§8 — snapshot voting power and open D&V voting.
  @Post(':id/open-dv-vote')
  openDvVote(@Param('id', ParseUUIDPipe) id: string) {
    return this.dv.openVoting(id);
  }

  // §9.3 — finalize D&V → APPROVED / REJECTED.
  @Post(':id/finalize-dv')
  finalizeDv(@Param('id', ParseUUIDPipe) id: string) {
    return this.dv.finalize(id);
  }
}
