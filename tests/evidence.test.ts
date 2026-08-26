import { describe, expect, it } from 'vitest';
import {
  extractNumbers,
  extractProperNouns,
  normaliseNumber,
  unknownIds,
  validateRewrites,
} from '../src/core/validate/evidence';
import type { Bullet, Profile, TailoringPlan } from '../src/core/types';

const profileWith = (...bullets: Bullet[]): Profile => ({
  version: 1,
  contact: { fullName: 'Test User', email: 't@example.com' },
  education: [{ id: 'ed1', institution: 'A Uni', degree: 'BE', field: 'CS', dates: { start: '2020-08', end: '2024-06' } }],
  experience: [{ id: 'e1', company: 'Acme', title: 'SDE', dates: { start: '2024-07', end: 'present' }, bullets }],
  projects: [{ id: 'p1', name: 'Sideline', bullets: [{ id: 'p1b1', text: 'built a static site generator' }] }],
  skills: [{ id: 's1', label: 'Languages', skills: ['Go', 'TypeScript'] }],
  updatedAt: '2026-08-26T00:00:00.000Z',
});

/** A plan whose only content is the rewrites under test. */
const planWith = (...rewrites: { id: string; text: string }[]): TailoringPlan => ({
  experience: [],
  projects: [],
  skills: [],
  rewrites,
  educationIds: [],
});

const check = (source: Bullet, rewritten: string) =>
  validateRewrites(planWith({ id: source.id, text: rewritten }), profileWith(source));

const unsupported = (source: Bullet, rewritten: string) => check(source, rewritten).map((i) => i.unsupported);

describe('validateRewrites — invented metrics', () => {
  it('rejects a metric the source never claimed', () => {
    const source: Bullet = { id: 'e1b1', text: 'improved API response time' };
    const issues = check(source, 'Reduced API response time by 40%');

    expect(issues).toHaveLength(1);
    expect(issues[0]?.unsupported).toBe('40%');
    expect(issues[0]?.bulletId).toBe('e1b1');
    expect(issues[0]?.original).toBe('improved API response time');
    expect(issues[0]?.rewritten).toBe('Reduced API response time by 40%');
  });

  it('rejects a detail the source lacks, even when the metric checks out', () => {
    const source: Bullet = { id: 'e1b1', text: 'reduced latency 40%' };
    // p99 is the fabrication: the source measured latency, not tail latency.
    expect(unsupported(source, 'Reduced p99 latency by 40% by adding a read-through cache')).toEqual(['p99']);
  });

  it('rejects a fabricated percentile even when the same digits appear elsewhere', () => {
    const source: Bullet = { id: 'e1b1', text: 'cut p50 latency by 99ms' };
    expect(unsupported(source, 'Cut p99 latency by 99ms')).toEqual(['p99']);
  });

  it('accepts a percentile the source actually measured', () => {
    const source: Bullet = { id: 'e1b1', text: 'cut p99 latency by 99ms' };
    expect(check(source, 'Cut p99 latency by 99ms')).toEqual([]);
  });

  it('accepts the same rewrite once evidence backs the detail', () => {
    const source: Bullet = {
      id: 'e1b1',
      text: 'reduced latency 40%',
      evidence: ['p99 tail latency, measured over a week', 'added a read-through cache in front of the DB'],
    };
    expect(check(source, 'Reduced p99 latency by 40% by adding a read-through cache')).toEqual([]);
  });

  it('accepts a number that lives only in evidence — that is what evidence is for', () => {
    const source: Bullet = { id: 'e1b1', text: 'cut cloud spend', evidence: ['from $1.2M to $900k annually'] };
    expect(check(source, 'Cut cloud spend by $1.2M a year')).toEqual([]);
  });

  it('treats a different unit as a different claim', () => {
    const source: Bullet = { id: 'e1b1', text: 'cut cold-start time 40 ms' };
    expect(unsupported(source, 'Cut cold-start time by 40%')).toEqual(['40%']);
  });

  it('treats a different magnitude as a different claim', () => {
    const source: Bullet = { id: 'e1b1', text: 'served 12k requests per second' };
    expect(unsupported(source, 'Served 12M requests per second')).toEqual(['12M']);
  });

  it('reports each unsupported claim once, however often it repeats', () => {
    const source: Bullet = { id: 'e1b1', text: 'sped up the nightly job' };
    expect(unsupported(source, 'Sped the nightly job up 3x, a 3x win for the team')).toEqual(['3x']);
  });
});

describe('validateRewrites — number normalisation', () => {
  it('matches thousands separators, scaled forms and approximations', () => {
    const source: Bullet = {
      id: 'e1b1',
      text: 'onboarded 1,200 merchants, processed $1.2M, sped up sync 10x, around 15 regions',
    };
    expect(check(source, 'Onboarded 1200 merchants and processed 1.2 million, a 10x sync speedup across ~15 regions')).toEqual([]);
  });

  it('matches a range written the same way in both', () => {
    const source: Bullet = { id: 'e1b1', text: 'ran a 3-5 person team' };
    expect(check(source, 'Ran a team of 3 to 5 engineers')).toEqual([]);
  });
});

