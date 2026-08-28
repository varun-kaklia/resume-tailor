/**
 * Reads an existing resume into a draft `Profile`.
 *
 * One call, on the user's own key, and nothing it returns is saved: the draft
 * goes straight into the profile editor, where every field is visible and
 * editable before the first save. The model is transcribing here, not writing —
 * it restructures text it was shown and is told, in the same words as the
 * tailoring prompt, that it may not add a fact.
 *
 * Two things it is never allowed to produce:
 * - **Role notes.** There is no `note` field in the response shape. A note is
 *   the user's own words about their own circumstances (D-024); a model that
 *   guessed one from a date gap would be inventing exactly the kind of fact
 *   that matters most.
 * - **IDs.** Assigned locally from `profile/ids`, so the permanence rule
 *   (invariant 4) stays a property of this codebase rather than a request.
 *
 * @see docs/architecture.md §5, docs/backlog.md P-19
 */

import { toDateRange } from '../profile/dates';
import { formatBulletId, formatId } from '../profile/ids';
import { AppError } from '../types';
import type {
  Bullet,
  CompletionRequest,
  Contact,
  Education,
  Experience,
  Profile,
  Project,
  SkillGroup,
} from '../types';

/**
 * Output budget.
 *
 * The response is close to the resume in length — it is the same text, in
 * fields — so this is roughly double a long two-page CV and is a cap on a
 * runaway response rather than a target.
 */
export const DEFAULT_IMPORT_MAX_OUTPUT_TOKENS = 4000;

/** Shorter than this is not a resume, and the call would be wasted money. */
export const MIN_RESUME_CHARS = 200;

/** Longer than this and most models truncate their own answer mid-JSON. */
export const MAX_RESUME_CHARS = 20000;

const SYSTEM = [
  'You read a resume and return what it contains as structured data.',
  'You are transcribing, not writing. You never compose a resume.',
  '',
  'Rules:',
  '1. Keep the candidate\'s own wording. Do not improve, shorten or rephrase a bullet.',
  '2. Never add a fact. Every number, tool, employer and title must appear in the text',
  '   you were given. If something is absent, leave the field out — do not guess it.',
  '3. Dates are "YYYY-MM", or "present" for anything ongoing. Convert "Mar 2022" to',
  '   "2022-03". If a date is not in the text, use "" rather than an approximation.',
  '4. One entry in "bullets" per achievement line, in the order they appear.',
  '5. Put a headline or professional summary in "summary". If there is none, omit it.',
  '   Never write one.',
  '',
  'Reply with a single JSON object and nothing else. No prose, no code fences.',
  '{"contact":{"fullName":"","email":"","phone":"","location":"","linkedin":"","github":"","website":""},',
  ' "summary":"",',
  ' "experience":[{"company":"","title":"","start":"2022-03","end":"present","location":"","bullets":[""]}],',
  ' "projects":[{"name":"","url":"","stack":[""],"bullets":[""]}],',
  ' "education":[{"institution":"","degree":"","field":"","start":"","end":"","grade":""}],',
  ' "skills":[{"label":"Languages","skills":[""]}]}',
  '',
  'Use [] for a section the resume does not have. Omit any field you cannot fill.',
].join('\n');

export interface ImportOptions {
  readonly maxOutputTokens?: number;
}

/**
 * @throws {AppError} `PROFILE_EMPTY` when there is too little text to be a
 *   resume, `CONTEXT_TOO_LARGE` when there is too much to come back intact.
 */
