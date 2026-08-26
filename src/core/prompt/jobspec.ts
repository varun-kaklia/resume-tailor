/**
 * Turns a captured job posting into a `JobSpec` without calling a model.
 *
 * Postings are formatted for people, but the parts that matter for tailoring —
 * the title, the technologies, which of them are optional — are announced by
 * conventional headings that almost every board follows. Reading those headings
 * is cheap, deterministic, and repeatable, so it is the primary path. The model
 * is a fallback for postings that do not follow the conventions, and it is
 * asked only for what is missing.
 *
 * @see docs/architecture.md §6
 */

import { AppError, MAX_JD_CHARS, MIN_JD_CHARS } from '../types';
import type { JobPosting, JobSpec, Requirement, Seniority, WorkMode } from '../types';
import {
  AMBIGUOUS_TERMS,
  CLOSING_HEADINGS,
  MUST_HEADINGS,
  NICE_HEADINGS,
  NICE_INLINE,
  PROSE_HEADINGS,
  RESPONSIBILITY_HEADINGS,
  SKILL_TERMS,
  TECH_CONTEXT,
  TITLE_NOUNS,
} from './vocabulary';

/** What a heuristic pass could not establish. Drives the fallback decision. */
export type ExtractionGap = 'title' | 'requirements' | 'company';

export interface Extraction {
  readonly spec: JobSpec;
  /** 0–1. Not a probability, just a weighted count of what was found. */
  readonly confidence: number;
  readonly gaps: readonly ExtractionGap[];
}

/** Below this, a posting is worth a model call. */
export const CONFIDENCE_THRESHOLD = 0.5;

const MAX_RESPONSIBILITIES = 8;
const MAX_RESPONSIBILITY_CHARS = 160;
const MAX_KEYWORDS = 12;

/**
 * FNV-1a. Deterministic, synchronous, and dependency-free.
 *
 * `crypto.subtle` is async and platform-bound, which `core` is not allowed to
 * be. This hash only has to detect that a posting is unchanged, so collision
 * resistance is irrelevant.
 */
const hash = (text: string): string => {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
};

// --- Line and section handling ---------------------------------------------

type SectionKind = 'must' | 'nice' | 'responsibilities' | 'other';

interface Section {
  readonly kind: SectionKind;
  readonly lines: readonly string[];
}

