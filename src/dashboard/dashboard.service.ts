import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Attempt, AttemptStatus } from '../attempts/schemas/attempt.schema.js';

type PopulatedExam = { category?: { name: string } } | null;

@Injectable()
export class DashboardService {
  constructor(@InjectModel(Attempt.name) private attempts: Model<Attempt>) {}

  async get(userId: string) {
    const done = await this.attempts
      .find({ user: userId, status: { $ne: AttemptStatus.InProgress } })
      .select('-questions -answers')
      .sort({ submittedAt: -1 })
      .populate({
        path: 'exam',
        select: 'category',
        populate: { path: 'category', select: 'name' },
      })
      .lean();

    const scores = done.map((a) => a.score);
    const stats = {
      examsTaken: done.length,
      avgScore: scores.length
        ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length)
        : 0,
      certificates: done.filter((a) => a.passed).length,
      studyHours:
        Math.round(
          (done.reduce((s, a) => s + a.timeTakenSeconds, 0) / 3600) * 10,
        ) / 10,
    };
    const recentAttempts = done.slice(0, 5).map((a) => ({
      _id: a._id,
      examTitle: a.examTitle,
      emoji: a.examEmoji,
      category: (a.exam as unknown as PopulatedExam)?.category?.name ?? '',
      score: a.score,
      passed: a.passed,
      submittedAt: a.submittedAt,
      timeTakenSeconds: a.timeTakenSeconds,
    }));
    const scoreHistory = scores.slice(0, 10).reverse();
    return { data: { stats, recentAttempts, scoreHistory } };
  }
}
