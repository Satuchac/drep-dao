import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DrepService } from './drep.service';

// §2/§4 — DAO member overview (board + admitted DReps) with balanced voting power.
@Controller('dao')
@UseGuards(JwtAuthGuard)
export class DaoController {
  constructor(private readonly drep: DrepService) {}

  @Get('members')
  members() {
    return this.drep.listDaoMembers();
  }

  @Get('experts')
  experts() {
    return this.drep.listApprovedExperts();
  }
}
