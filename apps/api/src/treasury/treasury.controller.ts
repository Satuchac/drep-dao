import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { TreasuryService } from './treasury.service';
import { MultisigService } from './multisig.service';

export class PrepareTopUpDto {
  @IsNumber() @Min(1) amountAda!: number;
}
export class ApproveActionDto {
  @IsOptional() @IsString() @MaxLength(8000) signature?: string;
  @IsOptional() @IsString() @MaxLength(8000) signingKey?: string;
  @IsOptional() @IsString() @MaxLength(40) ts?: string;
}
export class RegisterSigningKeyDto {
  @IsString() @Matches(/^[0-9a-fA-F]{56}$/, { message: 'expected a 28-byte (56-hex) payment key hash' }) keyHash!: string;
}
export class SubmitWitnessDto {
  @IsString() @MaxLength(20000) witnessSet!: string; // hex TransactionWitnessSet from wallet signTx
}

// §15 Treasury overview + board actions (prepare/approve multisig spends).
@Controller()
export class TreasuryController {
  constructor(
    private readonly treasury: TreasuryService,
    private readonly multisig: MultisigService,
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

  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/board-actions/:id/approve')
  approve(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveActionDto) {
    return this.treasury.approve(ctx.userId, id, dto);
  }

  // --- §15 native-script (3-of-5) treasury policy + real on-chain broadcast ---

  /** A board member registers the payment key hash their wallet signs spends with. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('me/treasury/signing-key')
  registerSigningKey(@CurrentUser() ctx: AuthContext, @Body() dto: RegisterSigningKeyDto) {
    return this.multisig.registerSigningKey(ctx.userId, dto.keyHash);
  }

  /** Policy setup status: which board members registered + the confirmed policy. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Get('admin/treasury/policy')
  policyStatus() {
    return this.multisig.policyStatus();
  }

  /** Assemble the 3-of-5 native script from registered keys and confirm it. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/treasury/policy/confirm')
  confirmPolicy(@CurrentUser() ctx: AuthContext) {
    return this.multisig.assembleAndConfirm(ctx.userId);
  }

  /** The unsigned spend tx (hex) a board wallet signs for this action. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Get('admin/board-actions/:id/tx')
  actionTx(@Param('id', ParseUUIDPipe) id: string) {
    return this.multisig.actionTxToSign(id);
  }

  /** A board member submits their wallet's signTx witness set (3-of-5 → broadcast). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/board-actions/:id/sign')
  signAction(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitWitnessDto) {
    return this.multisig.submitWitness(ctx.userId, id, dto.witnessSet);
  }

  /** Retry the on-chain submit for an action that assembled but failed to broadcast (READY). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/board-actions/:id/broadcast')
  broadcast(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.multisig.retryBroadcast(ctx.userId, id);
  }
}
