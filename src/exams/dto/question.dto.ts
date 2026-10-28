import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from '../schemas/question.schema.js';

export class QuestionDto {
  // No default here: PartialType copies initializers, which would reset `type` on every update
  @IsOptional() @IsEnum(QuestionType) type?: QuestionType;
  @IsString() @MaxLength(2000) text: string;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  options: string[];
  @IsOptional() @IsInt() @Min(0) correctIndex?: number;
  @IsOptional() @IsArray() @IsInt({ each: true }) correctIndexes?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(100) points?: number;
  @IsOptional() @IsString() @MaxLength(2000) explanation?: string;
}

export class UpdateQuestionDto extends PartialType(QuestionDto) {}

export class ReorderQuestionsDto {
  @IsArray() @IsMongoId({ each: true }) order: string[];
}

export class BulkQuestionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions: QuestionDto[];
}
