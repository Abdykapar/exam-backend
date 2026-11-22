import {
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  CLIENT_VIOLATION_TYPES,
  type ViolationType,
} from '../schemas/exam-violation.schema.js';

export class ReportViolationDto {
  @IsMongoId() attemptId: string;
  @IsIn(CLIENT_VIOLATION_TYPES) type: ViolationType;
  @IsISO8601() at: string;
  @IsOptional() @IsInt() @Min(0) @Max(86_400_000) durationMs?: number;
}

export class HeartbeatDto {
  @IsMongoId() attemptId: string;
}
