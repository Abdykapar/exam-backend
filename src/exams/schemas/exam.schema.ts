import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Question, QuestionSchema } from './question.schema.js';

export const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'] as const;

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
  @Prop({ required: true }) duration: number; // minutes
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
  @Prop({ default: false, index: true }) isPublished: boolean;
  @Prop({ default: 0 }) enrolledCount: number;
  @Prop({ default: 0 }) rating: number;
}

export type ExamDocument = HydratedDocument<Exam>;
export const ExamSchema = SchemaFactory.createForClass(Exam);
