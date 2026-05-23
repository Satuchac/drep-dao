import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { CommentsService } from './comments.service';

export class CreateCommentDto {
  @IsString() @MinLength(1) @MaxLength(5000) contentMd!: string;
  @IsOptional() @IsUUID() parentId?: string;
}
export class EditCommentDto {
  @IsString() @MinLength(1) @MaxLength(5000) contentMd!: string;
}

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  // Public read (§20.1 — visible to everyone).
  @Get('proposals/:id/comments')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.comments.list(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/comments')
  create(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCommentDto) {
    return this.comments.create(ctx.userId, id, dto.contentMd, dto.parentId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('comments/:id')
  edit(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditCommentDto) {
    return this.comments.edit(ctx.userId, id, dto.contentMd);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('comments/:id')
  remove(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.comments.remove(ctx.userId, id);
  }
}
