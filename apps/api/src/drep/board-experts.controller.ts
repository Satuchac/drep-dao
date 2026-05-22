import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { DrepService } from './drep.service';

// §25.5 — board reviews Expert applications (non-DRep ADA holders for milestone review).
@Controller('admin/experts')
@UseGuards(JwtAuthGuard, BoardGuard)
export class BoardExpertsController {
  constructor(private readonly drep: DrepService) {}

  @Get('applications')
  applications() {
    return this.drep.listExpertApplications();
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.drep.approveExpertById(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    return this.drep.rejectExpertById(id);
  }
}
