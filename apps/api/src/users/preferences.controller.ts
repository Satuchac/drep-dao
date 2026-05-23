import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { UsersService } from './users.service';

export class PreferencesDto {
  @IsOptional() @IsIn(['cardanoscan', 'cexplorer', 'adastat', 'custom', '']) explorer?: string;
  @IsOptional() @IsString() @MaxLength(300) explorerCustomTxUrl?: string;
}

/** §20 — per-user personal preferences (My area). */
@Controller()
@UseGuards(JwtAuthGuard)
export class PreferencesController {
  constructor(private readonly users: UsersService) {}

  @Get('me/preferences')
  get(@CurrentUser() ctx: AuthContext) {
    return this.users.getPreferences(ctx.userId);
  }

  @Patch('me/preferences')
  set(@CurrentUser() ctx: AuthContext, @Body() dto: PreferencesDto) {
    return this.users.setPreferences(ctx.userId, dto);
  }
}
