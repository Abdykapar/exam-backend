import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DIFFICULTIES } from '../schemas/exam.schema.js';

/** All fields are required so a PATCH replaces the whole setting consistently. */
export class ProctoringDto {
  @IsBoolean() enabled: boolean;
  @IsInt() @Min(1) @Max(20) maxViolations: number;
  @IsBoolean() requireFullscreen: boolean;
}

export class CreateExamDto {
  @IsString() @Length(3, 120) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsMongoId() category: string;
  @IsIn(DIFFICULTIES) difficulty: string;
  @IsInt() @Min(1) @Max(600) duration: number;
  @IsInt() @Min(0) @Max(100) passingScore: number;
  @IsOptional() @IsString() @MaxLength(8) emoji?: string;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
  @IsOptional() @IsBoolean() shuffleQuestions?: boolean;
  @IsOptional() @IsBoolean() shuffleOptions?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) maxAttempts?: number;
  @IsOptional() @IsBoolean() perQuestionTiming?: boolean;
  /** Empty string removes the password. */
  @IsOptional() @IsString() @MaxLength(64) accessPassword?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => ProctoringDto)
  proctoring?: ProctoringDto;
}

export class UpdateExamDto extends PartialType(CreateExamDto) {}

export class ListExamsQueryDto {
  @IsOptional() @IsString() category?: string; // category slug
  @IsOptional() @IsIn(DIFFICULTIES) difficulty?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}
