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

// §2/§14 — an ADA holder applies to become an Expert; the board then approves.
export class ExpertApplicationDto {
  @IsString() @IsNotEmpty() @MaxLength(100) displayName!: string;
  @IsOptional() @IsString() @MaxLength(5000) bio?: string;
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

  /** Written rationale — required for BOTH YES and NO (board accountability). */
  @IsString() @IsNotEmpty() @MaxLength(2000) feedback!: string;
}

// §14.4 — board proposes / votes to remove a DAO member.
export class ProposeRemovalDto {
  @IsString() @IsNotEmpty() @MaxLength(100) targetDrepId!: string;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class RemovalVoteDto {
  @IsIn(['YES', 'NO'])
  choice!: 'YES' | 'NO';

  @IsString() @IsNotEmpty() @MaxLength(2000) rationale!: string;
}
