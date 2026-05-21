import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class MilestoneInput {
  @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;
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
