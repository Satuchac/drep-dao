import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { ProposalsService } from './proposals.service';
import { ProposalsController } from './proposals.controller';
import { AdminProposalsController } from './admin-proposals.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProposalsController, AdminProposalsController],
  providers: [ProposalsService, BoardGuard],
  exports: [ProposalsService],
})
export class ProposalsModule {}
