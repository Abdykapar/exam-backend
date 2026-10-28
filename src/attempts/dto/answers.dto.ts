import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
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
