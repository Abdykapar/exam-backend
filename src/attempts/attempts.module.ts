import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Attempt, AttemptSchema } from './schemas/attempt.schema.js';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema.js';
import { AttemptsController } from './attempts.controller.js';
import { AttemptsService } from './attempts.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attempt.name, schema: AttemptSchema },
      { name: Exam.name, schema: ExamSchema },
    ]),
  ],
  controllers: [AttemptsController],
  providers: [AttemptsService],
  exports: [MongooseModule],
})
export class AttemptsModule {}
