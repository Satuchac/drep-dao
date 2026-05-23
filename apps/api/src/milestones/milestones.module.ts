import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { MilestonesService } from './milestones.service';
import { MilestonesController } from './milestones.controller';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [MilestonesController],
  providers: [MilestonesService, BoardGuard],
})
export class MilestonesModule {}
