import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum QuestionType {
  Single = 'single',
  Multiple = 'multiple',
}

@Schema()
export class Question {
  _id: Types.ObjectId;
  @Prop({ type: String, enum: QuestionType, default: QuestionType.Single })
  type: QuestionType;
  @Prop({ required: true }) text: string;
  @Prop({ type: [String], required: true }) options: string[];
  @Prop() correctIndex?: number; // single
  @Prop({ type: [Number], default: undefined }) correctIndexes?: number[]; // multiple
  @Prop({ default: 1 }) points: number;
  @Prop() explanation?: string;
}

export const QuestionSchema = SchemaFactory.createForClass(Question);

export type QuestionFields = Pick<
  Question,
  'text' | 'options' | 'correctIndex' | 'correctIndexes'
> & { type?: QuestionType };

/** Returns an error message, or null when the question is valid. Used by add/update/bulk/publish. */
export function questionError(q: QuestionFields): string | null {
  if (!q.text?.trim()) return 'Question text is required';
  if (!q.options || q.options.length < 2 || q.options.length > 6) {
    return 'A question needs 2–6 options';
  }
  if (q.options.some((o) => !o.trim())) return 'Options cannot be empty';
  const inRange = (i: number) =>
    Number.isInteger(i) && i >= 0 && i < q.options.length;
  if (q.type === QuestionType.Multiple) {
    if (!q.correctIndexes?.length || !q.correctIndexes.every(inRange)) {
      return 'Mark at least one correct option';
    }
  } else if (q.correctIndex == null || !inRange(q.correctIndex)) {
    return 'Mark the correct option';
  }
  return null;
}
