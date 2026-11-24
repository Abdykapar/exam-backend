import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AnswerDto {
  @IsInt() @Min(0) questionIndex: number;
  @IsOptional() @IsInt() @Min(0) selectedIndex?: number | null;
  @IsOptional() @IsArray() @IsInt({ each: true }) selectedIndexes?: number[];
  @IsOptional() @IsBoolean() isFlagged?: boolean;
}

export class SaveAnswersDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[];
}

export class SubmitAttemptDto extends SaveAnswersDto {
  @IsOptional() @IsBoolean() timedOut?: boolean;
}

/** Per-question timing: finish question `index` and move to the next one. */
export class NextQuestionDto extends SaveAnswersDto {
  @IsInt() @Min(0) index: number;
}

export class StartAttemptDto {
  @IsOptional() @IsString() @MaxLength(64) password?: string;
}

/** Guest entry to a password-protected exam, from a shared link. */
export class JoinExamDto {
  @IsString() @Length(1, 50) firstName: string;
  @IsString() @Length(1, 50) lastName: string;
  @IsString() @MaxLength(64) password: string;
}
