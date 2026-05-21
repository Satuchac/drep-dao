import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { RoundsService } from './rounds.service';
import { CreateRoundDto, UpdateRoundDto } from './dto';

// §26.5 — board-only round configuration (Round Preparation, §6).
@Controller('admin/rounds')
@UseGuards(JwtAuthGuard, BoardGuard)
export class AdminRoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Post()
  create(@Body() dto: CreateRoundDto) {
    return this.rounds.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoundDto) {
    return this.rounds.update(id, dto);
  }

  @Post(':id/start-stage/:stage')
  startStage(@Param('id', ParseUUIDPipe) id: string, @Param('stage') stage: string) {
    return this.rounds.startStage(id, stage);
  }
}
