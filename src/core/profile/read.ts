/**
 * Reads a resume into a draft `Profile` locally — no model, no key, no request.
 *
 * The same shape as `prompt/jobspec.ts`: a heuristic pass that handles ordinary
 * input for nothing, with a model call held in reserve for input it cannot
 * follow (`prompt/import.ts`). Resumes are more regular than job postings —
 * headings, date ranges, bullet markers — so the floor here is higher.
 *
 * It reads structure, never meaning. Every string in the result is a substring
 * of what the user pasted; nothing is summarised, expanded or inferred. Where
 * the shape is ambiguous the reader leaves the field blank and the editor asks,
 * which is the whole reason an import is a draft (D-060, D-068).
 *
 * @see docs/architecture.md §4a
 */

import { isBlankDate, splitDateRange, toDateRange } from './dates';
import { formatBulletId, formatId } from './ids';
import { TITLE_NOUNS } from '../prompt/vocabulary';
import { AppError } from '../types';
import type { Bullet, Contact, Education, Experience, Profile, Project, SkillGroup } from '../types';

/** Below this there is no structure to find. Lower than the model path's floor: this costs nothing. */
export const MIN_READABLE_CHARS = 80;

/** What the reader could not establish. Drives the offer to try a model instead. */
export type ResumeGap = 'contact' | 'experience' | 'bullets' | 'dates' | 'skills';

export interface ResumeReading {
  readonly profile: Profile;
  readonly gaps: readonly ResumeGap[];
  /** 0–1. A weighted count of what was found, not a probability. */
  readonly confidence: number;
}

type SectionKind = 'header' | 'summary' | 'experience' | 'projects' | 'education' | 'skills' | 'ignored';

/**
 * Section headings, by what they mean rather than by exact wording.
 *
 * Matched against the whole line, lower-cased and stripped of punctuation, so
 * "PROFESSIONAL EXPERIENCE" and "Experience:" land in the same place.
 */
const HEADINGS: readonly (readonly [RegExp, SectionKind])[] = [
  [/^(summary|profile|objective|about( me)?|professional summary|career (summary|objective))$/, 'summary'],
  [/^((work|professional|relevant|industry) )?(experience|employment|history|work history)$/, 'experience'],
  [/^((personal|selected|side|technical|key) )?projects?$/, 'projects'],
  [/^(education|academics?|academic background|qualifications)$/, 'education'],
  [/^((technical|core|key) )?(skills|competencies|technologies|tech stack|toolkit)$/, 'skills'],
  [/^(certifications?|awards?|publications?|interests|hobbies|references|volunteering|languages spoken)$/, 'ignored'],
];

const BULLET_MARKER = /^\s*(?:[-•*▪‣·◦●○–—]|\d+[.)])\s+/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/;
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+\/?/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+(?:\/[\w.-]+)?\/?/i;
const URL = /(?:https?:\/\/)?(?:www\.)?[\w-]+\.[a-z]{2,}(?:\/\S*)?/i;
const DEGREE = /\b(bachelors?|masters?|b\.?\s?(?:s|sc|a|e|tech)\b|m\.?\s?(?:s|sc|a|e|tech)\b|ph\.?\s?d|mba|diploma|associate)\b/i;
const GRADE = /\b(?:gpa|cgpa)\b[:\s]*([\d.]+(?:\s*\/\s*[\d.]+)?)|\b(\d\.\d{1,2}\s*\/\s*\d{1,2})\b|\b(\d{2,3}(?:\.\d+)?%)/i;
const INSTITUTION = /\b(university|college|institute|school|academy|polytechnic)\b/i;

const normaliseHeading = (line: string): string =>
  line
    .toLowerCase()
    .replace(/[:•|—–-]+\s*$/, '')
    .replace(/^[^a-z]+/, '')
    .trim();

