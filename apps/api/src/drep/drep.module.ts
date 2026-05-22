import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { DrepService } from './drep.service';
import { MeDrepController } from './me-drep.controller';
import { BoardAdmissionController } from './board-admission.controller';
import { BoardExpertsController } from './board-experts.controller';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [MeDrepController, BoardAdmissionController, BoardExpertsController],
  providers: [DrepService, BoardGuard],
})
export class DrepModule {}
