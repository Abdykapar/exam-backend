/**
 * Public view: no questions (students get them via /start) and no password,
 * only whether one is required.
 */
export function toPublicExam<
  T extends { questions: unknown[]; accessPassword?: string },
>(exam: T) {
  const { questions, accessPassword, ...rest } = exam;
  return {
    ...rest,
    questionCount: questions.length,
    requiresPassword: !!accessPassword,
  };
}
