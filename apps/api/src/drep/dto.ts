import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class DrepApplicationDto {
  /** On-chain DRep ID (drep1...) — CIP-95 auto-detected or manually entered. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  drepIdOnchain!: string;

  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
  @IsOptional() @IsString() @MaxLength(5000) bio?: string;
  @IsOptional() @IsObject() socials?: Record<string, unknown>;
  @IsOptional() @IsObject() contact?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
  @IsOptional() @IsBoolean() kycOptin?: boolean;
  @IsOptional() @IsBoolean() callsOptin?: boolean;
  @IsOptional() @IsBoolean() admissionCallOptin?: boolean;
}

export class UpdateDrepDto {
  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
  @IsOptional() @IsString() @MaxLength(5000) bio?: string;
  @IsOptional() @IsObject() socials?: Record<string, unknown>;
  @IsOptional() @IsObject() contact?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
  @IsOptional() @IsBoolean() kycOptin?: boolean;
  @IsOptional() @IsBoolean() callsOptin?: boolean;
  @IsOptional() @IsBoolean() admissionCallOptin?: boolean;
}

export class AdmissionVoteDto {
  @IsIn(['YES', 'NO'])
  choice!: 'YES' | 'NO';

  /** Required for NO (§14.2). */
  @IsOptional() @IsString() @MaxLength(2000) feedback?: string;
}
