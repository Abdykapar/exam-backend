import type { AttemptDocument } from './schemas/attempt.schema.js';
import { grade } from './grading.js';

/** What a student sees while taking the exam: no answers, no explanations. */
export function toTakingView(a: AttemptDocument) {
  return {
    attempt: {
      _id: a._id,
      exam: a.exam,
      status: a.status,
      startedAt: a.startedAt,
      expiresAt: a.expiresAt,
      answers: a.answers,
      totalQuestions: a.totalQuestions,
    },
    exam: {
      _id: a.exam,
      title: a.examTitle,
      emoji: a.examEmoji,
      duration: a.duration,
      passingScore: a.passingScore,
      questions: a.questions.map((q, index) => ({
        _id: q._id,
        index,
        type: q.type,
        text: q.text,
        options: q.options,
        points: q.points,
      })),
    },
    serverNow: new Date(), // lets the client correct for clock skew
  };
}

export function toResultView(a: AttemptDocument) {
  const { review } = grade(a.questions, a.answers, a.passingScore);
  const { questions: _q, answers: _a, ...summary } = a.toObject();
  return {
    attempt: summary,
    exam: {
      _id: a.exam,
      title: a.examTitle,
      emoji: a.examEmoji,
      passingScore: a.passingScore,
    },
    review,
  };
}
