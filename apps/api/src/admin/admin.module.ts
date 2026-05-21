import { Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminService } from './admin.service';
import { GenesisService } from './genesis.service';
import { AdminGuard } from './admin.guard';
import { SysadminAuthController } from './sysadmin-auth.controller';
import { SysadminGenesisController } from './sysadmin-genesis.controller';
import { SysadminOpsController } from './sysadmin-ops.controller';

@Module({
  controllers: [SysadminAuthController, SysadminGenesisController, SysadminOpsController],
  providers: [AdminAuthService, AdminAuditService, AdminService, GenesisService, AdminGuard],
  exports: [AdminAuthService],
})
export class AdminModule {}
