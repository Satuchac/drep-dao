import { IsString, MaxLength, MinLength } from 'class-validator';
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { TreasuryBucketsService } from './treasury-buckets.service';

export class CreateBucketDto {
  @IsString() @MinLength(2) @MaxLength(64) label!: string;
}

@Controller()
export class TreasuryBucketsController {
  constructor(private readonly buckets: TreasuryBucketsService) {}

  /** Public — list of treasury buckets (sub-addresses) with live balances. */
  @UseGuards(JwtAuthGuard)
  @Get('dao/treasury/buckets')
  list() {
    return this.buckets.list();
  }

  /** Board-only — create a labeled bucket under the active multisig. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/treasury/buckets')
  create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateBucketDto) {
    return this.buckets.create(ctx.userId, dto.label);
  }
}
