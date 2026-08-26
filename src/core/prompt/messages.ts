/**
 * Turns a `ProfileIndex` and a `JobSpec` into one completion request.
 *
 * Two formats, chosen separately. The prompt is line-oriented because braces
 * and quotes are tokens that carry no meaning on the way in; the response is
 * JSON because it has to be parsed. The system message is fixed text so it
 * caches well across calls, and everything that varies sits in the user
 * message.
 *
 * @see docs/architecture.md §6
 */

import { AppError } from '../types';
import type { CompletionRequest, JobSpec, ProfileIndex } from '../types';

/**
 * Output budget.
 *
 * A plan is a few hundred tokens of ids plus one rewritten line per selected
 * bullet, so this is roughly double a realistic worst case — enough that a
 * long plan is never truncated mid-JSON, low enough to cap a runaway response.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1500;

export interface PromptOptions {
  /** Free-text steer from the user, e.g. "lead with the data work". */
  readonly emphasis?: string;
  readonly maxOutputTokens?: number;
}

const SYSTEM = [
  'You tailor an existing resume to a job. You never write a new one.',
  '',
  'You are given a candidate index (ids and shortened bullet text) and a job spec.',
  'Select which items to include, order them, and reword selected bullets.',
  '',
  'Rules:',
  '1. Use only the ids given. Never invent an id.',
  '2. Never add a fact. No number, percentage, technology, employer or metric may',
  '   appear in a rewrite unless it is already in that bullet. Rewrites containing',
  '   unsupported detail are rejected and discarded.',
  '3. Reword only bullets you select. Leave a bullet out of "rewrites" to keep it as is.',
  '4. Shape each rewrite as: accomplished X, measured by Y, by doing Z. Keep the',
  '   measurement only if the original has one. Never add one.',
  '5. Lead with a strong past-tense verb. Prefer the job spec\'s wording where the',
  '   candidate text already means the same thing.',
  '6. This resume must fit one page. Prefer fewer, stronger bullets.',
  '7. Keep each rewrite to roughly the length of the original.',
  '',
  'Reply with a single JSON object and nothing else. No prose, no code fences.',
  '{"experience":[{"id":"e1","bulletIds":["e1b2","e1b1"]}],',
  ' "projects":[{"id":"p1","bulletIds":["p1b1"]}],',
  ' "skills":[{"id":"s1","skills":["Go","TypeScript"]}],',
  ' "educationIds":["d1"],',
  ' "rewrites":[{"id":"e1b2","text":"Cut checkout latency by adding a read-through cache"}],',
  ' "summary":"optional one line"}',
  '',
  'Every key except "summary" is required; use [] when a section has nothing.',
].join('\n');

const requirementLine = (spec: JobSpec, weight: 'must' | 'nice'): string | undefined => {
  const terms = spec.requirements.filter((requirement) => requirement.weight === weight);
  return terms.length > 0 ? `${weight}: ${terms.map((requirement) => requirement.term).join(', ')}` : undefined;
};

const jobBlock = (spec: JobSpec): string => {
  const lines = [
    'JOB',
    spec.seniority === undefined ? spec.title : `${spec.title} (${spec.seniority})`,
    requirementLine(spec, 'must'),
    requirementLine(spec, 'nice'),
    spec.keywords.length > 0 ? `keywords: ${spec.keywords.join(', ')}` : undefined,
  ];
  return lines.filter((line): line is string => line !== undefined).join('\n');
};

const candidateBlock = (index: ProfileIndex): string => {
  const lines = ['CANDIDATE'];
  for (const item of index.items) {
    lines.push(`[${item.id}] ${item.label}`);
    for (const bullet of item.bullets) lines.push(`${bullet.id} ${bullet.text}`);
  }
  return lines.join('\n');
};

const skillsBlock = (index: ProfileIndex): string => {
  const lines = ['SKILLS'];
  for (const group of index.skills) lines.push(`[${group.id}] ${group.label}: ${group.skills.join(', ')}`);
  return lines.join('\n');
};

const educationBlock = (educationIds: readonly string[]): string => `EDUCATION\n${educationIds.join(', ')}`;

/**
 * Assembles the request.
 *
 * Education ids are passed separately rather than through the index: the model
 * only needs to know they exist so it can order them, and the institutions and
 * dates behind them are joined locally at render.
 *
 * @throws {AppError} `PROFILE_EMPTY` when there is nothing to select from.
 */
export const buildTailoringRequest = (
  index: ProfileIndex,
  spec: JobSpec,
  educationIds: readonly string[],
  options: PromptOptions = {},
): CompletionRequest => {
  if (index.items.length === 0) throw new AppError('PROFILE_EMPTY');

  const blocks = [jobBlock(spec), candidateBlock(index)];
  if (index.skills.length > 0) blocks.push(skillsBlock(index));
  if (educationIds.length > 0) blocks.push(educationBlock(educationIds));

  const emphasis = options.emphasis?.trim();
  if (emphasis !== undefined && emphasis !== '') blocks.push(`EMPHASIS\n${emphasis}`);

  return {
    system: SYSTEM,
    user: blocks.join('\n\n'),
    expectJson: true,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: 0,
  };
};

export { SYSTEM as TAILORING_SYSTEM_PROMPT };
