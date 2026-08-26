/**
 * Model fallback for postings the heuristics could not read.
 *
 * Two things keep this cheap. The request carries a trimmed slice of the
 * posting rather than all of it, and it asks only for the fields that are
 * actually missing — a posting with clear requirements but no recognisable
 * title costs one short question, not a re-parse. Whatever the heuristics did
 * establish is kept; the model fills gaps and never overwrites.
 *
 * @see docs/architecture.md §6
 */

import { AppError } from '../types';
import type { CompletionRequest, JobSpec, Requirement, Seniority } from '../types';
import type { Extraction, ExtractionGap } from './jobspec';

/**
 * How much of the posting the model sees.
 *
 * Titles and requirement lists sit near the top; the tail is benefits, legal
 * boilerplate and application instructions. Sending 2000 characters costs
 * roughly a third of the full budget and loses almost nothing that matters.
 */
export const FALLBACK_CHARS = 2000;

export const FALLBACK_MAX_OUTPUT_TOKENS = 300;

const SENIORITIES: readonly Seniority[] = ['intern', 'junior', 'mid', 'senior', 'staff', 'lead'];

const FIELD_INSTRUCTIONS: Readonly<Record<ExtractionGap, string>> = {
  title: '"title": the role name, as the posting words it',
  requirements: '"must" and "nice": technology and skill names, required and optional. Names only, no sentences.',
  company: '"company": the hiring company name, or omit if the posting does not say',
};

/**
 * Builds a request for the missing fields only.
 *
 * @throws {AppError} `PROFILE_INVALID` is not used here; a caller that asks for
 *   nothing gets `JD_NOT_FOUND`, since there is no question to ask.
 */
export const buildJobSpecRequest = (postingText: string, extraction: Extraction): CompletionRequest => {
  if (extraction.gaps.length === 0) throw new AppError('JD_NOT_FOUND', { context: { why: 'no gaps to fill' } });

  const asked = extraction.gaps.map((gap) => FIELD_INSTRUCTIONS[gap]);

  return {
    system: [
      'You read a job posting and return facts from it as JSON.',
      'Never infer, never generalise, never invent. If the posting does not say, omit the key.',
      'Reply with one JSON object and nothing else.',
    ].join('\n'),
    user: [
      `Return JSON with exactly these keys where the posting supports them:\n${asked.map((line) => `- ${line}`).join('\n')}`,
      '',
      'POSTING',
      postingText.trim().slice(0, FALLBACK_CHARS),
    ].join('\n'),
    expectJson: true,
    maxOutputTokens: FALLBACK_MAX_OUTPUT_TOKENS,
    temperature: 0,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asTerms = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim()] : []))
    : [];

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/**
 * Merges a model response into the heuristic result.
 *
 * Only gaps are filled. A field the heuristics found is never replaced, because
 * a value read from the posting's own structure is better evidence than one a
 * model produced, and letting the model overwrite would make the cheap path
 * pointless.
 *
 * @throws {AppError} `BAD_RESPONSE_SHAPE` when the reply is not JSON.
 */
export const mergeJobSpecResponse = (extraction: Extraction, raw: string): JobSpec => {
  let parsed: unknown;
  try {
    const text = raw.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    parsed = JSON.parse((fenced?.[1] ?? text).trim());
  } catch (cause) {
    throw new AppError('BAD_RESPONSE_SHAPE', { cause });
  }
  if (!isRecord(parsed)) throw new AppError('BAD_RESPONSE_SHAPE', { context: { why: 'not an object' } });

  const { spec, gaps } = extraction;
  const known = new Set(spec.requirements.map((requirement) => requirement.term.toLowerCase()));

  const added: Requirement[] = [];
  if (gaps.includes('requirements')) {
    for (const [key, weight] of [['must', 'must'], ['nice', 'nice']] as const) {
      for (const term of asTerms(parsed[key])) {
        if (known.has(term.toLowerCase())) continue;
        known.add(term.toLowerCase());
        added.push({ term, weight });
      }
    }
  }

  const title = gaps.includes('title') ? asText(parsed['title']) : undefined;
  const company = gaps.includes('company') && spec.company === undefined ? asText(parsed['company']) : undefined;
  const seniority = asText(parsed['seniority'])?.toLowerCase();

  return {
    ...spec,
    ...(title !== undefined ? { title } : {}),
    ...(company !== undefined ? { company } : {}),
    ...(spec.seniority === undefined && seniority !== undefined && SENIORITIES.includes(seniority as Seniority)
      ? { seniority: seniority as Seniority }
      : {}),
    requirements: [...spec.requirements, ...added],
    heuristicOnly: false,
  };
};
