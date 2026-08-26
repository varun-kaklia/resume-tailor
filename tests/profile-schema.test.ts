import { describe, expect, it } from 'vitest';
import { nextBulletId, nextId, parseId } from '../src/core/profile/ids';
import { MAX_NOTE_CHARS, assertTailorable, emptyProfile, validateProfile } from '../src/core/profile/schema';
import { AppError } from '../src/core/types';
import type { Profile } from '../src/core/types';

const valid: Profile = {
  version: 1,
  contact: { fullName: 'Test User', email: 't@example.com' },
  education: [
    { id: 'd1', institution: 'A University', degree: 'B.Tech', field: 'CS', dates: { start: '2020-08', end: '2024-05' } },
  ],
  experience: [
    {
      id: 'e1',
      company: 'Acme',
      title: 'SDE',
      dates: { start: '2024-06', end: 'present' },
      bullets: [{ id: 'e1b1', text: 'Cut build time from 9 minutes to 3 by parallelising the test suite.' }],
    },
  ],
  projects: [{ id: 'p1', name: 'Tailor', bullets: [{ id: 'p1b1', text: 'Built a thing.' }] }],
  skills: [{ id: 's1', label: 'Languages', skills: ['TypeScript', 'Go'] }],
  updatedAt: '2026-08-26T00:00:00.000Z',
};

/** Structural edit that deliberately bypasses the type — the point is validating unknown input. */
const withPatch = (patch: Record<string, unknown>): unknown => ({ ...valid, ...patch });

const pathsOf = (input: unknown): readonly string[] => {
  const result = validateProfile(input);
  return result.ok ? [] : result.issues.map((issue) => issue.path);
};

/** The error code a call throws, or `undefined` if it returns. */
const codeThrownBy = (call: () => void): string | undefined => {
  try {
    call();
    return undefined;
  } catch (thrown) {
    return thrown instanceof AppError ? thrown.code : 'not an AppError';
  }
};

