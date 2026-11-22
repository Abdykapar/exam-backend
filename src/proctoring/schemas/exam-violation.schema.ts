import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/** Leaving the exam: these count toward the auto-submit limit. */
export const COUNTED_VIOLATIONS = [
  'tab_hidden', // visibilitychange: tab switch or minimize
  'window_blur', // another app, second monitor, devtools
  'fullscreen_exit',
  'multiple_monitors',
  'print_screen', // can't be blocked: the OS has already taken the screenshot
  'heartbeat_missed', // server-only: the page stopped pinging (JS disabled, tab killed)
] as const;

/** Blocked in the browser, so nothing leaked: logged for the teacher but not counted. */
export const BLOCKED_VIOLATIONS = [
  'copy',
  'cut',
  'paste',
  'context_menu',
  'blocked_shortcut',
  'devtools_shortcut',
] as const;

export type ViolationType =
  | (typeof COUNTED_VIOLATIONS)[number]
  | (typeof BLOCKED_VIOLATIONS)[number];

/** Everything except what only the server may log. */
export const CLIENT_VIOLATION_TYPES: ViolationType[] = [
  ...COUNTED_VIOLATIONS.filter((t) => t !== 'heartbeat_missed'),
  ...BLOCKED_VIOLATIONS,
];

export const isCounted = (t: ViolationType) =>
  (COUNTED_VIOLATIONS as readonly string[]).includes(t);

@Schema({ collection: 'exam_violations', versionKey: false })
export class ExamViolation {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Attempt',
    required: true,
    index: true,
  })
  attempt: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Exam',
    required: true,
    index: true,
  })
  exam: Types.ObjectId;
  @Prop({ type: String, required: true }) type: ViolationType;
  @Prop({ required: true }) counted: boolean;
  @Prop({ required: true }) clientAt: Date; // the student's clock, for reference only
  @Prop({ required: true }) serverAt: Date;
  @Prop() durationMs?: number;
  @Prop() ip?: string;
  @Prop() userAgent?: string;
}

export type ExamViolationDocument = HydratedDocument<ExamViolation>;
export const ExamViolationSchema = SchemaFactory.createForClass(ExamViolation);
ExamViolationSchema.index({ attempt: 1, serverAt: 1 });
