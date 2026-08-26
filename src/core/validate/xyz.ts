/**
 * Google XYZ shape check: "Accomplished [X] as measured by [Y] by doing [Z]".
 *
 * Advisory only. This warns and never blocks — a user's honest bullet with no
 * metric still ships, because the alternative is pressuring them into inventing
 * one, which is the exact failure this product exists to prevent.
 *
 * @see AI_RULES.md (Content rules)
 */

import type { ItemId, XyzIssue } from '../types/index';
import { ACTION_VERBS, extractNumbers } from './evidence';

/** Openers that describe proximity to work rather than ownership of it. */
const WEAK_OPENERS: ReadonlySet<string> = new Set([
  'assisted', 'contributed', 'did', 'handled', 'helped', 'involved', 'participated',
  'responsible', 'supported', 'tasked', 'was', 'worked',
]);

/**
 * The "by doing [Z]" half: a gerund clause, or an explicit means. `with` is
 * excluded on purpose — it appears in almost every bullet and would make this
 * check pass for free.
 */
const MECHANISM = /\bby\s+\w+ing\b|\b(?:using|via|through|leveraging|thanks\s+to)\b/i;

const opensWithAction = (text: string): boolean => {
  const first = (text.trim().match(/[A-Za-z][A-Za-z'-]*/)?.[0] ?? '').toLowerCase();
  if (!first || WEAK_OPENERS.has(first)) return false;
  // `-ed` catches the long tail of past-tense verbs the list does not name.
  return ACTION_VERBS.has(first) || first.endsWith('ed');
};

/**
 * Advisory shape warnings for one bullet. Each `hint` is shown inline in the
 * review UI, so it says what to change rather than which letter is missing.
 */
export const checkXyz = (text: string, bulletId: ItemId): XyzIssue[] => {
  const issues: XyzIssue[] = [];

  if (extractNumbers(text).length === 0) {
    issues.push({
      bulletId,
      missing: 'measurement',
      hint: 'No number here. How much, how many, how often, or how much faster — e.g. "cut build time from 9 min to 90 s". If you have no honest figure, leave it as it is.',
    });
  }

  if (!opensWithAction(text)) {
    issues.push({
      bulletId,
      missing: 'action',
      hint: 'Open with what you did, not how close you were to it: "Led", "Built", "Cut", "Migrated" instead of "Helped with" or "Responsible for".',
    });
  }

  if (!MECHANISM.test(text)) {
    issues.push({
      bulletId,
      missing: 'outcome',
      hint: 'Say how you pulled it off — add a "by …" clause naming the technique or system, e.g. "… by adding a read-through cache".',
    });
  }

  return issues;
};
