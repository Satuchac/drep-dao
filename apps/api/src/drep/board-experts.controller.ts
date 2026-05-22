import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { DrepService } from './drep.service';
import { ApproveExpertDto } from './dto';

// §25.5 — board manages Experts (non-DRep ADA holders for milestone review).
@Controller('admin/experts')
@UseGuards(JwtAuthGuard, BoardGuard)
export class BoardExpertsController {
  constructor(private readonly drep: DrepService) {}

  @Get()
  list() {
    return this.drep.listExperts();
  }

  @Post()
  approve(@Body() dto: ApproveExpertDto) {
    return this.drep.approveExpert(dto.stakeAddress, dto.displayName, dto.subcategoryIds);
  }
}
