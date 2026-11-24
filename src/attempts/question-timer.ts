import type { Attempt, AttemptAnswer } from './schemas/attempt.schema.js';

/** Slack for network latency when the client advances right at the deadline. */
export const QUESTION_GRACE_MS = 3_000;

type Timed = Pick<
  Attempt,
  | 'perQuestionTiming'
  | 'questions'
  | 'currentQuestion'
  | 'questionStartedAt'
  | 'startedAt'
  | 'expiresAt'
>;

const limitMs = (q: { timeLimit?: number }) => (q.timeLimit ?? 60) * 1000;

/** Sum of the time limits from `from` to the end, in ms. */
export function remainingMs(questions: { timeLimit?: number }[], from: number) {
  return questions.slice(from).reduce((s, q) => s + limitMs(q), 0);
}

/** Starts question `index` at `at`, and moves the attempt's deadline to match. */
export function startQuestion(a: Timed, index: number, at: Date) {
  a.currentQuestion = index;
  a.questionStartedAt = at;
  a.expiresAt = new Date(at.getTime() + remainingMs(a.questions, index));
}

/**
 * Skips every question whose time ran out, as if the client had advanced at
 * each deadline. Returns true if the attempt changed.
 */
export function catchUp(a: Timed, now = Date.now()): boolean {
  if (!a.perQuestionTiming) return false;
  let start = (a.questionStartedAt ?? a.startedAt).getTime();
  let i = a.currentQuestion;
  while (
    i < a.questions.length &&
    now > start + limitMs(a.questions[i]) + QUESTION_GRACE_MS
  ) {
    start += limitMs(a.questions[i]);
    i++;
  }
  if (i === a.currentQuestion) return false;
  startQuestion(a, i, new Date(start));
  return true;
}

export const allQuestionsDone = (a: Timed) =>
  a.perQuestionTiming && a.currentQuestion >= a.questions.length;

export function questionDeadline(a: Timed): Date | null {
  if (!a.perQuestionTiming) return null;
  const q = a.questions[a.currentQuestion];
  if (!q) return null;
  const start = a.questionStartedAt ?? a.startedAt;
  return new Date(start.getTime() + limitMs(q));
}

/** Earlier answers are locked: only the current question's answer is taken from the client. */
export function mergeCurrentAnswer(
  stored: AttemptAnswer[],
  incoming: AttemptAnswer[],
  current: number,
): AttemptAnswer[] {
  const mine = incoming.find((a) => a.questionIndex === current);
  if (!mine) return stored;
  return [...stored.filter((a) => a.questionIndex !== current), mine];
}