export const buildImportRequest = (resumeText: string, options: ImportOptions = {}): CompletionRequest => {
  const text = resumeText.trim();

  if (text.length < MIN_RESUME_CHARS) {
    throw new AppError('PROFILE_EMPTY', {
      userMessage: 'That is too short to read as a resume. Paste the whole thing, including your roles and bullets.',
      action: 'edit_profile',
    });
  }
  if (text.length > MAX_RESUME_CHARS) {
    throw new AppError('CONTEXT_TOO_LARGE', {
      userMessage: `That is ${text.length.toLocaleString()} characters — longer than this can read in one pass. Paste your resume rather than a full CV or portfolio.`,
      action: 'none',
    });
  }

  return {
    system: SYSTEM,
    user: `RESUME\n${text}`,
    expectJson: true,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_IMPORT_MAX_OUTPUT_TOKENS,
    temperature: 0,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Missing, wrongly-typed and blank all collapse to `''` — the editor asks for it either way. */
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const textList = (value: unknown): string[] => list(value).map(text).filter((entry) => entry !== '');

/** Set an optional field only when there is something to put in it (`exactOptionalPropertyTypes`). */
const optional = <K extends string>(key: K, value: string): { [P in K]?: string } =>
  (value === '' ? {} : { [key]: value }) as { [P in K]?: string };

const bullets = (value: unknown, parentId: string): Bullet[] =>
  textList(value).map((line, index) => ({ id: formatBulletId(parentId, index + 1), text: line }));

/** An entry with nothing in the field that names it is a stray object, not a role. */
const named = <T>(entries: readonly unknown[], nameOf: (entry: Record<string, unknown>) => string, build: (entry: Record<string, unknown>, id: string) => T, kind: 'experience' | 'project' | 'education' | 'skill'): T[] => {
  const kept: T[] = [];
  for (const raw of entries) {
    if (!isRecord(raw) || nameOf(raw) === '') continue;
    kept.push(build(raw, formatId(kind, kept.length + 1)));
  }
  return kept;
};

const contactOf = (value: unknown): Contact => {
  const raw = isRecord(value) ? value : {};
  return {
    fullName: text(raw['fullName']),
    email: text(raw['email']),
    ...optional('phone', text(raw['phone'])),
    ...optional('location', text(raw['location'])),
    ...optional('linkedin', text(raw['linkedin'])),
    ...optional('github', text(raw['github'])),
    ...optional('website', text(raw['website'])),
  };
};

/**
 * Turns a response into a draft profile.
 *
 * Lenient on purpose, in the same spirit as `parse.ts`: a section that came
 * back malformed is dropped rather than failing the whole import, because the
 * user is about to see every field anyway and re-running costs them another
 * call. The only hard failure is a response that is not a JSON object at all.
 *
 * @throws {AppError} `BAD_RESPONSE_SHAPE`
 */
export const parseImportedProfile = (raw: string): Profile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrap(raw));
  } catch (cause) {
    throw new AppError('BAD_RESPONSE_SHAPE', {
      userMessage: 'The model did not return readable data for that resume. Try again, or switch to a stronger model.',
      cause,
    });
  }
  if (!isRecord(parsed)) {
    throw new AppError('BAD_RESPONSE_SHAPE', {
      userMessage: 'The model did not return readable data for that resume. Try again, or switch to a stronger model.',
    });
  }

  const experience: Experience[] = named(
    list(parsed['experience']),
    (entry) => text(entry['company']) || text(entry['title']),
    (entry, id) => ({
      id,
      company: text(entry['company']),
      title: text(entry['title']),
      dates: toDateRange(entry['start'], entry['end']),
      ...optional('location', text(entry['location'])),
      bullets: bullets(entry['bullets'], id),
    }),
    'experience',
  );

  const projects: Project[] = named(
    list(parsed['projects']),
    (entry) => text(entry['name']),
    (entry, id) => {
      const stack = textList(entry['stack']);
      return {
        id,
        name: text(entry['name']),
        ...optional('url', text(entry['url'])),
        ...(stack.length > 0 ? { stack } : {}),
        bullets: bullets(entry['bullets'], id),
      };
    },
    'project',
  );

  const education: Education[] = named(
    list(parsed['education']),
    (entry) => text(entry['institution']),
    (entry, id) => ({
      id,
      institution: text(entry['institution']),
      degree: text(entry['degree']),
      field: text(entry['field']),
      dates: toDateRange(entry['start'], entry['end']),
      ...optional('grade', text(entry['grade'])),
      ...optional('location', text(entry['location'])),
    }),
    'education',
  );

  const skills: SkillGroup[] = named(
    list(parsed['skills']),
    (entry) => text(entry['label']),
    (entry, id) => ({ id, label: text(entry['label']), skills: textList(entry['skills']) }),
    'skill',
  );

  const summary = text(parsed['summary']);

  return {
    version: 1,
    contact: contactOf(parsed['contact']),
    education,
    experience,
    projects,
    skills,
    ...(summary !== '' ? { summary } : {}),
    updatedAt: new Date().toISOString(),
  };
};

/** Same packaging faults, same recovery, same reasoning as `parse.ts` (D-029). */
const unwrap = (raw: string): string => {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const inner = (fenced?.[1] ?? trimmed).trim();
  if (inner.startsWith('{')) return inner;

  const start = inner.indexOf('{');
  const end = inner.lastIndexOf('}');
  return start !== -1 && end > start ? inner.slice(start, end + 1) : inner;
};

export { SYSTEM as IMPORT_SYSTEM_PROMPT };
