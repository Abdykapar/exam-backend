import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Exam, ExamSchema } from './schemas/exam.schema.js';
import {
  Category,
  CategorySchema,
} from '../categories/schemas/category.schema.js';
import {
  Attempt,
  AttemptSchema,
} from '../attempts/schemas/attempt.schema.js';
import { ExamsController } from './exams.controller.js';
import { QuestionsController } from './questions.controller.js';
import { ExamsService } from './exams.service.js';
import { QuestionsService } from './questions.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Exam.name, schema: ExamSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Attempt.name, schema: AttemptSchema },
    ]),
  ],
  controllers: [ExamsController, QuestionsController],
  providers: [ExamsService, QuestionsService],
  exports: [MongooseModule],
})
export class ExamsModule {}
