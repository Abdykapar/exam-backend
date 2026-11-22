import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  Question,
  QuestionSchema,
} from '../../exams/schemas/question.schema.js';

/** Must match the answer-sheet layout in exam-omr (app/layout.py). */
export const OFFLINE_LIMITS = {
  maxQuestions: 90,
  maxOptions: 6,
  maxVariants: 4,
} as const;

export const VARIANT_LETTERS = ['A', 'B', 'C', 'D'];

@Schema({ _id: false })
export class SessionVariant {
  @Prop({ required: true }) letter: string;
  @Prop({ type: [QuestionSchema], default: [] }) questions: Question[];
}
const SessionVariantSchema = SchemaFactory.createForClass(SessionVariant);

@Schema({ timestamps: true })
export class OfflineSession {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Exam',
    required: true,
    index: true,
  })
  exam: Types.ObjectId;
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  createdBy: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop() date?: Date;

  // Snapshot, taken at creation: later edits to the exam don't change printed sheets
  @Prop({ required: true }) examTitle: string;
  @Prop() examEmoji: string;
  @Prop({ required: true }) passingScore: number;
  @Prop({ required: true }) duration: number;
  @Prop({ type: [SessionVariantSchema], default: [] })
  variants: SessionVariant[];

  @Prop({ default: 1 }) nextSheetNumber: number;
}

export type OfflineSessionDocument = HydratedDocument<OfflineSession>;
export const OfflineSessionSchema = SchemaFactory.createForClass(OfflineSession);
