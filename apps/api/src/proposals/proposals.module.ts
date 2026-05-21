import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { ProposalsService } from './proposals.service';
import { FilteringService } from './filtering.service';
import { ProposalsController } from './proposals.controller';
import { AdminProposalsController } from './admin-proposals.controller';
import { FilteringController } from './filtering.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProposalsController, AdminProposalsController, FilteringController],
  providers: [ProposalsService, FilteringService, BoardGuard],
  exports: [ProposalsService],
})
export class ProposalsModule {}
