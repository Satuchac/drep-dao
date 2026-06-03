import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CardanoModule } from '../cardano/cardano.module';
import { BoardGuard } from '../auth/board.guard';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { BoardMultisigService } from './board-multisig.service';
import { BoardMultisigController } from './board-multisig.controller';
import { MultisigBroadcastService } from './multisig-broadcast.service';

@Module({
  imports: [AuthModule, CardanoModule],
  controllers: [TreasuryController, BoardMultisigController],
  providers: [TreasuryService, BoardMultisigService, MultisigBroadcastService, BoardGuard],
  exports: [BoardMultisigService],
})
export class TreasuryModule {}
