import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const INTERNAL_TYPES = ['INSTRUCTIVE', 'INFORMATIVE', 'POLL'];
const SCOPES = ['DREPS_ONLY', 'BOARD_ONLY', 'BOTH'];
const THRESHOLDS = ['DEFAULT', 'IMPORTANT'];
const VOTING_TYPES = ['ONE_PERSON_ONE_VOTE', 'BALANCED'];

/** §10.1 — submit an internal proposal (goes straight to ACTIVE; voting opens immediately). */
export class CreateInternalProposalDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) contentMd!: string; // always present, even for polls

  @IsIn(INTERNAL_TYPES) internalType!: string;
  @IsIn(SCOPES) votersScope!: string;
  @IsIn(THRESHOLDS) thresholdKind!: string;
  @IsIn(VOTING_TYPES) votingType!: string;

  @IsInt() @Min(1) @Max(365) votingPeriodDays!: number;

  // PRIVATE → visible + votable to board members only (forces BOARD_ONLY scope).
  @IsOptional() @IsBoolean() isPrivate?: boolean;

  // POLL only: the choices + whether voters may pick more than one.
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMinSize(2) pollOptions?: string[];
  @IsOptional() @IsBoolean() pollMultiple?: boolean;

  // INSTRUCTIVE only: who is expected to act if approved + the target delivery date.
  @IsOptional() @IsArray() @IsString({ each: true }) actors?: string[];
  @IsOptional() @IsISO8601() deliveryDate?: string;
}

/** Cast or change a vote. Threshold proposals use `choice`; polls use `options`. */
export class VoteInternalDto {
  @IsOptional() @IsIn(['YES', 'NO', 'ABSTAIN']) choice?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsString() @MaxLength(4000) rationale?: string;
}

/** §10 — the submitter may move the voting end (extend/shorten) while ACTIVE; never the content. */
export class ExtendInternalDto {
  @IsISO8601() votingEndAt!: string;
}
