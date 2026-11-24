import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Question, QuestionSchema } from './question.schema.js';

export const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'] as const;

/** Anti-cheating settings for online attempts. Off by default so existing exams are unaffected. */
@Schema({ _id: false })
export class ExamProctoring {
  @Prop({ default: false }) enabled: boolean;
  @Prop({ default: 3, min: 1, max: 20 }) maxViolations: number;
  @Prop({ default: true }) requireFullscreen: boolean;
}
export const ExamProctoringSchema = SchemaFactory.createForClass(ExamProctoring);

@Schema({ timestamps: true })
export class Exam {
  @Prop({ required: true, trim: true }) title: string;
  @Prop({ default: '' }) description: string;
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Category',
    required: true,
    index: true,
  })
  category: Types.ObjectId;
  @Prop({ type: String, enum: DIFFICULTIES, default: 'Beginner' })
  difficulty: string;
  @Prop({ required: true }) duration: number; // minutes; derived from question times when perQuestionTiming
  /** Each question gets its own countdown; students can't go back. */
  @Prop({ default: false }) perQuestionTiming: boolean;
  /** Non-empty = link-only exam: hidden from the catalog, joined with this password. */
  @Prop({ default: '' }) accessPassword: string;
  @Prop({ default: 70 }) passingScore: number; // percent
  @Prop({ type: [QuestionSchema], default: [] })
  questions: Types.DocumentArray<Question>;
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  instructor: Types.ObjectId;
  @Prop({ default: '📝' }) emoji: string;
  @Prop({ type: [String], default: [] }) tags: string[];
  @Prop({ default: false }) shuffleQuestions: boolean;
  @Prop({ default: false }) shuffleOptions: boolean;
  @Prop({ default: 0 }) maxAttempts: number; // 0 = unlimited
  @Prop({ type: ExamProctoringSchema, default: () => ({}) })
  proctoring: ExamProctoring;
  @Prop({ default: false, index: true }) isPublished: boolean;
  @Prop({ default: 0 }) enrolledCount: number;
  @Prop({ default: 0 }) rating: number;
}

/** Total of the question times, rounded up to whole minutes (at least 1). */
export function perQuestionDuration(questions: { timeLimit?: number }[]) {
  const seconds = questions.reduce((s, q) => s + (q.timeLimit ?? 60), 0);
  return Math.max(1, Math.ceil(seconds / 60));
}

export type ExamDocument = HydratedDocument<Exam>;
export const ExamSchema = SchemaFactory.createForClass(Exam);

// Keep the stored duration (shown on the exam page) equal to the sum of question times
ExamSchema.pre('validate', function () {
  if (this.perQuestionTiming) {
    this.duration = perQuestionDuration(this.questions);
  }
  this.accessPassword = (this.accessPassword ?? '').trim();
});