describe('validateRewrites — proper nouns', () => {
  it('rejects a technology that appears only in the rewrite', () => {
    const source: Bullet = { id: 'e1b1', text: 'deployed services onto the shared cluster' };
    expect(unsupported(source, 'Deployed services onto Kubernetes')).toEqual(['Kubernetes']);
  });

  it('rejects an acronym that appears only in the rewrite', () => {
    const source: Bullet = { id: 'e1b1', text: 'migrated the pipeline to managed infrastructure' };
    expect(unsupported(source, 'Migrated the pipeline to AWS Glue')).toEqual(['AWS', 'Glue']);
  });

  it('accepts a proper noun the source already contains, ignoring case and punctuation', () => {
    const source: Bullet = { id: 'e1b1', text: 'built the CI/CD pipeline on a kubernetes-based runner' };
    expect(check(source, 'Built CI/CD on Kubernetes')).toEqual([]);
  });

  it('does not flag a capitalised verb opening the bullet', () => {
    const source: Bullet = { id: 'e1b1', text: 'led migration of the billing service' };
    expect(check(source, 'Led the billing service migration')).toEqual([]);
    expect(check(source, 'Built the billing service migration')).toEqual([]);
    // Not on the verb list, but unmistakably a past-tense opener.
    expect(check(source, 'Orchestrated the billing service migration')).toEqual([]);
  });

  it('still flags a proper noun that happens to open the bullet', () => {
    const source: Bullet = { id: 'e1b1', text: 'moved deployments onto the shared cluster' };
    expect(unsupported(source, 'Kubernetes deployments moved onto the shared cluster')).toEqual(['Kubernetes']);
  });
});

describe('validateRewrites — scope', () => {
  it('validates rewrites against project bullets too', () => {
    const plan = planWith({ id: 'p1b1', text: 'Built a static site generator in Rust' });
    expect(validateRewrites(plan, profileWith()).map((i) => i.unsupported)).toEqual(['Rust']);
  });

  it('stays silent about a rewrite whose id is unknown — there is no original to show', () => {
    const plan = planWith({ id: 'e9b9', text: 'Invented 500 things at Globex' });
    expect(validateRewrites(plan, profileWith())).toEqual([]);
    expect(unknownIds(plan, profileWith())).toEqual(['e9b9']);
  });

  it('returns nothing for a plan with no rewrites', () => {
    expect(validateRewrites(planWith(), profileWith())).toEqual([]);
  });
});

describe('unknownIds', () => {
  const profile = profileWith({ id: 'e1b1', text: 'shipped things' });

  it('accepts a plan that references only real items', () => {
    const plan: TailoringPlan = {
      experience: [{ id: 'e1', bulletIds: ['e1b1'] }],
      projects: [{ id: 'p1', bulletIds: ['p1b1'] }],
      skills: [{ id: 's1', skills: ['Go'] }],
      rewrites: [{ id: 'e1b1', text: 'Shipped things' }],
      educationIds: ['ed1'],
    };
    expect(unknownIds(plan, profile)).toEqual([]);
  });

  it('catches a fabricated id in every position a plan can hide one', () => {
    const plan: TailoringPlan = {
      experience: [{ id: 'e7', bulletIds: ['e1b1', 'e9b9'] }],
      projects: [{ id: 'p1', bulletIds: ['p4b1'] }],
      skills: [{ id: 's8', skills: [] }],
      rewrites: [{ id: 'e9b9', text: 'Something' }],
      educationIds: ['ed3'],
    };
    expect(unknownIds(plan, profile)).toEqual(['e7', 'e9b9', 'p4b1', 's8', 'ed3']);
  });
});

describe('normaliseNumber', () => {
  it('collapses separators and scale words to one key', () => {
    expect(normaliseNumber('1,200')).toBe(normaliseNumber('1200'));
    expect(normaliseNumber('$1.2M')).toBe(normaliseNumber('1.2 million'));
    expect(normaliseNumber('2.5k')).toBe('2500');
    expect(normaliseNumber('1.2bn')).toBe('1200000000');
    expect(normaliseNumber('~15')).toBe('15');
  });

  it('keeps units apart', () => {
    expect(normaliseNumber('40%')).toBe(normaliseNumber('40 percent'));
    expect(normaliseNumber('40%')).not.toBe(normaliseNumber('40'));
    expect(normaliseNumber('10x')).not.toBe(normaliseNumber('10'));
    expect(normaliseNumber('40 ms')).toBe('40');
  });

  it('keeps an alphabetic prefix in the key, but not a trailing unit', () => {
    expect(normaliseNumber('p99')).not.toBe(normaliseNumber('99'));
    expect(normaliseNumber('p99')).not.toBe(normaliseNumber('p50'));
    expect(normaliseNumber('P99')).toBe(normaliseNumber('p99'));
    expect(normaliseNumber('S3')).not.toBe(normaliseNumber('3'));
    // A suffixed unit is not a prefix.
    expect(normaliseNumber('40ms')).toBe(normaliseNumber('40'));
  });

  it('returns null when there is no number', () => {
    expect(normaliseNumber('Kubernetes')).toBeNull();
    expect(normaliseNumber('')).toBeNull();
  });
});

describe('extractNumbers', () => {
  it('finds numbers wherever they hide', () => {
    expect(extractNumbers('cut p99 latency 40% across 3 regions')).toEqual(['p99', '40%', '3']);
    expect(extractNumbers('$1.2M saved on 12 S3 buckets')).toEqual(['1.2M', '12', 'S3']);
    expect(extractNumbers('40ms cold start')).toEqual(['40']);
  });

  it('finds nothing in prose', () => {
    expect(extractNumbers('improved API response time')).toEqual([]);
  });
});

describe('extractProperNouns', () => {
  it('picks out names and acronyms', () => {
    expect(extractProperNouns('Migrated billing from Postgres to DynamoDB using AWS DMS')).toEqual([
      'Postgres',
      'DynamoDB',
      'AWS',
      'DMS',
    ]);
  });

  it('ignores ordinary words, wherever they sit', () => {
    expect(extractProperNouns('Led the team and shipped it')).toEqual([]);
    expect(extractProperNouns('Reduced cost. The team then grew.')).toEqual([]);
  });

  it('does not treat bare numbers as names', () => {
    expect(extractProperNouns('cut latency by 40% in 2026')).toEqual([]);
  });
});
