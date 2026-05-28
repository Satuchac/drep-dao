import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { ProposalsService } from './proposals.service';
import { BudgetChangeDto, CreateProposalDto, PledgeTxHashDto, SubmitProposalDto, UpdateProposalDto } from './dto';

@Controller()
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  // ---- public read (§26.2) ----
  @Get('rounds/:roundId/proposals')
  byRound(@Param('roundId', ParseUUIDPipe) roundId: string, @Query('status') status?: string) {
    return this.proposals.listByRound(roundId, status);
  }

  // Public, but the owner may read their own private DRAFT/PENDING (optional auth).
  @UseGuards(OptionalJwtAuthGuard)
  @Get('proposals/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() ctx?: AuthContext) {
    return this.proposals.get(id, ctx?.userId);
  }

  // §7/§8 — content version history (snapshots + current) for the diff view.
  @Get('proposals/:id/versions')
  versions(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.versions(id);
  }

  // ---- submitter (§26.3) ----
  @UseGuards(JwtAuthGuard)
  @Get('me/proposals')
  mine(@CurrentUser() ctx: AuthContext) {
    return this.proposals.listMine(ctx.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('proposals')
  create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateProposalDto) {
    return this.proposals.createDraft(ctx.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('proposals/:id')
  update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProposalDto) {
    return this.proposals.updateDraft(ctx.userId, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/submit')
  submit(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitProposalDto) {
    return this.proposals.submit(ctx.userId, id, dto);
  }

  // §12 — submitter changes an ACTIVE proposal's budget (creates a fee top-up/refund task).
  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/budget-change')
  budgetChange(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BudgetChangeDto) {
    return this.proposals.requestBudgetChange(ctx.userId, id, dto);
  }

  // §3 — submitter pastes the on-chain pledge payment tx hash (FUNDING + promised pledge).
  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/pledge-tx')
  pledgeTx(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PledgeTxHashDto) {
    return this.proposals.submitPledgeTxHash(ctx.userId, id, dto.txHash);
  }
}
