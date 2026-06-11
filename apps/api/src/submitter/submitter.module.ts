import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { SubmitterService } from './submitter.service';
import { BoardSubmittersController, MeSubmitterController } from './submitter.controller';

@Module({
  imports: [AuthModule],
  controllers: [MeSubmitterController, BoardSubmittersController],
  providers: [SubmitterService, BoardGuard],
  exports: [SubmitterService],
})
export class SubmitterModule {}
