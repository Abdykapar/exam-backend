import type { AttemptDocument } from './schemas/attempt.schema.js';
import { grade } from './grading.js';
import { questionDeadline } from './question-timer.js';

/**
 * What a student sees while taking the exam: no answers, no explanations.
 * With per-question timing, questions after the current one are blanked so
 * they can't be read ahead of time.
 */
export function toTakingView(a: AttemptDocument) {
  const hidden = (index: number) =>
    a.perQuestionTiming && index > a.currentQuestion;
  return {
    attempt: {
      _id: a._id,
      exam: a.exam,
      status: a.status,
      startedAt: a.startedAt,
      expiresAt: a.expiresAt,
      answers: a.answers,
      totalQuestions: a.totalQuestions,
      proctoring: a.proctoring,
      violationCount: a.violationCount,
      perQuestionTiming: a.perQuestionTiming,
      currentQuestion: a.currentQuestion,
      questionDeadline: questionDeadline(a),
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
        text: hidden(index) ? '' : q.text,
        options: hidden(index) ? [] : q.options,
        points: q.points,
        timeLimit: q.timeLimit ?? 60,
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
