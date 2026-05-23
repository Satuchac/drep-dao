import { Global, Module } from '@nestjs/common';
import { CardanoQueryService } from './cardano-query.service';
import { AnchorService } from './anchor.service';

@Global()
@Module({
  providers: [CardanoQueryService, AnchorService],
  exports: [CardanoQueryService, AnchorService],
})
export class CardanoModule {}
