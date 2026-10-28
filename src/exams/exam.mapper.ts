/** Public view: no questions at all, only the count (students get questions via /start). */
export function toPublicExam<T extends { questions: unknown[] }>(exam: T) {
  const { questions, ...rest } = exam;
  return { ...rest, questionCount: questions.length };
}
