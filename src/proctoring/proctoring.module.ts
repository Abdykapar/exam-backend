import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ExamViolation,
  ExamViolationSchema,
} from './schemas/exam-violation.schema.js';
import { Attempt, AttemptSchema } from '../attempts/schemas/attempt.schema.js';
import { ExamsModule } from '../exams/exams.module.js';
import { ProctoringController } from './proctoring.controller.js';
import { ProctoringService } from './proctoring.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExamViolation.name, schema: ExamViolationSchema },
      { name: Attempt.name, schema: AttemptSchema },
    ]),
    ExamsModule,
  ],
  controllers: [ProctoringController],
  providers: [ProctoringService],
  exports: [ProctoringService],
})
export class ProctoringModule {}
