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
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'CARDANO_EXPLORER' } });
    const explorer = String(row?.value ?? PLATFORM_CONFIG_DEFAULTS.CARDANO_EXPLORER);
    return {
      network: this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod',
      explorer,
      submissionFeeAddress: this.config.get<string>('SUBMISSION_FEE_ADDRESS') || null,
      anchorMetadataLabel: 80808081,
    };
  }
}
