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
      where: { key: { in: ['CARDANO_EXPLORER', 'INTERNAL_DEFAULT_THRESHOLD_PCT', 'INTERNAL_IMPORTANT_THRESHOLD_PCT'] } },
    });
    const val = (k: string) => rows.find((r) => r.key === k)?.value;
    const num = (k: string) =>
      typeof val(k) === 'number' ? (val(k) as number) : ((PLATFORM_CONFIG_DEFAULTS as Record<string, unknown>)[k] as number);
    return {
      network: this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod',
      explorer: String(val('CARDANO_EXPLORER') ?? PLATFORM_CONFIG_DEFAULTS.CARDANO_EXPLORER),
      submissionFeeAddress: this.config.get<string>('SUBMISSION_FEE_ADDRESS') || null,
      // §3 — pledge payment address (FUNDING-stage on-chain pledge). Defaults to
      // SUBMISSION_FEE_ADDRESS so a single address can be used in dev/test if no
      // dedicated PLEDGE_ADDRESS is configured.
      pledgeAddress:
        this.config.get<string>('PLEDGE_ADDRESS')
        || this.config.get<string>('SUBMISSION_FEE_ADDRESS')
        || null,
      anchorMetadataLabel: 80808081,
      // §10 — internal-proposal thresholds, so the submit form can show the real % values.
      internalThresholds: {
        default: num('INTERNAL_DEFAULT_THRESHOLD_PCT'),
        important: num('INTERNAL_IMPORTANT_THRESHOLD_PCT'),
      },
    };
  }
}
