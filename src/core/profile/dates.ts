/**
 * Reading the date formats resumes actually use.
 *
 * `YearMonth` is `YYYY-MM`; almost nothing outside this codebase writes that.
 * Both import paths — the local reader and the model call — hit the same
 * problem, so they share one implementation rather than two that drift.
 *
 * Anything unrecognised comes back as `''`, never as a guess. A blank date is
 * not a valid `YearMonth`: `validateProfile` rejects it, the editor flags the
 * field, and the user supplies what the parser could not read. Defaulting to a
 * plausible month would write a date nobody typed into a document about
 * someone's career (D-062).
 */

import type { DateRange, YearMonth } from '../types';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Every way a resume says "and still there". */
const ONGOING = /^(present|current|now|ongoing|to date|date|today)$/;

/**
 * A single date, normalised. `''` when it cannot be read.
 *
 * Bare years are deliberately not accepted: "2022" could be January or
 * December, and a resume that says only the year has not told us the month.
 */
export const toYearMonth = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === '') return '';
  if (ONGOING.test(raw)) return 'present';

  const iso = /^(\d{4})[-/.](\d{1,2})$/.exec(raw);
  if (iso?.[1] !== undefined && iso[2] !== undefined) {
    const month = Number(iso[2]);
    return month >= 1 && month <= 12 ? `${iso[1]}-${String(month).padStart(2, '0')}` : '';
  }

  // "03/2022" and "3-2022": month first, which is how the shorthand is written.
  const monthFirst = /^(\d{1,2})[-/.](\d{4})$/.exec(raw);
  if (monthFirst?.[1] !== undefined && monthFirst[2] !== undefined) {
    const month = Number(monthFirst[1]);
    return month >= 1 && month <= 12 ? `${monthFirst[2]}-${String(month).padStart(2, '0')}` : '';
  }

  const named = /^([a-z]{3,9})\.?,?\s+(\d{4})$/.exec(raw);
  if (named?.[1] !== undefined && named[2] !== undefined) {
    const month = MONTHS.indexOf(named[1].slice(0, 3));
    return month === -1 ? '' : `${named[2]}-${String(month + 1).padStart(2, '0')}`;
  }
  return '';
};

/**
 * A draft range. Blank where the source was unreadable — see the note above on
 * why that is preferable to a default, and why the cast is safe in a draft.
 */
export const toDateRange = (start: unknown, end: unknown): DateRange => ({
  start: toYearMonth(start) as YearMonth,
  end: toYearMonth(end) as YearMonth,
});

/**
 * Whether a draft's date is still blank.
 *
 * `YearMonth` has no empty member — a *saved* profile never holds one, which is
 * the point. A draft does, until the user fills it in, so the one cast that
 * admits it lives here next to the one that creates it.
 */
export const isBlankDate = (value: YearMonth): boolean => (value as string) === '';

/**
 * Pulls a date range out of a line of resume text.
 *
 * Resumes put the dates on the same line as the employer — "Northwind Systems,
 * Lisbon    Mar 2022 – Present" — separated by an en dash, an em dash, a hyphen
 * or the word "to". Returns the range and the line with the dates removed, so
 * the caller can go on reading the half that names the company.
 */
export const splitDateRange = (line: string): { readonly dates: DateRange | undefined; readonly rest: string } => {
  const pattern =
    /\b((?:[a-z]{3,9}\.?,?\s+)?\d{4}|\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2})\s*(?:–|—|-|to|until)\s*((?:[a-z]{3,9}\.?,?\s+)?\d{4}|\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2}|present|current|now|ongoing|today)\b/i;

  const match = pattern.exec(line);
  if (match?.[1] === undefined || match[2] === undefined) return { dates: undefined, rest: line };

  const start = toYearMonth(match[1]);
  const end = toYearMonth(match[2]);
  // A range whose halves are both unreadable is not a date range at all; leaving
  // the text in place gives the caller a chance to read it as something else.
  if (start === '' && end === '') return { dates: undefined, rest: line };

  return {
    dates: toDateRange(match[1], match[2]),
    rest: (line.slice(0, match.index) + line.slice(match.index + match[0].length)).trim(),
  };
};
