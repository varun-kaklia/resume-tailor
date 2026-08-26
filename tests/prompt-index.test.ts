import { describe, expect, it } from 'vitest';
import { buildProfileIndex } from '../src/core/prompt/profile-index';
import { INDEX_BULLET_CHARS } from '../src/core/types';
import type { Profile } from '../src/core/types';

/**
 * Every value the model must not see carries a distinct marker, so a leak names
 * the field it came from instead of just failing.
 */
const PRIVATE = {
  note: 'NOTEMARKER',
  company: 'COMPANYMARKER',
  location: 'LOCATIONMARKER',
  email: 'EMAILMARKER',
  phone: 'PHONEMARKER',
  contactLocation: 'CONTACTLOCMARKER',
  linkedin: 'LINKEDINMARKER',
  github: 'GITHUBMARKER',
  website: 'WEBSITEMARKER',
  fullName: 'NAMEMARKER',
  institution: 'INSTITUTIONMARKER',
  degree: 'DEGREEMARKER',
  field: 'FIELDMARKER',
  grade: 'GRADEMARKER',
  evidence: 'EVIDENCEMARKER',
  projectUrl: 'URLMARKER',
  stack: 'STACKMARKER',
  startDate: '2019-03',
  endDate: '2021-11',
} as const;

export const loaded: Profile = {
  version: 1,
  contact: {
    fullName: PRIVATE.fullName,
    email: PRIVATE.email,
    phone: PRIVATE.phone,
    location: PRIVATE.contactLocation,
    linkedin: PRIVATE.linkedin,
    github: PRIVATE.github,
    website: PRIVATE.website,
  },
  education: [
    {
      id: 'd1',
      institution: PRIVATE.institution,
      degree: PRIVATE.degree,
      field: PRIVATE.field,
      grade: PRIVATE.grade,
      dates: { start: PRIVATE.startDate, end: PRIVATE.endDate },
    },
  ],
  experience: [
    {
      id: 'e1',
      company: PRIVATE.company,
      title: 'Backend Engineer',
      location: PRIVATE.location,
      dates: { start: PRIVATE.startDate, end: 'present' },
      note: `Context I chose to explain: ${PRIVATE.note}`,
      bullets: [
        { id: 'e1b1', text: 'Rebuilt the ingest pipeline', evidence: [PRIVATE.evidence], tags: ['Go'] },
        { id: 'e1b2', text: 'Cut nightly batch runtime' },
      ],
    },
  ],
  projects: [
    {
      id: 'p1',
      name: 'Ledger CLI',
      url: PRIVATE.projectUrl,
      stack: [PRIVATE.stack],
      bullets: [{ id: 'p1b1', text: 'Wrote a double-entry ledger' }],
    },
  ],
  skills: [{ id: 's1', label: 'Languages', skills: ['Go', 'TypeScript'] }],
  updatedAt: '2026-08-26T00:00:00.000Z',
};

describe('buildProfileIndex', () => {
  it('carries ids, titles and bullet text', () => {
    const index = buildProfileIndex(loaded);

    expect(index.items.map((item) => item.id)).toEqual(['e1', 'p1']);
    expect(index.items[0]?.label).toBe('Backend Engineer');
    expect(index.items[0]?.kind).toBe('experience');
    expect(index.items[1]?.kind).toBe('project');
    expect(index.items[0]?.bullets.map((bullet) => bullet.id)).toEqual(['e1b1', 'e1b2']);
    expect(index.skills[0]?.skills).toEqual(['Go', 'TypeScript']);
  });

  it('truncates a long bullet on a word boundary', () => {
    const long = 'Migrated the billing platform across regions while keeping every downstream consumer online and correct';
    const index = buildProfileIndex({
      ...loaded,
      experience: [{ ...loaded.experience[0]!, bullets: [{ id: 'e1b1', text: long }] }],
    });

    const text = index.items[0]?.bullets[0]?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(INDEX_BULLET_CHARS);
    expect(long.startsWith(text)).toBe(true);
    expect(text.endsWith(' ')).toBe(false);
  });

  it('collapses whitespace so a multi-line bullet does not waste its budget', () => {
    const index = buildProfileIndex({
      ...loaded,
      experience: [{ ...loaded.experience[0]!, bullets: [{ id: 'e1b1', text: 'Built\n  the\tthing' }] }],
    });

    expect(index.items[0]?.bullets[0]?.text).toBe('Built the thing');
  });

  it('drops items and skill groups with nothing to select', () => {
    const index = buildProfileIndex({
      ...loaded,
      experience: [{ ...loaded.experience[0]!, bullets: [] }],
      skills: [{ id: 's1', label: 'Languages', skills: [] }],
    });

    expect(index.items.map((item) => item.id)).toEqual(['p1']);
    expect(index.skills).toEqual([]);
  });
});

describe('the index excludes everything private', () => {
  const serialised = JSON.stringify(buildProfileIndex(loaded));

  it.each(Object.entries(PRIVATE))('omits %s', (_field, marker) => {
    expect(serialised).not.toContain(marker);
  });

  it('omits the note even though the profile carries one', () => {
    expect(loaded.experience[0]?.note).toContain(PRIVATE.note);
    expect(serialised).not.toContain(PRIVATE.note);
    expect(serialised).not.toContain('note');
  });

  it('carries tags for local scoring, which the prompt builder then leaves out', () => {
    expect(buildProfileIndex(loaded).items[0]?.bullets[0]?.tags).toEqual(['Go']);
  });
});
