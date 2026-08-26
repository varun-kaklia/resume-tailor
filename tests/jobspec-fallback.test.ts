import { describe, expect, it } from 'vitest';
import { extractJobSpec, needsModelFallback } from '../src/core/prompt/jobspec';
import { FALLBACK_CHARS, buildJobSpecRequest, mergeJobSpecResponse } from '../src/core/prompt/jobspec-fallback';
import { AppError } from '../src/core/types';
import type { Extraction } from '../src/core/prompt/jobspec';
import type { JobPosting } from '../src/core/types';

const posting = (text: string): JobPosting => ({ text, capturedAt: '2026-08-26T00:00:00.000Z', source: 'page' });

const UNSTRUCTURED = `
Hey everyone, our team is growing again and we would love to find someone who can
help us keep everything running smoothly as we take on more customers this year.
The work is varied and no two weeks look quite the same around here, which is
something most of the people on the team say they genuinely enjoy about it.
You would be joining a friendly group that values curiosity over credentials.
`;

const STRUCTURED = `
Senior Backend Engineer
Requirements
- 5+ years of backend experience building services that scale
- Strong proficiency in Go and PostgreSQL for transactional workloads
- Comfortable operating production systems on Kubernetes day to day
Responsibilities
- Own the reliability of our billing platform end to end for customers
`;

const extract = (text: string): Extraction => extractJobSpec(posting(text));

describe('the fallback is a last resort', () => {
  it('is not reached for a posting the heuristics read cleanly', () => {
    expect(needsModelFallback(extract(STRUCTURED))).toBe(false);
  });

  it('refuses to build a request when nothing is missing', () => {
    const complete: Extraction = { ...extract(STRUCTURED), gaps: [] };

    expect(() => buildJobSpecRequest(STRUCTURED, complete)).toThrowError(AppError);
  });

  it('is reached for a posting with no structure', () => {
    expect(needsModelFallback(extract(UNSTRUCTURED))).toBe(true);
  });
});

describe('buildJobSpecRequest sends the smallest useful payload', () => {
  it('asks only for the fields that are missing', () => {
    const partial: Extraction = { ...extract(STRUCTURED), gaps: ['company'] };
    const { user } = buildJobSpecRequest(STRUCTURED, partial);

    expect(user).toContain('"company"');
    expect(user).not.toContain('"title"');
    expect(user).not.toContain('"must"');
  });

  it('asks for everything when the heuristics found nothing', () => {
    const { user } = buildJobSpecRequest(UNSTRUCTURED, extract(UNSTRUCTURED));

    expect(user).toContain('"title"');
    expect(user).toContain('"must"');
  });

  it('truncates a long posting rather than sending all of it', () => {
    const long = `${STRUCTURED}\n${'Additional boilerplate about benefits and legal notices. '.repeat(200)}`;
    const { user } = buildJobSpecRequest(long, { ...extract(STRUCTURED), gaps: ['company'] });

    expect(user.length).toBeLessThan(FALLBACK_CHARS + 400);
    expect(long.length).toBeGreaterThan(FALLBACK_CHARS * 2);
  });

  it('requests JSON deterministically on a small output budget', () => {
    const request = buildJobSpecRequest(UNSTRUCTURED, extract(UNSTRUCTURED));

    expect(request.expectJson).toBe(true);
    expect(request.temperature).toBe(0);
    expect(request.maxOutputTokens).toBeLessThanOrEqual(300);
  });

  it('tells the model not to infer', () => {
    expect(buildJobSpecRequest(UNSTRUCTURED, extract(UNSTRUCTURED)).system.toLowerCase()).toContain('never infer');
  });
});

describe('mergeJobSpecResponse fills gaps without overwriting', () => {
  const heuristic = extract(STRUCTURED);

  it('keeps a title the heuristics already found', () => {
    const merged = mergeJobSpecResponse(
      { ...heuristic, gaps: ['company'] },
      '{"title":"Completely Different Title","company":"Northwind Labs"}',
    );

    expect(merged.title).toBe('Senior Backend Engineer');
    expect(merged.company).toBe('Northwind Labs');
  });

  it('keeps requirements the heuristics already found and appends new ones', () => {
    const merged = mergeJobSpecResponse(
      { ...heuristic, gaps: ['requirements'] },
      '{"must":["Terraform"],"nice":["gRPC"]}',
    );
    const terms = merged.requirements.map((requirement) => requirement.term);

    expect(terms).toContain('Go');
    expect(terms).toContain('Terraform');
    expect(merged.requirements.find((r) => r.term === 'gRPC')?.weight).toBe('nice');
  });

  it('does not duplicate a term the heuristics already had', () => {
    const merged = mergeJobSpecResponse({ ...heuristic, gaps: ['requirements'] }, '{"must":["go","Go","PostgreSQL"]}');
    const gos = merged.requirements.filter((requirement) => requirement.term.toLowerCase() === 'go');

    expect(gos).toHaveLength(1);
  });

  it('ignores a field that was not asked for', () => {
    const merged = mergeJobSpecResponse({ ...heuristic, gaps: ['company'] }, '{"company":"Acme","must":["Rust"]}');

    expect(merged.requirements.map((requirement) => requirement.term)).not.toContain('Rust');
  });

  it('rejects an invalid seniority rather than trusting it', () => {
    const merged = mergeJobSpecResponse({ ...heuristic, gaps: ['company'] }, '{"company":"Acme","seniority":"wizard"}');

    expect(merged.seniority).toBe('senior');
  });

  it('marks the result as no longer free', () => {
    expect(heuristic.spec.heuristicOnly).toBe(true);
    expect(mergeJobSpecResponse({ ...heuristic, gaps: ['company'] }, '{"company":"Acme"}').heuristicOnly).toBe(false);
  });

  it('preserves the source hash so the cache key still matches', () => {
    const merged = mergeJobSpecResponse({ ...heuristic, gaps: ['company'] }, '{"company":"Acme"}');

    expect(merged.sourceHash).toBe(heuristic.spec.sourceHash);
  });

  it('accepts a fenced response', () => {
    expect(mergeJobSpecResponse({ ...heuristic, gaps: ['company'] }, '```json\n{"company":"Acme"}\n```').company).toBe('Acme');
  });

  it.each([
    ['prose', 'I could not determine the company.'],
    ['a JSON array', '[1,2,3]'],
    ['an empty response', ''],
  ])('rejects %s as BAD_RESPONSE_SHAPE', (_what, raw) => {
    try {
      mergeJobSpecResponse({ ...heuristic, gaps: ['company'] }, raw);
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect((thrown as AppError).code).toBe('BAD_RESPONSE_SHAPE');
      expect((thrown as AppError).userMessage).toMatch(/\w/);
    }
  });

  it('tolerates a response that omits keys it could not answer', () => {
    const merged = mergeJobSpecResponse({ ...heuristic, gaps: ['company'] }, '{}');

    expect(merged.company).toBeUndefined();
    expect(merged.title).toBe('Senior Backend Engineer');
  });
});
