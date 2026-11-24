import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model, Types } from 'mongoose';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Attempt,
  AttemptDocument,
  AttemptStatus,
} from './schemas/attempt.schema.js';
import { Exam, ExamDocument } from '../exams/schemas/exam.schema.js';
import type { Question } from '../exams/schemas/question.schema.js';
import { Role, User } from '../users/schemas/user.schema.js';
import {
  JoinExamDto,
  NextQuestionDto,
  SaveAnswersDto,
  SubmitAttemptDto,
} from './dto/answers.dto.js';
import {
  buildSnapshot,
  finishedFields,
  GRACE_MS,
  sanitizeAnswers,
} from './grading.js';
import {
  allQuestionsDone,
  catchUp,
  mergeCurrentAnswer,
  startQuestion,
} from './question-timer.js';
import { toResultView, toTakingView } from './attempt.mapper.js';
import {
  ProctoringService,
  type ClientInfo,
} from '../proctoring/proctoring.service.js';
import type { JwtUser } from '../common/types.js';

/** Guest sessions only need to last through one exam. */
const GUEST_TOKEN_TTL_S = 24 * 60 * 60;

const sha = (s: string) => createHash('sha256').update(s).digest();
const passwordMatches = (given: string | undefined, expected: string) =>
  given != null && timingSafeEqual(sha(given.trim()), sha(expected));

@Injectable()
export class AttemptsService {
  constructor(
    @InjectModel(Attempt.name) private attempts: Model<Attempt>,
    @InjectModel(Exam.name) private exams: Model<Exam>,
    @InjectModel(User.name) private users: Model<User>,
    private jwt: JwtService,
    private proctoring: ProctoringService,
  ) {}

  /** Guests: check the exam password and get a session limited to this exam. */
  async join(examId: string, dto: JoinExamDto) {
    const exam = await this.getPublished(examId);
    if (!exam.accessPassword) {
      throw new BadRequestException('This exam does not use a password');
    }
    if (!passwordMatches(dto.password, exam.accessPassword)) {
      throw new ForbiddenException('Incorrect exam password');
    }
    const user = await this.users.create({
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      // Email is unique and required; guests get a placeholder that can't receive mail or log in
      email: `guest-${new Types.ObjectId().toString()}@guest.invalid`,
      role: Role.Student,
      isGuest: true,
    });
    const token = await this.jwt.signAsync(
      { sub: user.id, role: user.role, exam: exam.id },
      { expiresIn: GUEST_TOKEN_TTL_S },
    );
    return { token, data: { user } };
  }

  async start(examId: string, user: JwtUser, password?: string) {
    const userId = user.sub;
    if (user.exam && user.exam !== examId) {
      throw new ForbiddenException('Your guest access is for a different exam');
    }
    const exam = await this.getPublished(examId);

    // Resume an unfinished attempt instead of creating a new one
    let attempt = await this.attempts.findOne({
      user: userId,
      exam: examId,
      status: AttemptStatus.InProgress,
    });
    if (attempt && (await this.refresh(attempt))) attempt = null;

    if (!attempt) {
      this.assertCanEnter(exam, user, password);
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
      attempt = new this.attempts({
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
        // Snapshot, so editing the exam mid-attempt can't change the rules
        proctoring: exam.proctoring,
        perQuestionTiming: exam.perQuestionTiming,
        lastHeartbeatAt: now,
      });
      if (attempt.perQuestionTiming) startQuestion(attempt, 0, now);
      await attempt.save();
      if (previous === 0) {
        await this.exams.updateOne(
          { _id: exam._id },
          { $inc: { enrolledCount: 1 } },
        );
      }
    }
    return { data: toTakingView(attempt) };
  }

  async saveAnswers(
    id: string,
    userId: string,
    dto: SaveAnswersDto,
    client: ClientInfo = {},
  ) {
    const attempt = await this.getOwn(id, userId);
    await this.assertOpen(attempt);
    attempt.answers = this.acceptAnswers(attempt, dto);
    await attempt.save();
    // After saving, so an auto-submit triggered here grades these answers
    const proctoring = await this.proctoring.checkHeartbeatGap(attempt, client);
    return {
      data: {
        savedAt: new Date(),
        currentQuestion: attempt.currentQuestion,
        ...(proctoring && { proctoring }),
      },
    };
  }

