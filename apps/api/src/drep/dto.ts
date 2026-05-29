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
  // Profile photo as a data URL ("data:image/png;base64,…"). Capped at ~360k chars
  // ≈ 256 KB binary — enough for a small avatar, small enough to keep in Postgres.
  // Empty string clears the photo (falls back to the on-chain CIP-119 image).
  @IsOptional() @IsString() @MaxLength(360_000) photo?: string;
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

  /** §C — CIP-30 signData over the canonical vote message (free, no tx). Optional. */
  @IsOptional() @IsString() @MaxLength(8000) signature?: string;
  @IsOptional() @IsString() @MaxLength(8000) signingKey?: string;
  @IsOptional() @IsString() @MaxLength(40) ts?: string;
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
