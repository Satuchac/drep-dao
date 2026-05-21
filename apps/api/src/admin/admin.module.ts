import { Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { GenesisService } from './genesis.service';
import { AdminGuard } from './admin.guard';
import { SysadminAuthController } from './sysadmin-auth.controller';
import { SysadminGenesisController } from './sysadmin-genesis.controller';

@Module({
  controllers: [SysadminAuthController, SysadminGenesisController],
  providers: [AdminAuthService, AdminAuditService, GenesisService, AdminGuard],
  exports: [AdminAuthService],
})
export class AdminModule {}
