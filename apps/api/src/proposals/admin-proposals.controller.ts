import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { ProposalsService } from './proposals.service';

// §26.5 — board overrides for proposals.
@Controller('admin/proposals')
@UseGuards(JwtAuthGuard, BoardGuard)
export class AdminProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Post(':id/confirm-fee')
  confirmFee(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.confirmFee(id);
  }
}
