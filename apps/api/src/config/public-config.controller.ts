import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PLATFORM_CONFIG_DEFAULTS } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Public, unauthenticated config the frontend needs to render correctly for
 * everyone: the chosen block explorer (for on-chain links), the network, the
 * dedicated submission-fee address, and the anchor metadata label.
 *
 * §15.3 — when the board has assembled the multisig, submission fees + pledges
 * go to the multisig address (so the DAO actually controls them). The env
 * SUBMISSION_FEE_ADDRESS / PLEDGE_ADDRESS / TREASURY_ADDRESS are used only
 * when no multisig is assembled (fresh install / after reset).
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
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
      select: { bech32Address: true },
    });
    const multisig = active?.bech32Address ?? null;
    return {
      network: this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod',
      explorer: String(val('CARDANO_EXPLORER') ?? PLATFORM_CONFIG_DEFAULTS.CARDANO_EXPLORER),
      submissionFeeAddress: multisig
        ?? this.config.get<string>('SUBMISSION_FEE_ADDRESS')
        ?? this.config.get<string>('TREASURY_ADDRESS')
        ?? null,
      pledgeAddress: multisig
        ?? this.config.get<string>('PLEDGE_ADDRESS')
        ?? this.config.get<string>('SUBMISSION_FEE_ADDRESS')
        ?? this.config.get<string>('TREASURY_ADDRESS')
        ?? null,
      anchorMetadataLabel: 80808081,
      // §10 — internal-proposal thresholds, so the submit form can show the real % values.
      internalThresholds: {
        default: num('INTERNAL_DEFAULT_THRESHOLD_PCT'),
        important: num('INTERNAL_IMPORTANT_THRESHOLD_PCT'),
      },
      multisigConfigured: !!multisig,
    };
  }
}
