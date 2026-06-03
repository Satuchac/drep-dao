import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { TreasuryService } from './treasury.service';

export class PrepareTopUpDto {
  @IsNumber() @Min(1) amountAda!: number;
}
export class ApproveActionDto {
  @IsOptional() @IsString() @MaxLength(8000) signature?: string;
  @IsOptional() @IsString() @MaxLength(8000) signingKey?: string;
  @IsOptional() @IsString() @MaxLength(40) ts?: string;
}
export class SubmitPayoutTxDto {
  @IsString() @MaxLength(80) txHash!: string;
}

// §15 Treasury overview + board actions (prepare/approve multisig spends).
@Controller()
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @UseGuards(JwtAuthGuard)
  @Get('dao/treasury')
  overview() {
    return this.treasury.overview();
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/board-actions')
  myActions(@CurrentUser() ctx: AuthContext, @Query('history') history?: string) {
    return this.treasury.boardActionsFor(ctx.userId, history === '1');
  }

  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/treasury/prepare-topup')
  prepareTopUp(@CurrentUser() ctx: AuthContext, @Body() dto: PrepareTopUpDto) {
    return this.treasury.prepareTopUp(ctx.userId, dto.amountAda);
  }

  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/board-actions/:id/approve')
  approve(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveActionDto) {
    return this.treasury.approve(ctx.userId, id, dto);
  }

  /** §11/§15 — after the board broadcasts the assembled multisig tx, paste
   *  the on-chain tx hash here to verify + stamp the action CONFIRMED. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/board-actions/:id/payout-tx')
  payoutTx(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitPayoutTxDto) {
    return this.treasury.submitPayoutTxHash(ctx.userId, id, dto.txHash);
  }
}
