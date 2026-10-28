import { Types } from 'mongoose';
import { Question, QuestionType } from '../exams/schemas/question.schema.js';
import {
  buildSnapshot,
  grade,
  isAnswerCorrect,
  sanitizeAnswers,
} from './grading.js';

const q = (over: Partial<Question>): Question => ({
  _id: new Types.ObjectId(),
  type: QuestionType.Single,
  text: 'Q',
  options: ['a', 'b', 'c', 'd'],
  points: 1,
  ...over,
});

const answer = (questionIndex: number, over = {}) => ({
  questionIndex,
  selectedIndex: null,
  selectedIndexes: [],
  isFlagged: false,
  ...over,
});

describe('isAnswerCorrect', () => {
  it('handles single-answer questions', () => {
    const single = q({ correctIndex: 2 });
    expect(isAnswerCorrect(single, answer(0, { selectedIndex: 2 }))).toBe(true);
    expect(isAnswerCorrect(single, answer(0, { selectedIndex: 1 }))).toBe(false);
    expect(isAnswerCorrect(single, answer(0))).toBe(false);
    expect(isAnswerCorrect(single, undefined)).toBe(false);
  });

  it('requires the exact set for multiple-answer questions', () => {
    const multi = q({ type: QuestionType.Multiple, correctIndexes: [0, 2] });
    expect(isAnswerCorrect(multi, answer(0, { selectedIndexes: [2, 0] }))).toBe(true);
    expect(isAnswerCorrect(multi, answer(0, { selectedIndexes: [0] }))).toBe(false);
    expect(isAnswerCorrect(multi, answer(0, { selectedIndexes: [0, 1, 2] }))).toBe(false);
  });
});

describe('grade', () => {
  it('weights by points and rounds the percentage', () => {
    const questions = [
      q({ correctIndex: 0, points: 1 }),
      q({ correctIndex: 1, points: 2 }),
    ];
    const result = grade(questions, [answer(1, { selectedIndex: 1 })], 60);
    expect(result.score).toBe(67);
    expect(result.correctCount).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.review[0]).toMatchObject({ isCorrect: false, selectedIndex: null });
  });

  it('scores 0 for an exam with no questions', () => {
    expect(grade([], [], 50)).toMatchObject({ score: 0, passed: false });
  });
});

describe('buildSnapshot', () => {
  it('keeps correct answers pointing at the same option text after shuffling', () => {
    const original = [
      q({ options: ['a', 'b', 'c', 'd', 'e', 'f'], correctIndex: 4 }),
      q({ type: QuestionType.Multiple, options: ['a', 'b', 'c', 'd'], correctIndexes: [1, 3] }),
    ];
    for (let run = 0; run < 20; run++) {
      const snap = buildSnapshot(original, { shuffleQuestions: true, shuffleOptions: true });
      const single = snap.find((s) => s.type === QuestionType.Single)!;
      const multi = snap.find((s) => s.type === QuestionType.Multiple)!;
      expect(single.options[single.correctIndex!]).toBe('e');
      expect(multi.correctIndexes!.map((i) => multi.options[i]).sort()).toEqual(['b', 'd']);
    }
  });

  it('returns questions unchanged when shuffling is off', () => {
    const original = [q({ correctIndex: 1 }), q({ correctIndex: 2 })];
    expect(buildSnapshot(original, { shuffleQuestions: false, shuffleOptions: false })).toEqual(original);
  });
});

describe('sanitizeAnswers', () => {
  it('drops out-of-range indexes and duplicate questions', () => {
    const questions = [q({ options: ['a', 'b'] })];
    const result = sanitizeAnswers(
      [
        { questionIndex: 0, selectedIndex: 5 },
        { questionIndex: 0, selectedIndex: 1, selectedIndexes: [0, 0, 9] },
        { questionIndex: 3, selectedIndex: 0 },
      ],
      questions,
    );
    expect(result).toEqual([
      { questionIndex: 0, selectedIndex: 1, selectedIndexes: [0], isFlagged: false },
    ]);
  });
});
