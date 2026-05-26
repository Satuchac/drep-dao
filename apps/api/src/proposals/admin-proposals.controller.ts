import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { ProposalsService } from './proposals.service';
import { ReviewFeeDto } from './dto';
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

  // §16 — proposals awaiting fee confirmation (board verifies the tx via explorer, then confirms).
  @Get('pending-fee')
  pendingFee() {
    return this.proposals.listPendingFee();
  }

  // Approve (→ ACTIVE/Filtering) or reject (→ REJECTED, reason required) the submission fee.
  @Post(':id/review-fee')
  reviewFee(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewFeeDto) {
    return this.proposals.reviewFee(id, dto);
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
