import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { TreasuryService } from './treasury.service';
import { MultisigBroadcastService } from './multisig-broadcast.service';

export class PrepareTopUpDto {
  @IsNumber() @Min(1) amountAda!: number;
}
export class BoardTransferDto {
  @IsString() @MaxLength(200) destAddress!: string;
  @IsNumber() @Min(0.000001) amountAda!: number;
  @IsString() @MaxLength(2000) context!: string;
  /** §15.5 — optional source bucket id. Null/missing = primary bucket. */
  @IsOptional() @IsString() @MaxLength(40) sourceBucketId?: string;
}
// No body needed — sweeps the entire hot-wallet balance.
export class EmptyDto {}
export class ApproveActionDto {
  @IsOptional() @IsString() @MaxLength(8000) signature?: string;
  @IsOptional() @IsString() @MaxLength(8000) signingKey?: string;
  @IsOptional() @IsString() @MaxLength(40) ts?: string;
}
export class SubmitPayoutTxDto {
  @IsString() @MaxLength(80) txHash!: string;
}
export class SubmitWitnessDto {
  /** Hex-encoded TransactionWitnessSet returned by api.signTx(txCbor, true). */
  @IsString() @MaxLength(50000) witnessHex!: string;
}
export class CancelActionDto {
  @IsString() @MaxLength(500) reason!: string;
}

// §15 Treasury overview + board actions (prepare/approve multisig spends).
@Controller()
export class TreasuryController {
  constructor(
    private readonly treasury: TreasuryService,
    private readonly broadcast: MultisigBroadcastService,
  ) {}

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

  /** §15.4 — any board member queues an arbitrary outbound transfer from
   *  the multisig. Goes through the standard 3-of-N Approve & sign flow;
   *  written context becomes the action description (audit trail). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/treasury/prepare-transfer')
  prepareTransfer(@CurrentUser() ctx: AuthContext, @Body() dto: BoardTransferDto) {
    return this.treasury.prepareBoardTransfer(ctx.userId, dto);
  }

  /** §15.3 — sweep the entire hot-wallet balance back into the multisig
   *  treasury. Single-click; the hot wallet is single-sig so no multisig
   *  threshold is required for an inbound-to-treasury move. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/treasury/sweep-hot-wallet')
  sweepHotWallet(@CurrentUser() ctx: AuthContext) {
    return this.treasury.sweepHotWallet(ctx.userId);
  }

  /** §15 — fetch the unsigned tx body for a multisig action so the board
   *  member can sign it with their HW wallet via CIP-30 signTx. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Get('admin/board-actions/:id/tx-body')
  txBody(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcast.prepareTxBody(id);
  }

  /** §15 — submit a board member's vkey witness for a multisig action. When
   *  all N (every board member's) witnesses are collected, the platform
   *  combines them with the native script, submits via Koios, and marks the
   *  action CONFIRMED with the on-chain tx hash. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/board-actions/:id/witness')
  witness(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitWitnessDto) {
    return this.broadcast.submitWitness(id, dto.witnessHex, ctx.userId);
  }

  /** Hot-wallet policy (low threshold, top-up cap) used by the form UI. */
  @UseGuards(JwtAuthGuard)
  @Get('dao/treasury/hot-wallet-policy')
  hotWalletPolicy() {
    return this.treasury.hotWalletPolicy();
  }

  /** §15.3 — merged hot-wallet TX history (top-ups + sweeps). Visible to any
   *  logged-in user; the treasury balances are public anyway. */
  @UseGuards(JwtAuthGuard)
  @Get('dao/treasury/hot-wallet-history')
  hotWalletHistory() {
    return this.treasury.hotWalletHistory();
  }

  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/board-actions/:id/approve')
  approve(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveActionDto) {
    return this.treasury.approve(ctx.userId, id, dto);
  }

  /** §15.4 — any single board member can cancel a pending multisig action. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/board-actions/:id/cancel')
  cancel(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelActionDto) {
    return this.treasury.cancelBoardAction(ctx.userId, id, dto.reason);
  }

  /** §11/§15 — after the board broadcasts the assembled multisig tx, paste
   *  the on-chain tx hash here to verify + stamp the action CONFIRMED. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/board-actions/:id/payout-tx')
  payoutTx(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitPayoutTxDto) {
    return this.treasury.submitPayoutTxHash(ctx.userId, id, dto.txHash);
  }
}
