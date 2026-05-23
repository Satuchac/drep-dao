import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PLATFORM_CONFIG_DEFAULTS } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Public, unauthenticated config the frontend needs to render correctly for
 * everyone: the chosen block explorer (for on-chain links), the network, the
 * dedicated submission-fee address, and the anchor metadata label.
 */
@Controller('config')
export class PublicConfigController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async get() {
    const rows = await this.prisma.platformConfig.findMany({
      where: { key: { in: ['CARDANO_EXPLORER', 'CARDANO_EXPLORER_CUSTOM_TX_URL'] } },
    });
    const override = new Map(rows.map((r) => [r.key, r.value]));
    const val = (k: 'CARDANO_EXPLORER' | 'CARDANO_EXPLORER_CUSTOM_TX_URL') =>
      String(override.get(k) ?? PLATFORM_CONFIG_DEFAULTS[k]);
    return {
      network: this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod',
      explorer: val('CARDANO_EXPLORER'),
      explorerCustomTxUrl: val('CARDANO_EXPLORER_CUSTOM_TX_URL'),
      submissionFeeAddress: this.config.get<string>('SUBMISSION_FEE_ADDRESS') || null,
      anchorMetadataLabel: 80808081,
    };
  }
}
