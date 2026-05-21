import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

export class AdminLoginDto {
  @IsString() @IsNotEmpty() @MaxLength(100) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) password!: string;
}

export class Admin2faDto {
  @IsString() @IsNotEmpty() @MaxLength(100) pendingToken!: string;
  @IsString() @IsNotEmpty() @MaxLength(20) code!: string;
}

export class GenesisUploadDto {
  /** Parsed genesis.json contents. Validated structurally in GenesisService. */
  @IsObject()
  genesis!: Record<string, unknown>;
}

export class AdminInviteDto {
  @IsString() @IsNotEmpty() @MaxLength(100) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) email!: string;
}

export class AcceptInviteDto {
  @IsString() @IsNotEmpty() @MaxLength(200) token!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) password!: string;
}