describe('validateProfile', () => {
  it('accepts a well-formed profile', () => {
    const result = validateProfile(valid);
    expect(result.ok).toBe(true);
  });

  it('reports every issue at once, with a dotted path and a readable message', () => {
    const result = validateProfile(
      withPatch({
        contact: { fullName: '', email: 'not-an-email' },
        experience: [{ ...valid.experience[0], bullets: [{ id: 'e1b1', text: '  ' }] }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.path)).toEqual([
      'contact.fullName',
      'contact.email',
      'experience[0].bullets[0].text',
    ]);
    for (const issue of result.issues) expect(issue.message).toMatch(/^[A-Z].+\.$/);
  });

  it('rejects a malformed YearMonth', () => {
    const dates = { start: '2024-13', end: 'present' };
    expect(pathsOf(withPatch({ education: [{ ...valid.education[0], dates }] }))).toEqual(['education[0].dates.start']);
    expect(pathsOf(withPatch({ education: [{ ...valid.education[0], dates: { start: 'Aug 2024', end: '2025-01' } }] }))).toEqual([
      'education[0].dates.start',
    ]);
  });

  it('rejects an end before its start, but never an ongoing role', () => {
    const backwards = { ...valid.education[0], dates: { start: '2024-05', end: '2023-05' } };
    expect(pathsOf(withPatch({ education: [backwards] }))).toEqual(['education[0].dates.end']);
    expect(validateProfile(withPatch({ education: [{ ...valid.education[0], dates: { start: '2024-05', end: 'present' } }] })).ok).toBe(true);
  });

  it('rejects duplicate IDs anywhere in the profile', () => {
    const clash = { ...valid.skills[0], id: 'd1' };
    expect(pathsOf(withPatch({ skills: [clash] }))).toEqual(['skills[0].id']);

    const twoBullets = {
      ...valid.experience[0],
      bullets: [{ id: 'e1b1', text: 'One.' }, { id: 'e1b1', text: 'Two.' }],
    };
    expect(pathsOf(withPatch({ experience: [twoBullets] }))).toEqual(['experience[0].bullets[1].id']);
  });

  it('rejects a bullet ID that does not belong to its parent', () => {
    const strays = { ...valid.experience[0], bullets: [{ id: 'e2b1', text: 'Belongs elsewhere.' }] };
    expect(pathsOf(withPatch({ experience: [strays] }))).toEqual(['experience[0].bullets[0].id']);
  });

  it('rejects a version it does not know', () => {
    expect(pathsOf(withPatch({ version: 2 }))).toEqual(['version']);
  });
});

describe('assertTailorable', () => {
  it('throws PROFILE_EMPTY with nothing to tailor', () => {
    expect(codeThrownBy(() => assertTailorable({ ...valid, experience: [], projects: [] }))).toBe('PROFILE_EMPTY');
    expect(codeThrownBy(() => assertTailorable({ ...valid, experience: [] }))).toBeUndefined();
  });
});

describe('emptyProfile', () => {
  it('is a blank the user still has to fill in', () => {
    const blank = emptyProfile();
    expect(blank.version).toBe(1);
    expect(validateProfile(blank).ok).toBe(false);
  });
});

describe('ids', () => {
  it('parses each kind, and rejects bullets on kinds that hold none', () => {
    expect(parseId('e1')).toEqual({ kind: 'experience', index: 1, bullet: undefined });
    expect(parseId('p2b13')).toEqual({ kind: 'project', index: 2, bullet: 13 });
    expect(parseId('d1')?.kind).toBe('education');
    expect(parseId('s1b1')).toBeUndefined();
    expect(parseId('e0')).toBeUndefined();
    expect(parseId('x1')).toBeUndefined();
  });

  it('never reuses an ID after a deletion', () => {
    const three: Profile = {
      ...valid,
      experience: ['e1', 'e2', 'e3'].map((id) => ({ ...valid.experience[0]!, id })),
    };
    const afterDeletingE2: Profile = {
      ...three,
      experience: three.experience.filter((role) => role.id !== 'e2'),
    };
    expect(nextId(afterDeletingE2, 'experience')).toBe('e4');
  });

  it('counts each kind separately, starting at 1', () => {
    const blank = emptyProfile();
    expect(nextId(blank, 'experience')).toBe('e1');
    expect(nextId(blank, 'project')).toBe('p1');
    expect(nextId(valid, 'skill')).toBe('s2');
    expect(nextId(valid, 'education')).toBe('d2');
  });

  it('numbers bullets within their parent, without reuse', () => {
    const role = { ...valid.experience[0]!, bullets: [{ id: 'e1b1', text: 'a' }, { id: 'e1b4', text: 'b' }] };
    const profile: Profile = { ...valid, experience: [role] };
    expect(nextBulletId(profile, 'e1')).toBe('e1b5');
    expect(nextBulletId(profile, 'p1')).toBe('p1b2');
  });

  it('refuses to number a bullet for a parent that is gone', () => {
    expect(codeThrownBy(() => nextBulletId(valid, 'e9'))).toBe('UNKNOWN_ITEM_ID');
  });
});

describe('role notes', () => {
  const withNote = (note: unknown): unknown => ({
    ...valid,
    experience: [{ ...valid.experience[0], note }],
  });

  it('accepts any wording the user chooses', () => {
    expect(validateProfile(withNote('Contract engagement via an agency.')).ok).toBe(true);
  });

  it('accepts a profile with no note at all', () => {
    expect(validateProfile(valid).ok).toBe(true);
  });

  it('rejects a present-but-blank note, which would render as a stray gap', () => {
    const result = validateProfile(withNote('   '));
    expect(result.ok).toBe(false);
  });

  it('rejects a note long enough to eat the page', () => {
    expect(validateProfile(withNote('x'.repeat(MAX_NOTE_CHARS + 1))).ok).toBe(false);
  });

  it('accepts a note exactly at the cap', () => {
    expect(validateProfile(withNote('x'.repeat(MAX_NOTE_CHARS))).ok).toBe(true);
  });
});
