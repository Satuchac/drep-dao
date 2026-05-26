import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MilestoneInput {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;
  @IsOptional() @IsString() @MaxLength(5000) acceptanceCriteria?: string;
  @IsInt() @Min(0) amountAda!: number; // ADA
  @IsOptional() @IsInt() @Min(0) deadlineDays?: number;
}

export class CreateProposalDto {
  @IsUUID() roundId!: string;
  @IsUUID() categoryId!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(50000) contentMd!: string;
  @IsBoolean() isCommercial!: boolean;
  @IsInt() @Min(1) requestedAmountAda!: number; // ADA
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
  @IsOptional() @IsString() @MaxLength(20000) costBreakdownMd?: string;
  @IsOptional() @IsString() @MaxLength(20000) teamInfoMd?: string; // §3.4
  @IsOptional() @IsString() @MaxLength(20000) revenueSharingMd?: string; // §3.4 (commercial)

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MilestoneInput)
  milestones!: MilestoneInput[];
}

export class UpdateProposalDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(50000) contentMd?: string;
  @IsOptional() @IsBoolean() isCommercial?: boolean;
  @IsOptional() @IsInt() @Min(1) requestedAmountAda?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
  @IsOptional() @IsString() @MaxLength(20000) costBreakdownMd?: string;
  @IsOptional() @IsString() @MaxLength(20000) teamInfoMd?: string;
  @IsOptional() @IsString() @MaxLength(20000) revenueSharingMd?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MilestoneInput)
  milestones?: MilestoneInput[];
}

export class SubmitProposalDto {
  @IsString() @IsNotEmpty() @MaxLength(120) submissionFeeTxHash!: string;
}

export class FilterVoteDto {
  @IsIn(['YES', 'NO', 'ABSTAIN']) choice!: 'YES' | 'NO' | 'ABSTAIN';
  @IsOptional() @IsString() @MaxLength(5000) rationale?: string;
}

export class DvVoteDto {
  @IsIn(['YES', 'NO', 'ABSTAIN']) choice!: 'YES' | 'NO' | 'ABSTAIN';
  // §8.2 — rationale mandatory (min 200 chars) for any cast D&V vote.
  @IsString() @MinLength(200) @MaxLength(10000) rationale!: string;
}
