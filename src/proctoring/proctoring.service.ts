import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Attempt,
  AttemptDocument,
  AttemptStatus,
} from '../attempts/schemas/attempt.schema.js';
import { finishedFields, GRACE_MS } from '../attempts/grading.js';
import { ExamsService } from '../exams/exams.service.js';
import {
  ExamViolation,
  isCounted,
  type ViolationType,
} from './schemas/exam-violation.schema.js';
import { HeartbeatDto, ReportViolationDto } from './dto/proctoring.dto.js';
import type { JwtUser } from '../common/types.js';

/** The client pings every 10s while the exam is visible and focused. */
export const HEARTBEAT_TIMEOUT_MS = 30_000;
/** Slack for one missed ping plus network latency when matching a gap to reported time away. */
const GAP_SLACK_MS = 20_000;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface ProctorState {
  status: AttemptStatus;
  violationCount: number;
  maxViolations: number;
}

@Injectable()
export class ProctoringService {
  constructor(
    @InjectModel(ExamViolation.name) private violations: Model<ExamViolation>,
    @InjectModel(Attempt.name) private attempts: Model<Attempt>,
    private exams: ExamsService,
  ) {}

  // ---------- student ----------

  async report(userId: string, dto: ReportViolationDto, client: ClientInfo) {
    const attempt = await this.getActive(dto.attemptId, userId);
    // Record first: this report's durationMs is what explains a heartbeat gap
    // (e.g. back from a 40s tab switch), so the gap isn't counted twice.
    const state = await this.record(attempt, dto.type, client, {
      clientAt: new Date(dto.at),
      durationMs: dto.durationMs,
    });
    if (state.status !== AttemptStatus.InProgress) return { data: state };
    const gap = await this.checkHeartbeatGap(attempt, client);
    return { data: gap ?? state };
  }

  async heartbeat(userId: string, dto: HeartbeatDto, client: ClientInfo) {
    const attempt = await this.getActive(dto.attemptId, userId);
    const state =
      (await this.checkHeartbeatGap(attempt, client)) ?? this.state(attempt);
    if (state.status === AttemptStatus.InProgress) {
      await this.attempts.updateOne(
        { _id: attempt._id, status: AttemptStatus.InProgress },
        { $set: { lastHeartbeatAt: new Date() } },
      );
    }
    return { data: state };
  }

  /**
   * Logs `heartbeat_missed` if the page went quiet for too long and the time
   * away wasn't already reported by the client (a tab switch, for example).
   * Also used by answer saves and submits, which catches students who
   * disabled the heartbeat but kept using the API. Returns null if nothing was logged.
   */
  async checkHeartbeatGap(
    attempt: AttemptDocument,
    client: ClientInfo,
  ): Promise<ProctorState | null> {
    if (!attempt.proctoring?.enabled) return null;
    if (attempt.status !== AttemptStatus.InProgress) return null;
    const now = new Date();
    const last = attempt.lastHeartbeatAt ?? attempt.startedAt;
    const gap = now.getTime() - last.getTime();
    if (gap <= HEARTBEAT_TIMEOUT_MS) return null;

    // Move the window forward first so concurrent requests don't log the same gap twice
    const claimed = await this.attempts.updateOne(
      { _id: attempt._id, lastHeartbeatAt: attempt.lastHeartbeatAt ?? null },
      { $set: { lastHeartbeatAt: now } },
    );
    attempt.lastHeartbeatAt = now;
    if (!claimed.modifiedCount) return null;

    const [reported] = await this.violations.aggregate<{ total: number }>([
      {
        $match: {
          attempt: attempt._id,
          serverAt: { $gt: last },
          type: { $ne: 'heartbeat_missed' },
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$durationMs', 0] } } } },
    ]);
    if ((reported?.total ?? 0) + GAP_SLACK_MS >= gap) return null;

    return this.record(attempt, 'heartbeat_missed', client, {
      clientAt: now,
      durationMs: gap,
    });
  }

  // ---------- instructor ----------

  async listAttempts(examId: string, user: JwtUser) {
    const exam = await this.exams.getEditable(examId, user);
    const [attempts, logged] = await Promise.all([
      this.attempts
        .find({ exam: exam._id })
        .select('-questions -answers')
        .populate('user', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .lean(),
      this.violations.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { exam: exam._id } },
        { $group: { _id: '$attempt', n: { $sum: 1 } } },
      ]),
    ]);
    const counts = new Map(logged.map((l) => [String(l._id), l.n]));
    return {
      data: {
        attempts: attempts.map((a) => ({
          ...a,
          loggedEvents: counts.get(String(a._id)) ?? 0,
        })),
      },
    };
  }

  async attemptViolations(attemptId: string, user: JwtUser) {
    const attempt = await this.attempts
      .findById(attemptId)
      .select('-questions -answers')
      .populate('user', 'firstName lastName email')
      .lean();
    if (!attempt) throw new NotFoundException('Attempt not found');
    await this.exams.getEditable(String(attempt.exam), user);
    const violations = await this.violations
      .find({ attempt: attempt._id })
      .sort({ serverAt: 1 })
      .lean();
    return { data: { attempt, violations } };
  }

  // ---------- internals ----------

  private async record(
    attempt: AttemptDocument,
    type: ViolationType,
    client: ClientInfo,
    at: { clientAt: Date; durationMs?: number },
  ): Promise<ProctorState> {
    const counted = isCounted(type);
    await this.violations.create({
      attempt: attempt._id,
      user: attempt.user,
      exam: attempt.exam,
      type,
      counted,
      clientAt: at.clientAt,
      serverAt: new Date(),
      durationMs: at.durationMs,
      ip: client.ip,
      userAgent: client.userAgent,
    });

    // Atomic, capped increment: concurrent reports can't push the count past
    // the limit, and exactly one of them sees the limit and auto-submits.
    const max = attempt.proctoring.maxViolations;
    const updated = await this.attempts.findOneAndUpdate(
      {
        _id: attempt._id,
        status: AttemptStatus.InProgress,
        ...(counted && { violationCount: { $lt: max } }),
      },
      { $inc: { violationCount: counted ? 1 : 0 } },
      { returnDocument: 'after' },
    );
    if (!updated) {
      // Finished by a concurrent request; report its final state
      const current = await this.attempts.findById(attempt._id);
      return this.state(current ?? attempt);
    }
    if (counted && updated.violationCount >= updated.proctoring.maxViolations) {
      // Graded from the last autosave
      updated.set(finishedFields(updated, AttemptStatus.AutoSubmitted));
      await updated.save();
    }
    return this.state(updated);
  }

  private state(a: AttemptDocument): ProctorState {
    return {
      status: a.status,
      violationCount: a.violationCount,
      maxViolations: a.proctoring.maxViolations,
    };
  }

  /** The caller's own, proctored, unfinished, unexpired attempt. */
  private async getActive(id: string, userId: string) {
    const attempt = await this.attempts.findOne({ _id: id, user: userId });
    // Same 404 for "doesn't exist" and "not yours": don't reveal other students' attempt ids
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!attempt.proctoring?.enabled) {
      throw new BadRequestException('Proctoring is not enabled for this exam');
    }
    if (attempt.status !== AttemptStatus.InProgress) {
      throw new ConflictException('This attempt is already submitted');
    }
    if (Date.now() > attempt.expiresAt.getTime() + GRACE_MS) {
      throw new ForbiddenException('Time is up');
    }
    return attempt;
  }
}