const headingKind = (line: string): SectionKind | undefined => {
  // A heading is short and stands alone. Long lines that happen to start with
  // "Experience" are prose, not structure.
  if (line.length > 45) return undefined;
  const text = normaliseHeading(line);
  return HEADINGS.find(([pattern]) => pattern.test(text))?.[1];
};

const isBullet = (line: string): boolean => BULLET_MARKER.test(line);
const stripMarker = (line: string): string => line.replace(BULLET_MARKER, '').trim();

/** One block of lines under one heading. */
interface Section {
  readonly kind: SectionKind;
  readonly lines: readonly string[];
}

const splitSections = (lines: readonly string[]): readonly Section[] => {
  const sections: { kind: SectionKind; lines: string[] }[] = [{ kind: 'header', lines: [] }];
  for (const line of lines) {
    const kind = headingKind(line);
    if (kind !== undefined) sections.push({ kind, lines: [] });
    else sections[sections.length - 1]?.lines.push(line);
  }
  return sections;
};

/**
 * A run of lines describing one thing: some header lines, then its bullets.
 *
 * A bullet always belongs to whatever came before it. A non-bullet line after
 * bullets have started means the next entry has begun — that boundary is what
 * makes an unlabelled list of roles readable without per-resume rules.
 */
interface Entry {
  readonly headers: readonly string[];
  readonly bullets: readonly string[];
}

const splitEntries = (lines: readonly string[]): readonly Entry[] => {
  const entries: { headers: string[]; bullets: string[] }[] = [];
  let current: { headers: string[]; bullets: string[] } | undefined;

  for (const line of lines) {
    if (isBullet(line)) {
      if (current === undefined) current = { headers: [], bullets: [] };
      current.bullets.push(stripMarker(line));
      continue;
    }
    if (current !== undefined && current.bullets.length > 0) {
      entries.push(current);
      current = undefined;
    }
    if (current === undefined) current = { headers: [], bullets: [] };
    current.headers.push(line);
  }
  if (current !== undefined && (current.headers.length > 0 || current.bullets.length > 0)) entries.push(current);
  return entries;
};

const bulletsOf = (texts: readonly string[], parentId: string): Bullet[] =>
  texts
    .filter((line) => line !== '')
    .map((line, index) => ({ id: formatBulletId(parentId, index + 1), text: line }));

