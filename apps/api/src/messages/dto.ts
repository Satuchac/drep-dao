import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class MessageBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(10000) body!: string;
}

export class QuickPollVoteDto {
  @IsUUID() choice!: string;
}
