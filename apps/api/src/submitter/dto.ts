import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitterApplicationDto {
  @IsString() @IsNotEmpty() @MaxLength(120) displayName!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) description!: string;
  @IsOptional() @IsString() @MaxLength(500) githubUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(500, { each: true }) socialLinks?: string[];
  @IsOptional() @IsString() @MaxLength(400000) logoDataUrl?: string; // base64 data URL
  @IsString() @IsNotEmpty() @MaxLength(100) country!: string;
}

export class RejectSubmitterDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
}
