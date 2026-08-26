import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../src/core/profile/schema';
import {
  addBullet,
  addEducation,
  addExperience,
  addProject,
  addSkillGroup,
  checkProfile,
  issuesByPath,
  parseSkillList,
  removeBullet,
  removeExperience,
  updateBullet,
  updateExperience,
} from '../src/ui/options/profile-draft';
import type { Profile } from '../src/core/types';

const filled = (): Profile => {
  let profile = addExperience(emptyProfile());
  const role = profile.experience[0]!;
  profile = updateExperience(profile, role.id, { company: 'Acme', title: 'Engineer' });
  profile = addBullet(profile, 'experience', role.id);
  profile = updateBullet(profile, 'experience', role.id, profile.experience[0]!.bullets[0]!.id, 'Shipped a thing');
  return {
    ...profile,
    contact: { fullName: 'Test User', email: 't@example.com' },
  };
};

describe('adding items', () => {
  it('gives each new item a fresh id', () => {
    let profile = addExperience(addExperience(emptyProfile()));
    expect(profile.experience.map((r) => r.id)).toEqual(['e1', 'e2']);

    profile = addProject(addProject(profile));
    expect(profile.projects.map((p) => p.id)).toEqual(['p1', 'p2']);

    profile = addSkillGroup(addEducation(profile));
    expect(profile.education[0]?.id).toBe('d1');
    expect(profile.skills[0]?.id).toBe('s1');
  });

  it('numbers bullets within their parent', () => {
    let profile = addExperience(emptyProfile());
    profile = addBullet(addBullet(profile, 'experience', 'e1'), 'experience', 'e1');

    expect(profile.experience[0]?.bullets.map((b) => b.id)).toEqual(['e1b1', 'e1b2']);
  });

  it('does not touch the profile it was given', () => {
    const before = emptyProfile();
    const snapshot = JSON.stringify(before);
    addExperience(before);

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('removing items', () => {
  it('never reuses an id after a deletion', () => {
    let profile = addExperience(addExperience(addExperience(emptyProfile())));
    profile = removeExperience(profile, 'e2');

    expect(profile.experience.map((r) => r.id)).toEqual(['e1', 'e3']);

    profile = addExperience(profile);
    expect(profile.experience.map((r) => r.id)).toEqual(['e1', 'e3', 'e4']);
  });

  it('removes only the bullet asked for', () => {
    let profile = addExperience(emptyProfile());
    profile = addBullet(addBullet(profile, 'experience', 'e1'), 'experience', 'e1');
    profile = removeBullet(profile, 'experience', 'e1', 'e1b1');

    expect(profile.experience[0]?.bullets.map((b) => b.id)).toEqual(['e1b2']);
  });

  it('leaves other sections alone', () => {
    const profile = removeExperience(addProject(addExperience(emptyProfile())), 'e1');

    expect(profile.experience).toEqual([]);
    expect(profile.projects).toHaveLength(1);
  });
});

describe('editing', () => {
  it('patches only the named item', () => {
    let profile = addExperience(addExperience(emptyProfile()));
    profile = updateExperience(profile, 'e2', { company: 'Acme' });

    expect(profile.experience[0]?.company).toBe('');
    expect(profile.experience[1]?.company).toBe('Acme');
  });

  it('clears an optional field when set back to undefined', () => {
    let profile = updateExperience(addExperience(emptyProfile()), 'e1', { note: 'Contract engagement.' });
    expect(profile.experience[0]?.note).toBe('Contract engagement.');

    profile = updateExperience(profile, 'e1', { note: undefined });
    expect(profile.experience[0]?.note).toBeUndefined();
  });
});

describe('parseSkillList', () => {
  it('splits, trims and drops blanks', () => {
    expect(parseSkillList(' Go , TypeScript,, Python ')).toEqual(['Go', 'TypeScript', 'Python']);
  });

  it('returns nothing for an empty field', () => {
    expect(parseSkillList('  ')).toEqual([]);
  });
});

describe('checkProfile', () => {
  it('accepts a filled profile', () => {
    expect(checkProfile(filled()).ok).toBe(true);
  });

  it('reports a blank contact against the field that owns it', () => {
    const check = checkProfile(emptyProfile());

    expect(check.ok).toBe(false);
    expect(check.issues.get('contact.fullName')).toMatch(/\w/);
  });

  it('reports a bullet issue at a path the editor can render', () => {
    const profile = filled();
    const blank = updateBullet(profile, 'experience', 'e1', 'e1b1', '   ');

    expect(checkProfile(blank).issues.get('experience[0].bullets[0].text')).toMatch(/\w/);
  });

  it('rejects a note past the length budget', () => {
    const long = updateExperience(filled(), 'e1', { note: 'x'.repeat(500) });

    expect(checkProfile(long).ok).toBe(false);
    expect(checkProfile(long).issues.get('experience[0].note')).toMatch(/\d/);
  });

  it('keeps the first message when a path repeats', () => {
    const map = issuesByPath([
      { path: 'contact.email', message: 'first' },
      { path: 'contact.email', message: 'second' },
    ]);

    expect(map.get('contact.email')).toBe('first');
  });
});

describe('round trip', () => {
  it('survives validation unchanged', () => {
    const profile = filled();
    const check = checkProfile(profile);

    expect(check.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
  });
});
