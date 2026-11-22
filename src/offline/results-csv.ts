import { grade } from '../attempts/grading.js';
import type { OfflineSession } from './schemas/offline-session.schema.js';
import type { OfflineSheet } from './schemas/offline-sheet.schema.js';

const cell = (value: unknown) => {
  const s = String(value ?? '');
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Neutralise spreadsheet formulas in user-entered text (CSV injection). */
const text = (value: string) => cell(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/**
 * One row per sheet. Per-question columns use the original question order (version A),
 * so results from different versions line up: 1 = correct, 0 = wrong.
 */
export function buildResultsCsv(
  session: Pick<OfflineSession, 'variants' | 'passingScore'>,
  sheets: Pick<
    OfflineSheet,
    'number' | 'studentName' | 'variant' | 'answers' | 'score' | 'correctCount' | 'totalQuestions' | 'passed'
  >[],
): string {
  const base = session.variants[0]?.questions ?? [];
  const header = [
    'Sheet',
    'Name',
    'Version',
    'Score %',
    'Correct',
    'Total',
    'Passed',
    ...base.map((_, i) => `Q${i + 1}`),
  ];

  const rows = sheets.map((sheet) => {
    const variant = session.variants.find((v) => v.letter === sheet.variant);
    const correctById = new Map<string, number>();
    if (variant) {
      const { review } = grade(variant.questions, sheet.answers, session.passingScore);
      variant.questions.forEach((q, i) =>
        correctById.set(String(q._id), review[i].isCorrect ? 1 : 0),
      );
    }
    return [
      cell(sheet.number),
      text(sheet.studentName),
      cell(sheet.variant),
      cell(sheet.score),
      cell(sheet.correctCount),
      cell(sheet.totalQuestions),
      cell(sheet.passed ? 'yes' : 'no'),
      ...base.map((q) => cell(correctById.get(String(q._id)) ?? '')),
    ].join(',');
  });

  // BOM so Excel opens UTF-8 (e.g. Cyrillic names) correctly
  return '﻿' + [header.join(','), ...rows].join('\r\n') + '\r\n';
}
