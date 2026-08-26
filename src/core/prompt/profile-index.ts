/**
 * Builds the compact view of a profile that tailoring is allowed to send.
 *
 * The index is an allowlist, not a redaction: it is assembled field by field
 * from the profile rather than copied and stripped. A field that is not named
 * here cannot reach a provider, and a field added to `Profile` later does not
 * start travelling by default.
 *
 * Omitted deliberately: contact details, employers, dates, locations, grades,
 * project URLs, bullet evidence, and role notes.
 *
 * @see docs/architecture.md §6
 */

import { INDEX_BULLET_CHARS } from '../types';
import type {
  Bullet,
  Experience,
  IndexedBullet,
  IndexedItem,
  IndexedSkillGroup,
  Profile,
  ProfileIndex,
  Project,
} from '../types';

/**
 * Shortens to `limit` characters on a word boundary.
 *
 * Whitespace is collapsed first so a bullet the user typed across two lines
 * does not spend its budget on newlines. The boundary is only honoured if it
 * falls reasonably late, otherwise a single long token would truncate the line
 * to almost nothing.
 */
const truncate = (text: string, limit: number): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= limit) return collapsed;

  const cut = collapsed.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trimEnd();
};

/**
 * Tags are carried for relevance scoring, which runs locally.
 *
 * They are part of the index but not part of the prompt: `messages.ts` emits
 * only ids and text, so tags cost nothing on the wire. Scoring that can be done
 * in the browser should not be paid for in tokens.
 */
const toIndexedBullet = (bullet: Bullet): IndexedBullet => ({
  id: bullet.id,
  text: truncate(bullet.text, INDEX_BULLET_CHARS),
  ...(bullet.tags !== undefined && bullet.tags.length > 0 ? { tags: bullet.tags } : {}),
});

/** A role is labelled by title alone. The employer is not the model's business. */
const fromExperience = (role: Experience): IndexedItem => ({
  id: role.id,
  kind: 'experience',
  label: role.title,
  bullets: role.bullets.map(toIndexedBullet),
});

const fromProject = (project: Project): IndexedItem => ({
  id: project.id,
  kind: 'project',
  label: project.name,
  bullets: project.bullets.map(toIndexedBullet),
});

const fromSkillGroup = (group: { id: string; label: string; skills: readonly string[] }): IndexedSkillGroup => ({
  id: group.id,
  label: group.label,
  skills: group.skills,
});

/**
 * Items carrying no bullets are dropped: there is nothing for the model to
 * select, and an empty section is pure overhead in the payload.
 */
export const buildProfileIndex = (profile: Profile): ProfileIndex => ({
  items: [
    ...profile.experience.filter((role) => role.bullets.length > 0).map(fromExperience),
    ...profile.projects.filter((project) => project.bullets.length > 0).map(fromProject),
  ],
  skills: profile.skills.filter((group) => group.skills.length > 0).map(fromSkillGroup),
});
