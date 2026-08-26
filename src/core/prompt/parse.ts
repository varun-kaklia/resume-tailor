/**
 * Parses a model response into a `TailoringPlan`.
 *
 * Shape only. Whether the plan's ids exist and whether its rewrites are
 * grounded is decided later by `core/tailor.ts`, against the profile — this
 * layer has no profile to check against and does not guess.
 *
 * @see docs/architecture.md §8
 */

import { AppError } from '../types';
import type { BulletRewrite, PlannedSection, TailoringPlan } from '../types';

/**
 * Strips what smaller models wrap around JSON they were asked to return bare:
 * code fences, a leading "Here is the plan:", a trailing note.
 *
 * Retrying costs the user a second call, so it is worth recovering a response
 * whose only fault is packaging. Anything beyond that is a real failure.
 */
const unwrap = (raw: string): string => {
  const text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  const inner = (fenced?.[1] ?? text).trim();
  if (inner.startsWith('{')) return inner;

  const start = inner.indexOf('{');
  const end = inner.lastIndexOf('}');
  return start !== -1 && end > start ? inner.slice(start, end + 1) : inner;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (why: string): AppError => new AppError('PLAN_INVALID', { context: { why } });

const asIdList = (value: unknown, why: string): string[] => {
  if (!Array.isArray(value)) throw invalid(why);
  return value.map((id) => {
    if (typeof id !== 'string' || id.trim() === '') throw invalid(why);
    return id;
  });
};

const asSections = (value: unknown, field: string): PlannedSection[] => {
  if (!Array.isArray(value)) throw invalid(`${field} is not a list`);
  return value.map((entry) => {
    if (!isRecord(entry)) throw invalid(`${field} contains a non-object`);
    const id = entry['id'];
    if (typeof id !== 'string' || id.trim() === '') throw invalid(`${field} entry has no id`);
    return { id, bulletIds: asIdList(entry['bulletIds'], `${field}[${id}].bulletIds is not a list of ids`) };
  });
};

const asSkills = (value: unknown): TailoringPlan['skills'] => {
  if (!Array.isArray(value)) throw invalid('skills is not a list');
  return value.map((entry) => {
    if (!isRecord(entry)) throw invalid('skills contains a non-object');
    const id = entry['id'];
    if (typeof id !== 'string' || id.trim() === '') throw invalid('skills entry has no id');
    const skills = entry['skills'];
    if (!Array.isArray(skills)) throw invalid(`skills[${id}].skills is not a list`);
    return {
      id,
      skills: skills.map((skill) => {
        if (typeof skill !== 'string') throw invalid(`skills[${id}] contains a non-string`);
        return skill;
      }),
    };
  });
};

/**
 * A rewrite with blank text is dropped rather than rejected.
 *
 * Absent from `rewrites`, a bullet renders in the user's original words, which
 * is the right outcome for a model that returned an empty string — and better
 * than failing an otherwise sound plan over one bad entry.
 */
const asRewrites = (value: unknown): BulletRewrite[] => {
  if (!Array.isArray(value)) throw invalid('rewrites is not a list');
  const rewrites: BulletRewrite[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) throw invalid('rewrites contains a non-object');
    const id = entry['id'];
    const text = entry['text'];
    if (typeof id !== 'string' || id.trim() === '') throw invalid('a rewrite has no id');
    if (typeof text !== 'string') throw invalid(`rewrite ${id} has no text`);
    if (text.trim() === '') continue;

    const rationale = entry['rationale'];
    rewrites.push({
      id,
      text: text.trim(),
      ...(typeof rationale === 'string' && rationale.trim() !== '' ? { rationale: rationale.trim() } : {}),
    });
  }
  return rewrites;
};

/**
 * @throws {AppError} `BAD_RESPONSE_SHAPE` when the response is not JSON at all,
 *   `PLAN_INVALID` when it is JSON of the wrong shape. The two are separate
 *   because the first is usually fixed by retrying and the second is not.
 */
export const parseTailoringPlan = (raw: string): TailoringPlan => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrap(raw));
  } catch (cause) {
    throw new AppError('BAD_RESPONSE_SHAPE', { cause });
  }

  if (!isRecord(parsed)) throw invalid('response is not an object');

  const summary = parsed['summary'];
  return {
    experience: asSections(parsed['experience'] ?? [], 'experience'),
    projects: asSections(parsed['projects'] ?? [], 'projects'),
    skills: asSkills(parsed['skills'] ?? []),
    educationIds: asIdList(parsed['educationIds'] ?? [], 'educationIds is not a list of ids'),
    rewrites: asRewrites(parsed['rewrites'] ?? []),
    ...(typeof summary === 'string' && summary.trim() !== '' ? { summary: summary.trim() } : {}),
  };
};