/** Splits "Senior Engineer | Northwind Systems" into its parts. */
const parts = (line: string): string[] =>
  line
    .split(/\s+[|·•—–]\s+|\s{3,}|,\s+(?=[A-Z])/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

/**
 * Which half of an entry header is the job title.
 *
 * Titles contain title nouns — engineer, analyst, manager — and company names
 * generally do not. Reuses the vocabulary the job-posting extractor already
 * matches titles with, so both sides of the product agree on what a title
 * looks like.
 */
const readRole = (headers: readonly string[]): { company: string; title: string; location: string; dates: ReturnType<typeof toDateRange> } => {
  let dates = toDateRange('', '');
  const candidates: string[] = [];

  for (const header of headers) {
    const split = splitDateRange(header);
    if (split.dates !== undefined) dates = split.dates;
    candidates.push(...parts(split.rest));
  }

  const titleIndex = candidates.findIndex((part) => TITLE_NOUNS.test(part));
  const title = titleIndex === -1 ? '' : (candidates[titleIndex] ?? '');
  const rest = candidates.filter((_, index) => index !== titleIndex);
  // A location is the part that looks like "City, Country"; everything else in
  // an entry header is the employer.
  const locationIndex = rest.findIndex((part) => /,\s*[A-Z]/.test(part) && part.length < 40 && !INSTITUTION.test(part));
  const location = locationIndex === -1 ? '' : (rest[locationIndex] ?? '');

  return {
    company: rest.filter((_, index) => index !== locationIndex)[0] ?? '',
    title,
    location,
    dates,
  };
};

const optional = <K extends string>(key: K, value: string): { [P in K]?: string } =>
  (value === '' ? {} : { [key]: value }) as { [P in K]?: string };

const readExperience = (lines: readonly string[]): Experience[] =>
  splitEntries(lines)
    .map((entry) => ({ entry, role: readRole(entry.headers) }))
    // An entry naming neither an employer nor a role is a stray line, not a job.
    // Filtered before ids are handed out, so the ids stay contiguous.
    .filter(({ role }) => role.company !== '' || role.title !== '')
    .map(({ entry, role }, index) => {
      const id = formatId('experience', index + 1);
      return {
        id,
        company: role.company,
        title: role.title,
        dates: role.dates,
        ...optional('location', role.location),
        bullets: bulletsOf(entry.bullets, id),
      };
    });

const readProjects = (lines: readonly string[]): Project[] =>
  splitEntries(lines)
    .map((entry) => {
      const headers = entry.headers.map((header) => splitDateRange(header).rest);
      const url = headers.map((header) => URL.exec(header)?.[0]).find((found) => found !== undefined) ?? '';
      return { entry, url, name: parts(headers[0] ?? '').find((part) => part !== url) ?? '' };
    })
    .filter(({ name }) => name !== '')
    .map(({ entry, name, url }, index) => {
      const id = formatId('project', index + 1);
      return { id, name, ...optional('url', url), bullets: bulletsOf(entry.bullets, id) };
    });

const readEducation = (lines: readonly string[]): Education[] =>
  splitEntries(lines)
    .map((entry) => {
      let dates = toDateRange('', '');
      const flat: string[] = [];
      for (const header of [...entry.headers, ...entry.bullets]) {
        const split = splitDateRange(header);
        if (split.dates !== undefined) dates = split.dates;
        flat.push(...parts(split.rest));
      }

      const institution = flat.find((part) => INSTITUTION.test(part)) ?? flat[0] ?? '';
      const degreeLine = flat.find((part) => DEGREE.test(part)) ?? '';
      const degree = DEGREE.exec(degreeLine)?.[0]?.trim() ?? '';
      // "BSc in Computer Science" — the field is what follows the qualification.
      const field = degreeLine.replace(DEGREE, '').replace(/^[\s,]*(?:in|of)\s+/i, '').replace(/[\s,]+$/, '').trim();
      const gradeMatch = GRADE.exec(flat.join(' '));
      const grade = gradeMatch?.[1] ?? gradeMatch?.[2] ?? gradeMatch?.[3] ?? '';

      return { institution, degree, field, dates, grade };
    })
    .filter((entry) => entry.institution !== '')
    .map((entry, index) => ({
      id: formatId('education', index + 1),
      institution: entry.institution,
      degree: entry.degree,
      field: entry.field,
      dates: entry.dates,
      ...optional('grade', entry.grade),
    }));

/**
 * Skills come as "Languages: Go, TypeScript" or as a bare list.
 *
 * A line without a label still holds skills, so it is kept under a generic
 * label rather than dropped — the label is this codebase's word, but every
 * skill in it is the user's.
 */
const readSkills = (lines: readonly string[]): SkillGroup[] => {
  const groups: SkillGroup[] = [];
  for (const raw of lines) {
    const line = stripMarker(raw);
    if (line === '') continue;

    const colon = line.indexOf(':');
    const label = colon === -1 ? 'Skills' : line.slice(0, colon).trim();
    const skills = (colon === -1 ? line : line.slice(colon + 1))
      .split(/[,;|·•]/)
      .map((skill) => skill.trim())
      .filter((skill) => skill !== '' && skill.length < 40);

    if (skills.length > 0 && label !== '') groups.push({ id: formatId('skill', groups.length + 1), label, skills });
  }
  return groups;
};

const readContact = (lines: readonly string[]): Contact => {
  const joined = lines.join('\n');
  const email = EMAIL.exec(joined)?.[0] ?? '';
  const linkedin = LINKEDIN.exec(joined)?.[0] ?? '';
  const github = GITHUB.exec(joined)?.[0] ?? '';

  // The phone pattern is loose enough to match a date or a postcode, so it is
  // only trusted on a line that carries no other contact detail.
  const phoneLine = lines.find((line) => !EMAIL.test(line) && !/linkedin|github|http/i.test(line) && PHONE.test(line) && /\d{3}/.test(line));
  const phone = phoneLine !== undefined && phoneLine.replace(/\D/g, '').length >= 7 ? (PHONE.exec(phoneLine)?.[0]?.trim() ?? '') : '';

  const fullName =
    lines.find(
      (line) =>
        !EMAIL.test(line) &&
        !/\d/.test(line) &&
        !/linkedin|github|http|@/i.test(line) &&
        line.split(/\s+/).length <= 5 &&
        line.length > 2 &&
        line.length < 45,
    ) ?? '';

  const location = lines.find((line) => line !== fullName && /^[A-Za-z .'-]+,\s*[A-Za-z .'-]+$/.test(line) && line.length < 45) ?? '';

  return {
    fullName,
    email,
    ...optional('phone', phone),
    ...optional('location', location),
    ...optional('linkedin', linkedin),
    ...optional('github', github),
  };
};

const gapsOf = (profile: Profile): ResumeGap[] => {
  const gaps: ResumeGap[] = [];
  if (profile.contact.fullName === '' || profile.contact.email === '') gaps.push('contact');
  if (profile.experience.length === 0) gaps.push('experience');
  else if (profile.experience.every((role) => role.bullets.length === 0)) gaps.push('bullets');
  if (profile.experience.some((role) => isBlankDate(role.dates.start))) gaps.push('dates');
  if (profile.skills.length === 0) gaps.push('skills');
  return gaps;
};

const confidenceOf = (profile: Profile, gaps: readonly ResumeGap[]): number => {
  const bullets = profile.experience.reduce((total, role) => total + role.bullets.length, 0);
  const found = [
    profile.contact.fullName !== '' && profile.contact.email !== '',
    profile.experience.length > 0,
    bullets >= 3,
    profile.education.length > 0,
    profile.skills.length > 0,
  ].filter(Boolean).length;
  return Number(Math.max(0, found / 5 - gaps.length * 0.05).toFixed(2));
};

/**
 * Parses a resume locally. Costs nothing and never calls a provider.
 *
 * @throws {AppError} `PROFILE_EMPTY` when there is too little text to read.
 */
export const readResume = (resumeText: string): ResumeReading => {
  const text = resumeText.trim();
  if (text.length < MIN_READABLE_CHARS) {
    throw new AppError('PROFILE_EMPTY', {
      userMessage: 'That is too short to read as a resume. Paste the whole thing, including your roles and bullets.',
      action: 'edit_profile',
    });
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, '').trim())
    .filter((line) => line !== '');
  const sections = splitSections(lines);
  const linesOf = (kind: SectionKind): readonly string[] => sections.filter((s) => s.kind === kind).flatMap((s) => s.lines);

  const summary = linesOf('summary').map(stripMarker).join(' ').trim();
  const profile: Profile = {
    version: 1,
    contact: readContact(linesOf('header')),
    education: readEducation(linesOf('education')),
    experience: readExperience(linesOf('experience')),
    projects: readProjects(linesOf('projects')),
    skills: readSkills(linesOf('skills')),
    ...(summary !== '' ? { summary } : {}),
    updatedAt: new Date().toISOString(),
  };

  const gaps = gapsOf(profile);
  return { profile, gaps, confidence: confidenceOf(profile, gaps) };
};

/**
 * Whether the model path is worth offering for this resume.
 *
 * Missing dates or skills never justify it on their own — those are fields the
 * editor can ask for in seconds. No roles, or roles with no bullets, means the
 * layout defeated the reader and there is nothing to tailor.
 */
export const needsModelImport = (reading: ResumeReading): boolean =>
  reading.gaps.includes('experience') || reading.gaps.includes('bullets') || reading.confidence < 0.5;
