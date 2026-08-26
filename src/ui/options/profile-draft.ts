/**
 * Structural edits to a profile, and the lookup that puts validation messages
 * next to the fields they belong to.
 *
 * Kept apart from rendering for the same reason as the settings draft: adding a
 * role, removing a bullet and allocating an id are rules worth testing without
 * a DOM, and they are where a profile editor actually goes wrong.
 */

import { nextBulletId, nextId } from '../../core/profile/ids';
import { validateProfile } from '../../core/profile/schema';
import type { FieldIssue } from '../../core/profile/schema';
import type { Bullet, Education, Experience, ItemId, Profile, Project, SkillGroup } from '../../core/types';

/** Sections a bullet can belong to. */
export type BulletParent = 'experience' | 'projects';

const blankDates = { start: '2024-01', end: 'present' } as const;

export const addExperience = (profile: Profile): Profile => ({
  ...profile,
  experience: [
    ...profile.experience,
    { id: nextId(profile, 'experience'), company: '', title: '', dates: { ...blankDates }, bullets: [] },
  ],
});

export const addProject = (profile: Profile): Profile => ({
  ...profile,
  projects: [...profile.projects, { id: nextId(profile, 'project'), name: '', bullets: [] }],
});

export const addEducation = (profile: Profile): Profile => ({
  ...profile,
  education: [
    ...profile.education,
    { id: nextId(profile, 'education'), institution: '', degree: '', field: '', dates: { ...blankDates } },
  ],
});

export const addSkillGroup = (profile: Profile): Profile => ({
  ...profile,
  skills: [...profile.skills, { id: nextId(profile, 'skill'), label: '', skills: [] }],
});

/**
 * Removal never renumbers anything.
 *
 * Ids are permanent (invariant 4): deleting the second of three roles leaves
 * the third holding its original id, and the next role added takes a fresh
 * number rather than filling the gap.
 */
const withoutId = <T extends { readonly id: ItemId }>(items: readonly T[], id: ItemId): T[] =>
  items.filter((item) => item.id !== id);

export const removeExperience = (profile: Profile, id: ItemId): Profile => ({
  ...profile,
  experience: withoutId(profile.experience, id),
});

export const removeProject = (profile: Profile, id: ItemId): Profile => ({
  ...profile,
  projects: withoutId(profile.projects, id),
});

export const removeEducation = (profile: Profile, id: ItemId): Profile => ({
  ...profile,
  education: withoutId(profile.education, id),
});

export const removeSkillGroup = (profile: Profile, id: ItemId): Profile => ({
  ...profile,
  skills: withoutId(profile.skills, id),
});

/**
 * A partial update that may also clear an optional field.
 *
 * `Partial<T>` alone cannot express "set this back to absent" under
 * `exactOptionalPropertyTypes`, and clearing an optional note or link is an
 * ordinary thing to do in an editor.
 */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

const patchItem = <T extends { readonly id: ItemId }>(items: readonly T[], id: ItemId, patch: Patch<T>): T[] =>
  items.map((item) => (item.id === id ? { ...item, ...patch } : item));

export const updateExperience = (profile: Profile, id: ItemId, patch: Patch<Experience>): Profile => ({
  ...profile,
  experience: patchItem(profile.experience, id, patch),
});

export const updateProject = (profile: Profile, id: ItemId, patch: Patch<Project>): Profile => ({
  ...profile,
  projects: patchItem(profile.projects, id, patch),
});

export const updateEducation = (profile: Profile, id: ItemId, patch: Patch<Education>): Profile => ({
  ...profile,
  education: patchItem(profile.education, id, patch),
});

export const updateSkillGroup = (profile: Profile, id: ItemId, patch: Patch<SkillGroup>): Profile => ({
  ...profile,
  skills: patchItem(profile.skills, id, patch),
});

const withBullets = (profile: Profile, section: BulletParent, parentId: ItemId, map: (bullets: readonly Bullet[]) => Bullet[]): Profile =>
  section === 'experience'
    ? { ...profile, experience: profile.experience.map((item) => (item.id === parentId ? { ...item, bullets: map(item.bullets) } : item)) }
    : { ...profile, projects: profile.projects.map((item) => (item.id === parentId ? { ...item, bullets: map(item.bullets) } : item)) };

export const addBullet = (profile: Profile, section: BulletParent, parentId: ItemId): Profile =>
  withBullets(profile, section, parentId, (bullets) => [
    ...bullets,
    { id: nextBulletId(profile, parentId), text: '' },
  ]);

export const removeBullet = (profile: Profile, section: BulletParent, parentId: ItemId, bulletId: ItemId): Profile =>
  withBullets(profile, section, parentId, (bullets) => bullets.filter((bullet) => bullet.id !== bulletId));

export const updateBullet = (profile: Profile, section: BulletParent, parentId: ItemId, bulletId: ItemId, text: string): Profile =>
  withBullets(profile, section, parentId, (bullets) =>
    bullets.map((bullet) => (bullet.id === bulletId ? { ...bullet, text } : bullet)),
  );

/** Comma-separated entry is how people actually type a skills row. */
export const parseSkillList = (value: string): string[] =>
  value
    .split(',')
    .map((skill) => skill.trim())
    .filter((skill) => skill !== '');

/**
 * Validation messages keyed by the path they name.
 *
 * `validateProfile` reports `experience[1].bullets[0].text`; the editor renders
 * fields by id rather than index, so paths are resolved against the current
 * ordering once instead of being recomputed per field.
 */
export const issuesByPath = (issues: readonly FieldIssue[]): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const issue of issues) if (!map.has(issue.path)) map.set(issue.path, issue.message);
  return map;
};

export interface SaveCheck {
  readonly ok: boolean;
  readonly issues: ReadonlyMap<string, string>;
  readonly count: number;
}

/** Runs the real profile validator so the editor and storage agree on what is valid. */
export const checkProfile = (profile: Profile): SaveCheck => {
  const result = validateProfile(profile);
  const issues = result.ok ? [] : result.issues;
  return { ok: result.ok, issues: issuesByPath(issues), count: issues.length };
};

/** Stamps the edit time. Storage keeps whatever it is given, so the editor sets it. */
export const touch = (profile: Profile): Profile => ({ ...profile, updatedAt: new Date().toISOString() });
