import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { TreasuryService } from './treasury.service';
import { MultisigService } from './multisig.service';
import { TreasuryController } from './treasury.controller';

@Module({
  imports: [AuthModule],
  controllers: [TreasuryController],
  providers: [TreasuryService, MultisigService, BoardGuard],
})
export class TreasuryModule {}
