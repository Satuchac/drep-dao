import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { BoardMultisigService } from './board-multisig.service';

export class SubmitMultisigKeyDto {
  @IsString() @MaxLength(200) paymentBech32!: string;
  @IsBoolean() hardwareAttested!: boolean;
  @IsString() @MaxLength(8000) signature!: string;
  @IsString() @MaxLength(8000) key!: string;
  @IsString() @MaxLength(40) ts!: string;
}

@Controller()
export class BoardMultisigController {
  constructor(private readonly multisig: BoardMultisigService) {}

  /** Public — drives the Treasury "Multisig setup" panel + each board
   *  member's Actions card. Anyone can see status; only board members can
   *  submit. */
  @UseGuards(JwtAuthGuard)
  @Get('dao/multisig/status')
  status() {
    return this.multisig.status();
  }

  /** §15 — board member submits their multisig signing key. Server verifies
   *  the CIP-30 signature proves possession of that key, then auto-assembles
   *  the script + derives the address once all seats have submitted. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/multisig/key')
  submit(@CurrentUser() ctx: AuthContext, @Body() dto: SubmitMultisigKeyDto) {
    return this.multisig.submitKey(ctx.userId, dto);
  }
}
