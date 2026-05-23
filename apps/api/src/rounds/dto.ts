import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CategoryType } from '@drep-dao/shared';

/** §6 — per-round overrides of platform defaults (omit to use the global value). */
export class RoundSettingsInput {
  @IsOptional() @IsInt() @Min(1) filterReviewerCount?: number;
  @IsOptional() @IsInt() @Min(1) filterApprovalVotes?: number;
  @IsOptional() @IsInt() @Min(1) milestoneReviewerCount?: number;
  @IsOptional() @IsInt() @Min(1) milestoneApprovalVotes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) dvApprovalThresholdPct?: number;
}

// MVP schedule uses coarse operational windows rather than the 9 fine-grained
// sub-periods in §6. Categories may be GRANT or RFP (§5.2).
export const ROUND_STAGE_KEYS = ['submission', 'filtering', 'debate_vote', 'funding'] as const;
const CATEGORY_TYPES = Object.values(CategoryType) as string[]; // ['GRANT','RFP']

export class CategoryInput {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsIn(CATEGORY_TYPES) type?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) conditions?: string;
  @IsInt() @Min(0) allocatedAda!: number; // ADA
  @IsOptional() @IsInt() @Min(0) minAda?: number;
  @IsOptional() @IsInt() @Min(0) maxAda?: number;
}

/** §8 — board confirms entering the next stage: auto at the date, or manual launch. */
export class ConfirmStageDto {
  @IsBoolean() autoStart!: boolean;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
}

export class ScheduleInput {
  @IsIn(ROUND_STAGE_KEYS) stageKey!: (typeof ROUND_STAGE_KEYS)[number];
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
}

export class CreateRoundDto extends RoundSettingsInput {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsInt() @Min(0) budgetAda!: number; // ADA
  @IsInt() @Min(0) rewardsPoolAda!: number; // ADA
  @IsOptional() @IsString() @MaxLength(200) multisigAddress?: string;
  @IsOptional() @IsString() @MaxLength(120) intersectTxHash?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CategoryInput)
  categories!: CategoryInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleInput)
  schedule?: ScheduleInput[];

  /** Defaults to all admitted DReps if omitted. */
  @IsOptional() @IsArray() @IsString({ each: true }) eligibleDrepIds?: string[];
}

export class UpdateRoundDto extends RoundSettingsInput {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(0) budgetAda?: number;
  @IsOptional() @IsInt() @Min(0) rewardsPoolAda?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CategoryInput)
  categories?: CategoryInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleInput)
  schedule?: ScheduleInput[];

  @IsOptional() @IsArray() @IsString({ each: true }) eligibleDrepIds?: string[];
}
