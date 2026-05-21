import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { RoundsService } from './rounds.service';
import { RoundsController } from './rounds.controller';
import { AdminRoundsController } from './admin-rounds.controller';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [RoundsController, AdminRoundsController],
  providers: [RoundsService, BoardGuard],
})
export class RoundsModule {}
