import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// MVP: GRANT only (RFP deferred, §28.2). MVP schedule uses coarse operational
// windows rather than the 9 fine-grained sub-periods in §6.
export const ROUND_STAGE_KEYS = ['submission', 'filtering', 'debate_vote', 'funding'] as const;

export class CategoryInput {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsIn(['GRANT']) type?: 'GRANT';
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) conditions?: string;
  @IsInt() @Min(0) allocatedAda!: number; // ADA
  @IsOptional() @IsInt() @Min(0) minAda?: number;
  @IsOptional() @IsInt() @Min(0) maxAda?: number;
}

export class ScheduleInput {
  @IsIn(ROUND_STAGE_KEYS) stageKey!: (typeof ROUND_STAGE_KEYS)[number];
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
}

export class CreateRoundDto {
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

export class UpdateRoundDto {
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
