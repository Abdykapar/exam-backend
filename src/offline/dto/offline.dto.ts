import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
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
import { AnswerDto } from '../../attempts/dto/answers.dto.js';
import {
  OFFLINE_LIMITS,
  VARIANT_LETTERS,
} from '../schemas/offline-session.schema.js';

export class CreateOfflineSessionDto {
  @IsMongoId() exam: string;
  @IsString() @Length(1, 120) name: string;
  @IsOptional() @IsDateString() date?: string;
  @IsInt() @Min(1) @Max(OFFLINE_LIMITS.maxVariants) variants: number;
}

export class ListOfflineSessionsQueryDto {
  @IsOptional() @IsMongoId() exam?: string;
}

export class CreateSheetDto {
  @IsIn(VARIANT_LETTERS) variant: string;
  @IsOptional() @IsString() @MaxLength(120) studentName?: string;
  @IsArray()
  @ArrayMaxSize(OFFLINE_LIMITS.maxQuestions)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[];
}

export class UpdateSheetDto {
  @IsOptional() @IsIn(VARIANT_LETTERS) variant?: string;
  @IsOptional() @IsString() @MaxLength(120) studentName?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(OFFLINE_LIMITS.maxQuestions)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers?: AnswerDto[];
}

export const PDF_KINDS = ['answer-sheet', 'booklet', 'answer-key'] as const;
export type PdfKind = (typeof PDF_KINDS)[number];

export class PdfQueryDto {
  @IsOptional() @IsIn(VARIANT_LETTERS) variant?: string;
}
