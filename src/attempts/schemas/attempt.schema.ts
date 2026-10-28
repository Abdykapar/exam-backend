import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  Question,
  QuestionSchema,
} from '../../exams/schemas/question.schema.js';

@Schema({ _id: false })
export class AttemptAnswer {
  @Prop({ required: true }) questionIndex: number; // index in attempt.questions
  @Prop({ type: Number, default: null }) selectedIndex: number | null;
  @Prop({ type: [Number], default: [] }) selectedIndexes: number[];
  @Prop({ default: false }) isFlagged: boolean;
}
const AttemptAnswerSchema = SchemaFactory.createForClass(AttemptAnswer);

export enum AttemptStatus {
  InProgress = 'in_progress',
  Submitted = 'submitted',
  TimedOut = 'timed_out',
}

@Schema({ timestamps: true })
export class Attempt {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Exam',
    required: true,
    index: true,
  })
  exam: Types.ObjectId;

  // Snapshot, taken at start
  @Prop({ required: true }) examTitle: string;
  @Prop() examEmoji: string;
  @Prop({ required: true }) passingScore: number;
  @Prop({ required: true }) duration: number;
  @Prop({ type: [QuestionSchema], default: [] }) questions: Question[];

  // Progress
  @Prop({ type: [AttemptAnswerSchema], default: [] }) answers: AttemptAnswer[];
  @Prop({
    type: String,
    enum: AttemptStatus,
    default: AttemptStatus.InProgress,
    index: true,
  })
  status: AttemptStatus;
  @Prop({ required: true }) startedAt: Date;
  @Prop({ required: true }) expiresAt: Date;
  @Prop() submittedAt?: Date;

  // Result
  @Prop({ default: 0 }) score: number;
  @Prop({ default: 0 }) correctCount: number;
  @Prop({ default: 0 }) totalQuestions: number;
  @Prop({ default: false }) passed: boolean;
  @Prop({ default: 0 }) timeTakenSeconds: number;
  @Prop({ default: false }) certificateIssued: boolean;
}

export type AttemptDocument = HydratedDocument<Attempt>;
export const AttemptSchema = SchemaFactory.createForClass(Attempt);
