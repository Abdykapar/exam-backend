import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  AttemptAnswer,
  AttemptAnswerSchema,
} from '../../attempts/schemas/attempt.schema.js';

export enum SheetSource {
  Manual = 'manual',
  Scan = 'scan',
}

export enum SheetStatus {
  Graded = 'graded',
  NeedsReview = 'needs_review',
}

/** One student's filled-in answer sheet. Students are anonymous: they only write a name. */
@Schema({ timestamps: true })
export class OfflineSheet {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'OfflineSession',
    required: true,
  })
  session: Types.ObjectId;
  @Prop({ required: true }) number: number;
  @Prop({ required: true }) variant: string;
  @Prop({ default: '', trim: true }) studentName: string;
  @Prop({ type: [AttemptAnswerSchema], default: [] }) answers: AttemptAnswer[];

  @Prop({ default: 0 }) score: number;
  @Prop({ default: 0 }) correctCount: number;
  @Prop({ default: 0 }) totalQuestions: number;
  @Prop({ default: false }) passed: boolean;

  @Prop({ type: String, enum: SheetSource, default: SheetSource.Manual })
  source: SheetSource;
  @Prop({ type: String, enum: SheetStatus, default: SheetStatus.Graded })
  status: SheetStatus;
}

export type OfflineSheetDocument = HydratedDocument<OfflineSheet>;
export const OfflineSheetSchema = SchemaFactory.createForClass(OfflineSheet);
OfflineSheetSchema.index({ session: 1, number: 1 }, { unique: true });