  /**
   * Per-question timing: saves the answer to question `index` and moves on.
   * If the server already moved past it (time ran out), the answer is ignored
   * and the current state is returned so the client can catch up.
   */
  async next(
    id: string,
    userId: string,
    dto: NextQuestionDto,
    client: ClientInfo = {},
  ) {
    const attempt = await this.getOwn(id, userId);
    if (!attempt.perQuestionTiming) {
      throw new BadRequestException('This exam does not use per-question timing');
    }
    if (attempt.status !== AttemptStatus.InProgress || (await this.refresh(attempt))) {
      return { data: toResultView(attempt) };
    }
    if (dto.index === attempt.currentQuestion) {
      attempt.answers = this.acceptAnswers(attempt, dto);
      startQuestion(attempt, attempt.currentQuestion + 1, new Date());
      await attempt.save();
    }
    const gap = await this.proctoring.checkHeartbeatGap(attempt, client);
    if (gap && gap.status !== AttemptStatus.InProgress) {
      return { data: toResultView(await this.getOwn(id, userId)) };
    }
    if (allQuestionsDone(attempt)) {
      await this.finish(attempt, false);
      return { data: toResultView(attempt) };
    }
    return { data: toTakingView(attempt) };
  }

  async submit(
    id: string,
    userId: string,
    dto: SubmitAttemptDto,
    client: ClientInfo = {},
  ) {
    const attempt = await this.getOwn(id, userId);
    if (attempt.status !== AttemptStatus.InProgress) {
      return { data: toResultView(attempt) }; // idempotent
    }
    if (await this.refresh(attempt)) return { data: toResultView(attempt) };
    const late = this.isExpired(attempt);
    // Late submissions are graded from the last autosave
    if (!late) {
      attempt.answers = this.acceptAnswers(attempt, dto);
      await attempt.save();
    }
    // Log a final unexplained gap for the teacher; it may also hit the limit
    const gap = await this.proctoring.checkHeartbeatGap(attempt, client);
    if (gap && gap.status !== AttemptStatus.InProgress) {
      return { data: toResultView(await this.getOwn(id, userId)) };
    }
    await this.finish(attempt, late || !!dto.timedOut);
    return { data: toResultView(attempt) };
  }

  async findOne(id: string, userId: string) {
    const attempt = await this.getOwn(id, userId);
    if (attempt.status === AttemptStatus.InProgress && !(await this.refresh(attempt))) {
      return { data: toTakingView(attempt) };
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

  /**
   * Applies the clock to an in-progress attempt: skips questions whose time ran
   * out and finishes the attempt once time is up. Returns true if it finished.
   */
  private async refresh(attempt: AttemptDocument): Promise<boolean> {
    const moved = catchUp(attempt);
    if (allQuestionsDone(attempt) || this.isExpired(attempt)) {
      await this.finish(attempt, true);
      return true;
    }
    if (moved) await attempt.save();
    return false;
  }

  private async assertOpen(attempt: AttemptDocument) {
    if (attempt.status !== AttemptStatus.InProgress || (await this.refresh(attempt))) {
      throw new ConflictException('This attempt is already submitted');
    }
  }

  private acceptAnswers(attempt: AttemptDocument, dto: SaveAnswersDto) {
    const incoming = sanitizeAnswers(dto.answers, attempt.questions);
    return attempt.perQuestionTiming
      ? mergeCurrentAnswer(attempt.answers, incoming, attempt.currentQuestion)
      : incoming;
  }

  /** Password-protected exams: guests got in via join; others need the password, except the exam's owner and admins. */
  private assertCanEnter(exam: ExamDocument, user: JwtUser, password?: string) {
    if (!exam.accessPassword) return;
    if (user.exam === exam.id) return;
    if (user.role === Role.Admin || exam.instructor.equals(user.sub)) return;
    if (!passwordMatches(password, exam.accessPassword)) {
      throw new ForbiddenException(
        password ? 'Incorrect exam password' : 'This exam requires a password',
      );
    }
  }

  private async getPublished(examId: string) {
    const exam = await this.exams.findOne({ _id: examId, isPublished: true });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  private async finish(attempt: AttemptDocument, timedOut: boolean) {
    attempt.set(
      finishedFields(
        attempt,
        timedOut ? AttemptStatus.TimedOut : AttemptStatus.Submitted,
      ),
    );
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
