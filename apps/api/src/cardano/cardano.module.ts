import { Global, Module } from '@nestjs/common';
import { CardanoQueryService } from './cardano-query.service';

@Global()
@Module({
  providers: [CardanoQueryService],
  exports: [CardanoQueryService],
})
export class CardanoModule {}
