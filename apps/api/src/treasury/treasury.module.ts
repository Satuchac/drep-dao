import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';

@Module({
  imports: [AuthModule],
  controllers: [TreasuryController],
  providers: [TreasuryService, BoardGuard],
})
export class TreasuryModule {}
