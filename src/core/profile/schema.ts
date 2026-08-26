/**
 * Runtime validation for the Structured Profile.
 *
 * Hand-rolled guards, no schema library — the shape is small and stable, and a
 * dependency here would buy nothing (docs/memory.md, "Deferred").
 *
 * Nothing in here throws for invalid data: it returns issues carrying a dotted
 * path so the options page can put each message next to the field it belongs
 * to. The caller decides what a failure means.
 */

import { AppError } from '../types';
import type { Profile, YearMonth } from '../types';
import { parseId } from './ids';
import type { ItemKind } from './ids';

export interface FieldIssue {
  /** Dotted path into the profile, e.g. `experience[1].bullets[0].text`. */
  readonly path: string;
  /** Written for a human to read next to the field. */
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly profile: Profile }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

type Add = (path: string, message: string) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const isYearMonth = (value: unknown): value is YearMonth =>
  value === 'present' || (typeof value === 'string' && YEAR_MONTH.test(value));

const requireText = (value: unknown, path: string, label: string, add: Add): void => {
  if (typeof value !== 'string' || value.trim() === '') add(path, `${label} is required.`);
};

const optionalText = (value: unknown, path: string, label: string, add: Add): void => {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    add(path, `${label} must be text, or left out entirely.`);
  }
};

const requireList = (value: unknown, path: string, label: string, add: Add): readonly unknown[] => {
  if (!Array.isArray(value)) {
    add(path, `${label} is missing.`);
    return [];
  }
  return value;
};

const optionalTextList = (value: unknown, path: string, label: string, add: Add): void => {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    add(path, `${label} must be a list of non-empty text entries.`);
  }
};

const validateDates = (value: unknown, path: string, add: Add): void => {
  if (!isRecord(value)) {
    add(path, 'Start and end dates are required.');
    return;
  }
  const start = value['start'];
  const end = value['end'];

  const startOk = isYearMonth(start) && start !== 'present';
  if (!startOk) add(`${path}.start`, 'Start date must be a month, like 2024-03.');

  const endOk = isYearMonth(end);
  if (!endOk) add(`${path}.end`, "End date must be a month like 2024-03, or 'present' if this is ongoing.");

  // Comparing YYYY-MM as strings orders them correctly; 'present' is always the later end.
  if (startOk && endOk && end !== 'present' && typeof start === 'string' && end < start) {
    add(`${path}.end`, 'End date is before the start date.');
  }
};

const claimId = (value: unknown, path: string, kind: ItemKind, seen: Set<string>, add: Add): string | undefined => {
  if (typeof value !== 'string') {
    add(path, 'This item is missing its internal ID. Remove it and add it again.');
    return undefined;
  }
  const parsed = parseId(value);
  if (parsed === undefined || parsed.kind !== kind || parsed.bullet !== undefined) {
    add(path, `"${value}" is not a valid ID for this ${kind} entry.`);
    return undefined;
  }
  if (seen.has(value)) {
    add(path, `Duplicate ID "${value}" — every profile item needs its own.`);
    return undefined;
  }
  seen.add(value);
  return value;
};

const claimBulletId = (value: unknown, path: string, parentId: string, seen: Set<string>, add: Add): void => {
  if (typeof value !== 'string') {
    add(path, 'This bullet point is missing its internal ID. Remove it and add it again.');
    return;
  }
  const parsed = parseId(value);
  if (parsed === undefined || parsed.bullet === undefined || value !== `${parentId}b${parsed.bullet}`) {
    add(path, `"${value}" is not a valid bullet ID for "${parentId}".`);
    return;
  }
  if (seen.has(value)) {
    add(path, `Duplicate ID "${value}" — every bullet point needs its own.`);
    return;
  }
  seen.add(value);
};

const validateBullets = (
  value: unknown,
  path: string,
  parentId: string | undefined,
  seen: Set<string>,
  add: Add,
): void => {
  requireList(value, path, 'Bullet points', add).forEach((raw, i) => {
    const at = `${path}[${i}]`;
    if (!isRecord(raw)) {
      add(at, 'This bullet point could not be read.');
      return;
    }
    if (parentId !== undefined) claimBulletId(raw['id'], `${at}.id`, parentId, seen, add);
    requireText(raw['text'], `${at}.text`, 'Bullet text', add);
    optionalTextList(raw['evidence'], `${at}.evidence`, 'Evidence', add);
    optionalTextList(raw['tags'], `${at}.tags`, 'Tags', add);
  });
};

const validateContact = (value: unknown, add: Add): void => {
  if (!isRecord(value)) {
    add('contact', 'Your contact details are missing.');
    return;
  }
  requireText(value['fullName'], 'contact.fullName', 'Full name', add);

  const email = value['email'];
  if (typeof email !== 'string' || email.trim() === '') add('contact.email', 'Email address is required.');
  else if (!EMAIL.test(email.trim())) add('contact.email', 'That does not look like an email address.');

  for (const field of ['phone', 'location', 'linkedin', 'github', 'website'] as const) {
    optionalText(value[field], `contact.${field}`, field, add);
  }
};

const validateEducation = (value: unknown, seen: Set<string>, add: Add): void => {
  requireList(value, 'education', 'Education', add).forEach((raw, i) => {
    const at = `education[${i}]`;
    if (!isRecord(raw)) {
      add(at, 'This education entry could not be read.');
      return;
    }
    claimId(raw['id'], `${at}.id`, 'education', seen, add);
    requireText(raw['institution'], `${at}.institution`, 'Institution', add);
    requireText(raw['degree'], `${at}.degree`, 'Degree', add);
    requireText(raw['field'], `${at}.field`, 'Field of study', add);
    validateDates(raw['dates'], `${at}.dates`, add);
    optionalText(raw['grade'], `${at}.grade`, 'Grade', add);
    optionalText(raw['location'], `${at}.location`, 'Location', add);
  });
};

