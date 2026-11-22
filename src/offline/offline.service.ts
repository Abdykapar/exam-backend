import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  OFFLINE_LIMITS,
  OfflineSession,
  OfflineSessionDocument,
  VARIANT_LETTERS,
} from './schemas/offline-session.schema.js';
import {
  OfflineSheet,
  SheetStatus,
} from './schemas/offline-sheet.schema.js';
import {
  CreateOfflineSessionDto,
  CreateSheetDto,
  ListOfflineSessionsQueryDto,
  PDF_KINDS,
  PdfKind,
  UpdateSheetDto,
} from './dto/offline.dto.js';
import type { AnswerDto } from '../attempts/dto/answers.dto.js';
import { buildSnapshot, grade, sanitizeAnswers } from '../attempts/grading.js';
import { ExamsService } from '../exams/exams.service.js';
import {
  Question,
  QuestionType,
  questionError,
} from '../exams/schemas/question.schema.js';
import { OmrClient, RenderPayload } from './omr.client.js';
import { buildResultsCsv } from './results-csv.js';
import { slugify } from '../common/utils.js';
import { Role } from '../users/schemas/user.schema.js';
import type { JwtUser } from '../common/types.js';

interface SheetStats {
  sheetCount: number;
  avgScore: number;
  passedCount: number;
  reviewCount: number;
}

const NO_STATS: SheetStats = { sheetCount: 0, avgScore: 0, passedCount: 0, reviewCount: 0 };

@Injectable()
export class OfflineService {
  constructor(
    @InjectModel(OfflineSession.name) private sessions: Model<OfflineSession>,
    @InjectModel(OfflineSheet.name) private sheets: Model<OfflineSheet>,
    private exams: ExamsService,
    private omr: OmrClient,
  ) {}

  // ---------- sessions ----------

  async create(dto: CreateOfflineSessionDto, user: JwtUser) {
    const exam = await this.exams.getEditable(dto.exam, user);
    const questions = exam.questions.map((q) => q.toObject<Question>());
    if (!questions.length) {
      throw new BadRequestException('Add questions to the exam first');
    }
    if (questions.length > OFFLINE_LIMITS.maxQuestions) {
      throw new BadRequestException(
        `Answer sheets support up to ${OFFLINE_LIMITS.maxQuestions} questions; this exam has ${questions.length}`,
      );
    }
    questions.forEach((q, i) => {
      const err = questionError(q);
      if (err) throw new BadRequestException(`Question ${i + 1}: ${err}`);
    });

    // Version A keeps the exam's order; other versions shuffle questions and options
    const variants = VARIANT_LETTERS.slice(0, dto.variants).map((letter, i) => ({
      letter,
      questions: buildSnapshot(questions, { shuffleQuestions: i > 0, shuffleOptions: i > 0 }),
    }));

    const session = await this.sessions.create({
      exam: exam._id,
      createdBy: user.sub,
      name: dto.name,
      date: dto.date,
      examTitle: exam.title,
      examEmoji: exam.emoji,
      passingScore: exam.passingScore,
      duration: exam.duration,
      variants,
    });
    return { data: { session: { ...this.summary(session), ...NO_STATS } } };
  }

  async list(user: JwtUser, q: ListOfflineSessionsQueryDto) {
    const filter: Record<string, unknown> = user.role === Role.Admin ? {} : { createdBy: user.sub };
    if (q.exam) filter.exam = q.exam;
    const sessions = await this.sessions.find(filter).sort({ createdAt: -1 });
    const stats = await this.sheetStats(sessions.map((s) => s._id));
    return {
      data: {
        sessions: sessions.map((s) => ({ ...this.summary(s), ...(stats.get(s.id) ?? NO_STATS) })),
      },
    };
  }

  /** Full session including each version's answer key (teacher only). */
  async get(id: string, user: JwtUser) {
    const session = await this.getOwned(id, user);
    const stats = (await this.sheetStats([session._id])).get(session.id) ?? NO_STATS;
    return { data: { session: { ...this.summary(session), variants: session.variants, ...stats } } };
  }

  async remove(id: string, user: JwtUser) {
    const session = await this.getOwned(id, user);
    await this.sheets.deleteMany({ session: session._id });
    await session.deleteOne();
    return { data: {} };
  }

  // ---------- sheets ----------

  async listSheets(id: string, user: JwtUser) {
    const session = await this.getOwned(id, user);
    const sheets = await this.sheets.find({ session: session._id }).sort({ number: 1 }).lean();
    return { data: { sheets } };
  }

  async addSheet(id: string, user: JwtUser, dto: CreateSheetDto) {
    const session = await this.getOwned(id, user);
    const graded = this.gradeSheet(session, dto.variant, dto.answers);
    // Atomically reserve the next sheet number
    const before = await this.sessions.findByIdAndUpdate(
      session._id,
      { $inc: { nextSheetNumber: 1 } },
      { returnDocument: 'before' },
    );
    const sheet = await this.sheets.create({
      session: session._id,
      number: before!.nextSheetNumber,
      variant: dto.variant,
      studentName: dto.studentName ?? '',
      ...graded,
    });
    return { data: { sheet } };
  }