/** Strips list markers, markdown emphasis and the non-breaking spaces boards emit. */
const cleanLine = (line: string): string =>
  line
    .replace(/ /g, ' ')
    .replace(/^[\s>]*[-*•·▪◦‣–—]+\s*/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/[*_`]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const HEADING_MAX_WORDS = 8;

/**
 * A heading is short, and matches a known phrase once trailing punctuation is
 * gone. The length test matters: postings often open a sentence with
 * "Responsibilities include managing…", which is prose, not a heading.
 */
const headingKind = (line: string): SectionKind | 'closing' | undefined => {
  const text = line.replace(/[:：]\s*$/, '').toLowerCase().trim();
  if (text === '' || text.split(/\s+/).length > HEADING_MAX_WORDS) return undefined;

  const matches = (list: readonly string[]): boolean => list.some((h) => text === h || text.startsWith(`${h} `) || text.startsWith(`${h}:`));
  if (matches(NICE_HEADINGS)) return 'nice';
  if (matches(MUST_HEADINGS)) return 'must';
  if (matches(RESPONSIBILITY_HEADINGS)) return 'responsibilities';
  if (matches(CLOSING_HEADINGS) || matches(PROSE_HEADINGS)) return 'closing';
  return undefined;
};

const splitSections = (lines: readonly string[]): Section[] => {
  const sections: Section[] = [];
  let kind: SectionKind = 'other';
  let buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length > 0) sections.push({ kind, lines: buffer });
    buffer = [];
  };

  for (const line of lines) {
    const found = headingKind(line);
    if (found === undefined) {
      buffer.push(line);
      continue;
    }
    flush();
    kind = found === 'closing' ? 'other' : found;
  }
  flush();
  return sections;
};

// --- Skill matching --------------------------------------------------------

const escape = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Longest first, so `spring boot` wins over `spring` and `react native` over
 * `react`. Boundaries are hand-rolled because `\b` is wrong for terms ending in
 * `+` or `#` and for `.net`.
 */
const SKILL_PATTERN = new RegExp(
  `(?<![\\w+#.])(${Object.keys(SKILL_TERMS).sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\w+#-])`,
  'gi',
);

/**
 * Canonical skills mentioned in `text`.
 *
 * Ambiguous terms are only accepted when the line also carries a technical
 * signal, which is what keeps "go to the careers page" out of a requirements
 * list.
 */
const skillsIn = (text: string): Set<string> => {
  const found = new Set<string>();
  for (const line of text.split('\n')) {
    const technical = TECH_CONTEXT.test(line);
    for (const match of line.matchAll(SKILL_PATTERN)) {
      const raw = (match[1] ?? '').toLowerCase();
      const canonical = SKILL_TERMS[raw];
      if (canonical === undefined) continue;
      if (AMBIGUOUS_TERMS.has(raw) && !technical) continue;
      found.add(canonical);
    }
  }
  return found;
};

/** Requirements, weighted by the section they appeared in and any inline hedge. */
const requirementsFrom = (sections: readonly Section[]): Requirement[] => {
  const weights = new Map<string, 'must' | 'nice'>();

  for (const section of sections) {
    if (section.kind === 'responsibilities' || section.kind === 'other') continue;
    for (const line of section.lines) {
      const weight = section.kind === 'nice' || NICE_INLINE.test(line) ? 'nice' : 'must';
      for (const skill of skillsIn(line)) {
        // A term named as required anywhere outranks the same term mentioned as optional.
        if (weight === 'must' || !weights.has(skill)) weights.set(skill, weight);
      }
    }
  }

  return [...weights].map(([term, weight]) => ({ term, weight }));
};

// --- Individual fields -----------------------------------------------------

const LABELLED = (labels: readonly string[]): RegExp =>
  new RegExp(`^\\s*(?:${labels.join('|')})\\s*[:：]\\s*(.+)$`, 'i');

const TITLE_LABEL = LABELLED(['job title', 'title', 'position', 'role', 'job']);
const COMPANY_LABEL = LABELLED(['company', 'employer', 'organisation', 'organization', 'client']);
const LOCATION_LABEL = LABELLED(['location', 'based in', 'office', 'work location']);

const firstLabelled = (lines: readonly string[], pattern: RegExp): string | undefined => {
  for (const line of lines) {
    const value = pattern.exec(line)?.[1]?.trim();
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
};

const TITLE_MAX_WORDS = 12;

/**
 * Labelled title first; otherwise the first early line that reads like a role
 * name. Boards that render a bare title as the first line are the common case,
 * and a line naming a role and short enough to be a heading is a safe bet.
 */
const extractTitle = (lines: readonly string[]): string | undefined => {
  const labelled = firstLabelled(lines, TITLE_LABEL);
  if (labelled !== undefined) return labelled;

  for (const line of lines.slice(0, 8)) {
    const words = line.split(/\s+/).length;
    if (words <= TITLE_MAX_WORDS && TITLE_NOUNS.test(line) && !/[.!?]$/.test(line)) return line;
  }
  return undefined;
};

const COMPANY_PHRASE = /\b(?:at|join|with)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})(?:\s+(?:is|as|we|to)\b|[,.]|$)/;
const COMPANY_IS_HIRING = /^([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s+is\s+(?:hiring|looking|seeking)/;

const extractCompany = (lines: readonly string[]): string | undefined => {
  const labelled = firstLabelled(lines, COMPANY_LABEL);
  if (labelled !== undefined) return labelled;

  for (const line of lines.slice(0, 12)) {
    const hiring = COMPANY_IS_HIRING.exec(line)?.[1];
    if (hiring !== undefined) return hiring.trim();

    const phrase = COMPANY_PHRASE.exec(line)?.[1];
    if (phrase !== undefined && phrase.split(/\s+/).length <= 4) return phrase.trim();
  }
  return undefined;
};

const WORK_MODE: readonly (readonly [RegExp, WorkMode])[] = [
  [/\b(?:fully\s+)?remote(?:-first|\s+first)?\b/i, 'remote'],
  [/\bhybrid\b/i, 'hybrid'],
  [/\b(?:on-?site|in-?office|in-?person)\b/i, 'onsite'],
];

const extractWorkMode = (text: string): WorkMode | undefined =>
  WORK_MODE.find(([pattern]) => pattern.test(text))?.[1];

const PLACE = /\b([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*),\s*([A-Z]{2}\b|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/;

const extractLocation = (lines: readonly string[]): string | undefined => {
  const labelled = firstLabelled(lines, LOCATION_LABEL);
  if (labelled !== undefined) return labelled;

  for (const line of lines.slice(0, 12)) {
    const match = PLACE.exec(line);
    if (match !== null) return `${match[1] ?? ''}, ${match[2] ?? ''}`;
  }
  return undefined;
};

/**
 * Ordered most specific first: `senior staff engineer` must read as staff, and
 * `senior` must not be found inside `senior` while `sr.` is also present.
 */
const SENIORITY: readonly (readonly [RegExp, Seniority])[] = [
  [/\b(?:intern(?:ship)?|trainee)\b/i, 'intern'],
  [/\b(?:principal|staff|distinguished)\b/i, 'staff'],
  [/\b(?:tech(?:nical)?\s+lead|team\s+lead|lead\s+engineer|engineering\s+lead)\b/i, 'lead'],
  [/\b(?:senior|sr\.?)\b/i, 'senior'],
  [/\b(?:junior|jr\.?|entry[-\s]level|graduate|new\s+grad|associate)\b/i, 'junior'],
  [/\bmid[-\s]?(?:level|senior)?\b/i, 'mid'],
];

const extractSeniority = (title: string | undefined, text: string): Seniority | undefined => {
  const fromTitle = title === undefined ? undefined : SENIORITY.find(([pattern]) => pattern.test(title))?.[1];
  return fromTitle ?? SENIORITY.find(([pattern]) => pattern.test(text))?.[1];
};

const YEARS = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*\+?\s*years?\b/i;

const extractYears = (text: string): number | undefined => {
  const value = YEARS.exec(text)?.[1];
  if (value === undefined) return undefined;
  const years = Number(value);
  return Number.isFinite(years) && years > 0 && years <= 30 ? years : undefined;
};

const extractResponsibilities = (sections: readonly Section[]): string[] =>
  sections
    .filter((section) => section.kind === 'responsibilities')
    .flatMap((section) => section.lines)
    .filter((line) => line.length > 20)
    .slice(0, MAX_RESPONSIBILITIES)
    .map((line) => (line.length > MAX_RESPONSIBILITY_CHARS ? `${line.slice(0, MAX_RESPONSIBILITY_CHARS).trimEnd()}…` : line));

// --- Assembly --------------------------------------------------------------

const score = (spec: JobSpec, hasTitle: boolean): number => {
  const requirements = Math.min(spec.requirements.length, 3) / 3;
  return (
    (hasTitle ? 0.35 : 0) +
    requirements * 0.35 +
    (spec.company !== undefined ? 0.1 : 0) +
    ((spec.responsibilities?.length ?? 0) > 0 ? 0.1 : 0) +
    (spec.seniority !== undefined || spec.minYearsExperience !== undefined ? 0.1 : 0)
  );
};

/**
 * Parses a posting locally. Costs nothing and never calls a provider.
 *
 * @throws {AppError} `JD_NOT_FOUND` when there is no text, `JD_TOO_SHORT` when
 *   there is too little of it to be a posting.
 */
export const extractJobSpec = (posting: JobPosting): Extraction => {
  const source = posting.text.trim();
  if (source === '') throw new AppError('JD_NOT_FOUND');
  if (source.length < MIN_JD_CHARS) throw new AppError('JD_TOO_SHORT', { context: { chars: source.length } });

  const text = source.slice(0, MAX_JD_CHARS);
  const lines = text.split('\n').map(cleanLine).filter((line) => line !== '');
  const sections = splitSections(lines);
  const body = lines.join('\n');

  const title = extractTitle(lines);
  const requirements = requirementsFrom(sections);
  const company = extractCompany(lines);
  const location = extractLocation(lines);
  const workMode = extractWorkMode(text);
  const seniority = extractSeniority(title, body);
  const minYears = extractYears(body);
  const responsibilities = extractResponsibilities(sections);

  // Anything named in the posting but not in a requirements section still helps
  // ATS matching, so it is offered as a keyword rather than a requirement.
  const claimed = new Set(requirements.map((requirement) => requirement.term));
  const keywords = [...skillsIn(body)].filter((skill) => !claimed.has(skill)).slice(0, MAX_KEYWORDS);

  const spec: JobSpec = {
    title: title ?? 'Untitled role',
    requirements,
    keywords,
    sourceHash: hash(source),
    heuristicOnly: true,
    ...(company !== undefined ? { company } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(workMode !== undefined ? { workMode } : {}),
    ...(seniority !== undefined ? { seniority } : {}),
    ...(minYears !== undefined ? { minYearsExperience: minYears } : {}),
    ...(responsibilities.length > 0 ? { responsibilities } : {}),
  };

  const gaps: ExtractionGap[] = [];
  if (title === undefined) gaps.push('title');
  if (requirements.length < 2) gaps.push('requirements');
  if (company === undefined) gaps.push('company');

  return { spec, confidence: Number(score(spec, title !== undefined).toFixed(2)), gaps };
};

/**
 * Whether a model call is worth the user's money.
 *
 * A missing company alone never justifies one: it is cosmetic, plenty of
 * postings genuinely omit it, and it has no effect on which bullets get chosen.
 * A missing title or a thin requirement list does, because tailoring against
 * either is guesswork.
 */
export const needsModelFallback = (extraction: Extraction): boolean =>
  extraction.gaps.includes('title') ||
  extraction.gaps.includes('requirements') ||
  extraction.confidence < CONFIDENCE_THRESHOLD;
