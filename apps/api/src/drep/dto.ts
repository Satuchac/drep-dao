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

export class ApproveExpertDto {
  @IsString() @IsNotEmpty() @MaxLength(200) stakeAddress!: string;
  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
}

export class DrepApplicationDto {
  // The on-chain DRep ID is NOT accepted from the client: it's derived from the
  // wallet's CIP-95 DRep key (captured at login) and verified on-chain.
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
