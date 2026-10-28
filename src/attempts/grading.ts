import { Question, QuestionType } from '../exams/schemas/question.schema.js';
import type { AttemptAnswer } from './schemas/attempt.schema.js';
import type { AnswerDto } from './dto/answers.dto.js';
import { shuffle } from '../common/utils.js';

export const GRACE_MS = 30_000;

/** Copy the exam's questions for one attempt, shuffling and remapping correct answers if enabled. */
export function buildSnapshot(
  questions: Question[],
  opts: { shuffleQuestions: boolean; shuffleOptions: boolean },
): Question[] {
  const ordered = opts.shuffleQuestions ? shuffle(questions) : questions;
  if (!opts.shuffleOptions) return ordered;
  return ordered.map((q) => {
    const perm = shuffle(q.options.map((_, i) => i)); // perm[newPos] = oldPos
    return {
      ...q,
      options: perm.map((i) => q.options[i]),
      correctIndex:
        q.correctIndex == null ? undefined : perm.indexOf(q.correctIndex),
      correctIndexes: q.correctIndexes?.map((i) => perm.indexOf(i)),
    };
  });
}

/** Drop invalid indexes and duplicates; never trust the client. */
export function sanitizeAnswers(
  input: AnswerDto[],
  questions: Question[],
): AttemptAnswer[] {
  const out = new Map<number, AttemptAnswer>();
  for (const a of input) {
    const q = questions[a.questionIndex];
    if (!q) continue;
    const valid = (i: number) =>
      Number.isInteger(i) && i >= 0 && i < q.options.length;
    out.set(a.questionIndex, {
      questionIndex: a.questionIndex,
      selectedIndex:
        a.selectedIndex != null && valid(a.selectedIndex)
          ? a.selectedIndex
          : null,
      selectedIndexes: [...new Set((a.selectedIndexes ?? []).filter(valid))],
      isFlagged: !!a.isFlagged,
    });
  }
  return [...out.values()];
}

export function isAnswerCorrect(q: Question, a?: AttemptAnswer): boolean {
  if (!a) return false;
  if (q.type === QuestionType.Multiple) {
    const want = [...(q.correctIndexes ?? [])].sort((x, y) => x - y);
    const got = [...a.selectedIndexes].sort((x, y) => x - y);
    return want.length === got.length && want.every((v, i) => v === got[i]);
  }
  return a.selectedIndex !== null && a.selectedIndex === q.correctIndex;
}

/** Score as a percentage of points, plus a per-question review (includes answers: only for finished attempts). */
export function grade(
  questions: Question[],
  answers: AttemptAnswer[],
  passingScore: number,
) {
  const byIndex = new Map(answers.map((a) => [a.questionIndex, a]));
  let earned = 0;
  let total = 0;
  let correctCount = 0;
  const review = questions.map((q, index) => {
    const a = byIndex.get(index);
    const isCorrect = isAnswerCorrect(q, a);
    total += q.points;
    if (isCorrect) {
      earned += q.points;
      correctCount++;
    }
    return {
      index,
      type: q.type,
      text: q.text,
      options: q.options,
      points: q.points,
      correctIndex: q.correctIndex,
      correctIndexes: q.correctIndexes,
      explanation: q.explanation,
      selectedIndex: a?.selectedIndex ?? null,
      selectedIndexes: a?.selectedIndexes ?? [],
      isFlagged: a?.isFlagged ?? false,
      isCorrect,
    };
  });
  const score = total ? Math.round((earned / total) * 100) : 0;
  return { score, correctCount, passed: score >= passingScore, review };
}