/**
 * The longest a role note may be, in characters.
 *
 * A note is one or two lines of context under a role, and it competes with
 * bullets for the only page there is — 240 characters is roughly three rendered
 * lines at the template's default size. The cap is a guard against a pasted
 * paragraph silently eating the resume, not a judgement about what the note
 * should say: the wording is the user's business entirely.
 */
export const MAX_NOTE_CHARS = 240;

/**
 * A note is optional, and free text when present.
 *
 * Deliberately unopinionated: the only rules are that it is a string, that it
 * is not blank-but-present (which renders as a stray gap), and that it fits.
 * Nothing here inspects, suggests, or defaults the content.
 */
const validateNote = (value: unknown, at: string, add: Add): void => {
  if (value === undefined) return;
  if (typeof value !== 'string') {
    add(at, 'This role note could not be read.');
    return;
  }
  if (value.trim() === '') {
    add(at, 'This role note is empty. Write something, or remove it.');
    return;
  }
  if (value.length > MAX_NOTE_CHARS) {
    add(at, `This role note is ${value.length} characters. Keep it under ${MAX_NOTE_CHARS} so it fits on one page.`);
  }
};

const validateExperience = (value: unknown, seen: Set<string>, add: Add): void => {
  requireList(value, 'experience', 'Experience', add).forEach((raw, i) => {
    const at = `experience[${i}]`;
    if (!isRecord(raw)) {
      add(at, 'This role could not be read.');
      return;
    }
    const id = claimId(raw['id'], `${at}.id`, 'experience', seen, add);
    requireText(raw['company'], `${at}.company`, 'Company', add);
    requireText(raw['title'], `${at}.title`, 'Job title', add);
    validateDates(raw['dates'], `${at}.dates`, add);
    optionalText(raw['location'], `${at}.location`, 'Location', add);
    validateNote(raw['note'], `${at}.note`, add);
    validateBullets(raw['bullets'], `${at}.bullets`, id, seen, add);
  });
};

const validateProjects = (value: unknown, seen: Set<string>, add: Add): void => {
  requireList(value, 'projects', 'Projects', add).forEach((raw, i) => {
    const at = `projects[${i}]`;
    if (!isRecord(raw)) {
      add(at, 'This project could not be read.');
      return;
    }
    const id = claimId(raw['id'], `${at}.id`, 'project', seen, add);
    requireText(raw['name'], `${at}.name`, 'Project name', add);
    optionalText(raw['url'], `${at}.url`, 'Project link', add);
    optionalTextList(raw['stack'], `${at}.stack`, 'Stack', add);
    if (raw['dates'] !== undefined) validateDates(raw['dates'], `${at}.dates`, add);
    validateBullets(raw['bullets'], `${at}.bullets`, id, seen, add);
  });
};

const validateSkills = (value: unknown, seen: Set<string>, add: Add): void => {
  requireList(value, 'skills', 'Skills', add).forEach((raw, i) => {
    const at = `skills[${i}]`;
    if (!isRecord(raw)) {
      add(at, 'This skill group could not be read.');
      return;
    }
    claimId(raw['id'], `${at}.id`, 'skill', seen, add);
    requireText(raw['label'], `${at}.label`, 'Skill group label', add);
    const skills = raw['skills'];
    if (!Array.isArray(skills) || skills.length === 0 || skills.some((s) => typeof s !== 'string' || s.trim() === '')) {
      add(`${at}.skills`, 'List at least one skill in this group.');
    }
  });
};

/**
 * Validates unknown input against the `Profile` shape.
 *
 * Collects every issue rather than failing on the first, so the options page
 * can show all of them at once.
 */
export const validateProfile = (input: unknown): ValidationResult => {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '', message: 'This profile could not be read.' }] };
  }

  const issues: FieldIssue[] = [];
  const add: Add = (path, message) => {
    issues.push({ path, message });
  };
  const seen = new Set<string>();

  if (input['version'] !== 1) {
    add('version', 'This profile was saved by a different version of ResumeTailor and cannot be read.');
  }

  validateContact(input['contact'], add);
  validateEducation(input['education'], seen, add);
  validateExperience(input['experience'], seen, add);
  validateProjects(input['projects'], seen, add);
  validateSkills(input['skills'], seen, add);
  optionalText(input['summary'], 'summary', 'Summary', add);

  const updatedAt = input['updatedAt'];
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    add('updatedAt', 'This profile is missing the date it was last edited.');
  }

  return issues.length === 0 ? { ok: true, profile: input as unknown as Profile } : { ok: false, issues };
};

/**
 * A valid profile can still have nothing to tailor. That is a different failure
 * with a different message, so it is a separate check and it throws.
 *
 * @throws {AppError} `PROFILE_EMPTY`
 */
export const assertTailorable = (profile: Profile): void => {
  if (profile.experience.length === 0 && profile.projects.length === 0) throw new AppError('PROFILE_EMPTY');
};

/** A blank profile for a first run. Not valid yet — the user fills it in. */
export const emptyProfile = (): Profile => ({
  version: 1,
  contact: { fullName: '', email: '' },
  education: [],
  experience: [],
  projects: [],
  skills: [],
  updatedAt: new Date().toISOString(),
});
