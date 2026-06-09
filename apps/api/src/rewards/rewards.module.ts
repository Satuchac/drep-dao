import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { TreasuryModule } from '../treasury/treasury.module';
import { RewardsService } from './rewards.service';
import { RewardsController } from './rewards.controller';

@Module({
  imports: [AuthModule, TreasuryModule], // TreasuryModule exports TreasuryBucketsService
  controllers: [RewardsController],
  providers: [RewardsService, BoardGuard],
  exports: [RewardsService],
})
export class RewardsModule {}
