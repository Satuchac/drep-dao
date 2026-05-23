import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DrepModule } from './drep/drep.module';
import { AdminModule } from './admin/admin.module';
import { RoundsModule } from './rounds/rounds.module';
import { ProposalsModule } from './proposals/proposals.module';
import { GovernanceModule } from './governance/governance.module';
import { TreasuryModule } from './treasury/treasury.module';
import { CardanoModule } from './cardano/cardano.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load the monorepo root .env when running from apps/api, then a local override.
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    RedisModule,
    CardanoModule,
    HealthModule,
    UsersModule,
    AuthModule,
    DrepModule,
    AdminModule,
    RoundsModule,
    ProposalsModule,
    GovernanceModule,
    TreasuryModule,
  ],
})
export class AppModule {}
