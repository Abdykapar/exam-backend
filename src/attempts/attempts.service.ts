import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Attempt,
  AttemptDocument,
  AttemptStatus,
} from './schemas/attempt.schema.js';
import { Exam } from '../exams/schemas/exam.schema.js';
import type { Question } from '../exams/schemas/question.schema.js';
import { SaveAnswersDto, SubmitAttemptDto } from './dto/answers.dto.js';
import { buildSnapshot, grade, GRACE_MS, sanitizeAnswers } from './grading.js';
import { toResultView, toTakingView } from './attempt.mapper.js';

@Injectable()
export class AttemptsService {
  constructor(
    @InjectModel(Attempt.name) private attempts: Model<Attempt>,
    @InjectModel(Exam.name) private exams: Model<Exam>,
  ) {}

  async start(examId: string, userId: string) {
    const exam = await this.exams.findOne({ _id: examId, isPublished: true });
    if (!exam) throw new NotFoundException('Exam not found');

    // Resume an unfinished attempt instead of creating a new one
    let attempt = await this.attempts.findOne({
      user: userId,
      exam: examId,
      status: AttemptStatus.InProgress,
    });
    if (attempt && this.isExpired(attempt)) {
      await this.finish(attempt, true);
      attempt = null;
    }

    if (!attempt) {
      const previous = await this.attempts.countDocuments({
        user: userId,
        exam: examId,
      });
      if (exam.maxAttempts > 0 && previous >= exam.maxAttempts) {
        throw new ForbiddenException('You have used all attempts for this exam');
      }
      const questions = buildSnapshot(
        exam.questions.map((q) => q.toObject<Question>()),
        exam,
      );
      const now = new Date();
      attempt = await this.attempts.create({
        user: userId,
        exam: exam._id,
        examTitle: exam.title,
        examEmoji: exam.emoji,
        passingScore: exam.passingScore,
        duration: exam.duration,
        questions,
        totalQuestions: questions.length,
        startedAt: now,
        expiresAt: new Date(now.getTime() + exam.duration * 60_000),
      });
      if (previous === 0) {
        await this.exams.updateOne(
          { _id: exam._id },
          { $inc: { enrolledCount: 1 } },
        );
      }
    }
    return { data: toTakingView(attempt) };
  }

  async saveAnswers(id: string, userId: string, dto: SaveAnswersDto) {
    const attempt = await this.getOwn(id, userId);
    if (attempt.status !== AttemptStatus.InProgress) {
      throw new ConflictException('This attempt is already submitted');
    }
    if (this.isExpired(attempt)) throw new ForbiddenException('Time is up');
    attempt.answers = sanitizeAnswers(dto.answers, attempt.questions);
    await attempt.save();
    return { data: { savedAt: new Date() } };
  }

  async submit(id: string, userId: string, dto: SubmitAttemptDto) {
    const attempt = await this.getOwn(id, userId);
    if (attempt.status !== AttemptStatus.InProgress) {
      return { data: toResultView(attempt) }; // idempotent
    }
    const late = this.isExpired(attempt);
    // Late submissions are graded from the last autosave
    if (!late) {
      attempt.answers = sanitizeAnswers(dto.answers, attempt.questions);
    }
    await this.finish(attempt, late || !!dto.timedOut);
    return { data: toResultView(attempt) };
  }

  async findOne(id: string, userId: string) {
    const attempt = await this.getOwn(id, userId);
    if (attempt.status === AttemptStatus.InProgress) {
      if (!this.isExpired(attempt)) return { data: toTakingView(attempt) };
      await this.finish(attempt, true);
    }
    return { data: toResultView(attempt) };
  }

  async listMine(userId: string) {
    const attempts = await this.attempts
      .find({ user: userId })
      .select('-questions -answers')
      .sort({ createdAt: -1 })
      .lean();
    return { data: { attempts } };
  }

  private async finish(attempt: AttemptDocument, timedOut: boolean) {
    const { score, correctCount, passed } = grade(
      attempt.questions,
      attempt.answers,
      attempt.passingScore,
    );
    const end = Math.min(Date.now(), attempt.expiresAt.getTime());
    attempt.set({
      score,
      correctCount,
      passed,
      certificateIssued: passed,
      status: timedOut ? AttemptStatus.TimedOut : AttemptStatus.Submitted,
      submittedAt: new Date(end),
      timeTakenSeconds: Math.max(
        0,
        Math.round((end - attempt.startedAt.getTime()) / 1000),
      ),
    });
    await attempt.save();
  }

  private isExpired(a: AttemptDocument) {
    return Date.now() > a.expiresAt.getTime() + GRACE_MS;
  }

  private async getOwn(id: string, userId: string) {
    const attempt = await this.attempts.findOne({ _id: id, user: userId });
    if (!attempt) throw new NotFoundException('Attempt not found');
    return attempt;
  }
}
