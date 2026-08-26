/**
 * Stable short IDs for profile items.
 *
 * Format: `e1` experience, `e1b3` its third bullet, `p2` project, `p2b1`,
 * `s1` skill group, `d1` education.
 *
 * IDs are permanent and never reused after deletion (invariant #4), so the
 * next ID is `max + 1` over the IDs that still exist — deleting `e2` from
 * `e1 e2 e3` leaves the next role as `e4`, not `e2`.
 *
 * @see docs/architecture.md §5
 */

import { AppError } from '../types';
import type { Bullet, ItemId, Profile } from '../types';

export type ItemKind = 'experience' | 'project' | 'skill' | 'education';

const PREFIX = {
  experience: 'e',
  project: 'p',
  skill: 's',
  education: 'd',
} as const satisfies Record<ItemKind, string>;

const KIND_BY_PREFIX: Readonly<Record<string, ItemKind>> = {
  e: 'experience',
  p: 'project',
  s: 'skill',
  d: 'education',
};

/** Only experiences and projects hold bullets, so only their IDs may carry a `bN` suffix. */
const HOLDS_BULLETS: ReadonlySet<ItemKind> = new Set<ItemKind>(['experience', 'project']);

const ID_PATTERN = /^([epsd])([1-9]\d*)(?:b([1-9]\d*))?$/;

export interface ParsedId {
  readonly kind: ItemKind;
  readonly index: number;
  /** Set only for bullet IDs such as `e1b3`. */
  readonly bullet: number | undefined;
}

export const formatId = (kind: ItemKind, index: number): ItemId => `${PREFIX[kind]}${index}`;

export const formatBulletId = (parentId: ItemId, index: number): ItemId => `${parentId}b${index}`;

/** `undefined` for anything that is not a well-formed ID. */
export const parseId = (id: string): ParsedId | undefined => {
  const match = ID_PATTERN.exec(id);
  if (!match) return undefined;

  const [, prefix, index, bullet] = match;
  if (prefix === undefined || index === undefined) return undefined;

  const kind = KIND_BY_PREFIX[prefix];
  if (kind === undefined) return undefined;
  if (bullet !== undefined && !HOLDS_BULLETS.has(kind)) return undefined;

  return { kind, index: Number(index), bullet: bullet === undefined ? undefined : Number(bullet) };
};

const idsOf = (profile: Profile, kind: ItemKind): readonly ItemId[] => {
  switch (kind) {
    case 'experience':
      return profile.experience.map((item) => item.id);
    case 'project':
      return profile.projects.map((item) => item.id);
    case 'skill':
      return profile.skills.map((item) => item.id);
    case 'education':
      return profile.education.map((item) => item.id);
  }
};

const highest = (ids: readonly ItemId[], of: (parsed: ParsedId) => number | undefined): number =>
  ids.reduce((max, id) => {
    const parsed = parseId(id);
    const value = parsed === undefined ? undefined : of(parsed);
    return value === undefined ? max : Math.max(max, value);
  }, 0);

/** The next never-before-used ID of this kind. */
export const nextId = (profile: Profile, kind: ItemKind): ItemId =>
  formatId(kind, highest(idsOf(profile, kind), (p) => (p.kind === kind && p.bullet === undefined ? p.index : undefined)) + 1);

const bulletsOf = (profile: Profile, parentId: ItemId): readonly Bullet[] | undefined =>
  profile.experience.find((role) => role.id === parentId)?.bullets ??
  profile.projects.find((project) => project.id === parentId)?.bullets;

/** The next never-before-used bullet ID under `parentId`. */
export const nextBulletId = (profile: Profile, parentId: ItemId): ItemId => {
  const bullets = bulletsOf(profile, parentId);
  if (bullets === undefined) {
    throw new AppError('UNKNOWN_ITEM_ID', {
      userMessage: 'That role or project is no longer in your profile, so the bullet could not be added.',
      action: 'edit_profile',
      context: { parentId },
    });
  }
  return formatBulletId(parentId, highest(bullets.map((b) => b.id), (p) => p.bullet) + 1);
};
