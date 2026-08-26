import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_OUTPUT_TOKENS, buildTailoringRequest } from '../src/core/prompt/messages';
import { buildProfileIndex } from '../src/core/prompt/profile-index';
import { AppError } from '../src/core/types';
import type { JobSpec, Profile } from '../src/core/types';

const NOTE_MARKER = 'NOTEMARKER';
const COMPANY_MARKER = 'COMPANYMARKER';
const EVIDENCE_MARKER = 'EVIDENCEMARKER';
const EMAIL_MARKER = 'EMAILMARKER';

const profile: Profile = {
  version: 1,
  contact: { fullName: 'NAMEMARKER', email: EMAIL_MARKER, phone: 'PHONEMARKER' },
  education: [
    {
      id: 'd1',
      institution: 'INSTITUTIONMARKER',
      degree: 'DEGREEMARKER',
      field: 'FIELDMARKER',
      dates: { start: '2016-08', end: '2020-05' },
    },
  ],
  experience: [
    {
      id: 'e1',
      company: COMPANY_MARKER,
      title: 'Backend Engineer',
      dates: { start: '2021-01', end: 'present' },
      note: `Personal context: ${NOTE_MARKER}`,
      bullets: [
        { id: 'e1b1', text: 'Rebuilt the ingest pipeline', evidence: [EVIDENCE_MARKER], tags: ['Go'] },
        { id: 'e1b2', text: 'Cut nightly batch runtime' },
      ],
    },
  ],
  projects: [{ id: 'p1', name: 'Ledger CLI', bullets: [{ id: 'p1b1', text: 'Wrote a double-entry ledger' }] }],
  skills: [{ id: 's1', label: 'Languages', skills: ['Go', 'TypeScript'] }],
  updatedAt: '2026-08-26T00:00:00.000Z',
};

const spec: JobSpec = {
  title: 'Platform Engineer',
  seniority: 'senior',
  requirements: [
    { term: 'go', weight: 'must' },
    { term: 'kubernetes', weight: 'must' },
    { term: 'terraform', weight: 'nice' },
  ],
  keywords: ['observability', 'ci/cd'],
  sourceHash: 'abc123',
  heuristicOnly: true,
};

const build = (profileToUse: Profile = profile, options = {}) =>
  buildTailoringRequest(buildProfileIndex(profileToUse), spec, ['d1'], options);

describe('buildTailoringRequest', () => {
  it('produces a deterministic JSON request', () => {
    const request = build();

    expect(request.expectJson).toBe(true);
    expect(request.temperature).toBe(0);
    expect(request.maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it('includes the job, the ids and the bullet text the model selects from', () => {
    const { user } = build();

    expect(user).toContain('Platform Engineer (senior)');
    expect(user).toContain('must: go, kubernetes');
    expect(user).toContain('nice: terraform');
    expect(user).toContain('keywords: observability, ci/cd');
    expect(user).toContain('[e1] Backend Engineer');
    expect(user).toContain('e1b1 Rebuilt the ingest pipeline');
    expect(user).toContain('[s1] Languages: Go, TypeScript');
    expect(user).toContain('d1');
  });

  it('keeps the system message identical across calls so it caches', () => {
    const other: JobSpec = { ...spec, title: 'Different Role', sourceHash: 'zzz' };

    expect(build().system).toBe(buildTailoringRequest(buildProfileIndex(profile), other, ['d1']).system);
  });

  it('appends user emphasis when given, and omits the section when not', () => {
    expect(build(profile, { emphasis: '  lead with the data work  ' }).user).toContain(
      'EMPHASIS\nlead with the data work',
    );
    expect(build().user).not.toContain('EMPHASIS');
    expect(build(profile, { emphasis: '   ' }).user).not.toContain('EMPHASIS');
  });

  it('honours an output budget override', () => {
    expect(build(profile, { maxOutputTokens: 400 }).maxOutputTokens).toBe(400);
  });

  it('refuses to build a request with nothing to select from', () => {
    const empty: Profile = { ...profile, experience: [], projects: [] };

    expect(() => build(empty)).toThrowError(expect.objectContaining({ code: 'PROFILE_EMPTY' }) as Error);
    try {
      build(empty);
    } catch (thrown) {
      expect((thrown as AppError).userMessage).toMatch(/\w/);
    }
  });

  it('omits an empty section rather than sending an empty header', () => {
    const { user } = build({ ...profile, skills: [] });

    expect(user).not.toContain('SKILLS');
  });
});

describe('nothing private reaches the wire', () => {
  const request = build(profile, { emphasis: 'lead with the data work' });
  const payload = `${request.system}\n${request.user}`;

  it('never sends a role note', () => {
    expect(profile.experience[0]?.note).toContain(NOTE_MARKER);
    expect(payload).not.toContain(NOTE_MARKER);
  });

  it.each([
    ['employer', COMPANY_MARKER],
    ['bullet evidence', EVIDENCE_MARKER],
    ['email', EMAIL_MARKER],
    ['name', 'NAMEMARKER'],
    ['phone', 'PHONEMARKER'],
    ['institution', 'INSTITUTIONMARKER'],
    ['degree', 'DEGREEMARKER'],
    ['field of study', 'FIELDMARKER'],
  ])('never sends the %s', (_what, marker) => {
    expect(payload).not.toContain(marker);
  });

  it('never sends employment dates', () => {
    expect(payload).not.toContain('2021-01');
    expect(payload).not.toContain('2016-08');
    expect(payload).not.toContain('present');
  });

  it('sends no note even when every role carries one', () => {
    const noted: Profile = {
      ...profile,
      experience: profile.experience.map((role) => ({ ...role, note: `note ${role.id} ${NOTE_MARKER}` })),
    };

    expect(build(noted).user).not.toContain(NOTE_MARKER);
  });

  it('leaves JobSpec fields that exist for the UI out of the prompt', () => {
    const rich: JobSpec = {
      ...spec,
      responsibilities: ['RESPONSIBILITYMARKER own the billing platform end to end'],
      location: 'LOCATIONMARKER',
      workMode: 'hybrid',
      minYearsExperience: 7,
    };
    const { user } = buildTailoringRequest(buildProfileIndex(profile), rich, ['d1']);

    // These help the reviewer and local scoring; the model judges relevance from
    // requirements and keywords, so sending them would be paid-for noise.
    expect(user).not.toContain('RESPONSIBILITYMARKER');
    expect(user).not.toContain('LOCATIONMARKER');
    expect(user).not.toContain('hybrid');
  });

  it('sends no note when the note is the only place a word appears', () => {
    const noted: Profile = {
      ...profile,
      experience: [{ ...profile.experience[0]!, note: 'sabbatical' }],
    };

    expect(build(noted).user.toLowerCase()).not.toContain('sabbatical');
  });
});