  async updateSheet(id: string, sheetId: string, user: JwtUser, dto: UpdateSheetDto) {
    const session = await this.getOwned(id, user);
    const sheet = await this.sheets.findOne({ _id: sheetId, session: session._id });
    if (!sheet) throw new NotFoundException('Sheet not found');
    const variant = dto.variant ?? sheet.variant;
    sheet.set({
      variant,
      ...(dto.studentName !== undefined && { studentName: dto.studentName }),
      ...this.gradeSheet(session, variant, dto.answers ?? sheet.answers),
      status: SheetStatus.Graded,
    });
    await sheet.save();
    return { data: { sheet } };
  }

  async removeSheet(id: string, sheetId: string, user: JwtUser) {
    const session = await this.getOwned(id, user);
    const res = await this.sheets.deleteOne({ _id: sheetId, session: session._id });
    if (!res.deletedCount) throw new NotFoundException('Sheet not found');
    return { data: {} };
  }

  // ---------- exports ----------

  async resultsCsv(id: string, user: JwtUser) {
    const session = await this.getOwned(id, user);
    const sheets = await this.sheets.find({ session: session._id }).sort({ number: 1 }).lean();
    return {
      filename: `${slugify(session.name) || 'session'}-results.csv`,
      csv: buildResultsCsv(session, sheets),
    };
  }

  async pdf(id: string, user: JwtUser, kind: string, letter?: string) {
    if (!PDF_KINDS.includes(kind as PdfKind)) {
      throw new BadRequestException(`kind must be one of: ${PDF_KINDS.join(', ')}`);
    }
    const session = await this.getOwned(id, user);
    const variants = letter ? session.variants.filter((v) => v.letter === letter) : session.variants;
    if (!variants.length) throw new NotFoundException(`Version ${letter} does not exist`);

    const payload: RenderPayload = {
      kind: kind as PdfKind,
      session: {
        id: session.id,
        name: session.name,
        examTitle: session.examTitle,
        date: session.date ? session.date.toISOString().slice(0, 10) : null,
        duration: session.duration,
        passingScore: session.passingScore,
      },
      variants: variants.map((v) => ({
        letter: v.letter,
        questions: v.questions.map((q) => ({
          text: q.text,
          type: q.type,
          options: q.options,
          points: q.points,
          ...(kind === 'answer-key' && {
            correct: q.type === QuestionType.Multiple ? (q.correctIndexes ?? []) : [q.correctIndex!],
          }),
        })),
      })),
    };
    return {
      filename: `${slugify(session.name) || 'session'}-${kind}${letter ? `-${letter}` : ''}.pdf`,
      pdf: await this.omr.renderPdf(payload),
    };
  }

  // ---------- helpers ----------

  private gradeSheet(session: OfflineSessionDocument, letter: string, answers: AnswerDto[]) {
    const variant = session.variants.find((v) => v.letter === letter);
    if (!variant) throw new BadRequestException(`This session has no version ${letter}`);
    const clean = sanitizeAnswers(answers, variant.questions);
    const { score, correctCount, passed } = grade(variant.questions, clean, session.passingScore);
    return { answers: clean, score, correctCount, passed, totalQuestions: variant.questions.length };
  }

  private async getOwned(id: string, user: JwtUser) {
    const session = await this.sessions.findById(id);
    if (!session) throw new NotFoundException('Session not found');
    if (user.role !== Role.Admin && !session.createdBy.equals(user.sub)) {
      throw new ForbiddenException('You can only manage your own sessions');
    }
    return session;
  }

  private summary(s: OfflineSessionDocument) {
    return {
      _id: s._id,
      exam: s.exam,
      name: s.name,
      date: s.date,
      examTitle: s.examTitle,
      examEmoji: s.examEmoji,
      passingScore: s.passingScore,
      duration: s.duration,
      versions: s.variants.map((v) => v.letter),
      questionCount: s.variants[0]?.questions.length ?? 0,
      createdAt: (s as unknown as { createdAt: Date }).createdAt,
    };
  }

  private async sheetStats(ids: Types.ObjectId[]) {
    const rows = await this.sheets.aggregate<SheetStats & { _id: Types.ObjectId }>([
      { $match: { session: { $in: ids } } },
      {
        $group: {
          _id: '$session',
          sheetCount: { $sum: 1 },
          avgScore: { $avg: '$score' },
          passedCount: { $sum: { $cond: ['$passed', 1, 0] } },
          reviewCount: { $sum: { $cond: [{ $eq: ['$status', SheetStatus.NeedsReview] }, 1, 0] } },
        },
      },
    ]);
    return new Map(
      rows.map(({ _id, ...s }) => [String(_id), { ...s, avgScore: Math.round(s.avgScore) }]),
    );
  }
}
