/**
 * The Structured Profile — ResumeTailor's single source of truth.
 *
 * Nothing reaches a rendered resume unless it is in here. The AI may select,
 * order and rephrase these items; it may never add to them.
 *
 * @see docs/architecture.md §5
 */

/**
 * A permanent short identifier for a selectable profile item.
 *
 * Format: `e1` experience, `e1b3` its third bullet, `p2` project, `s1` skill group.
 * Assigned once on creation and never reused, even after deletion — the model
 * references these instead of echoing text back, and cached plans stay valid
 * across profile edits.
 */
export type ItemId = string;

/** `YYYY-MM`, or `present` for an ongoing role. Never a free-text date. */
export type YearMonth = `${number}-${number}` | 'present';

export interface DateRange {
  readonly start: YearMonth;
  readonly end: YearMonth;
}

export interface Contact {
  readonly fullName: string;
  readonly email: string;
  /** E.164 preferred. Optional — many candidates omit it deliberately. */
  readonly phone?: string;
  /** City, Country. Optional for the same reason. */
  readonly location?: string;
  readonly linkedin?: string;
  readonly github?: string;
  readonly website?: string;
}

export interface Education {
  readonly id: ItemId;
  readonly institution: string;
  readonly degree: string;
  readonly field: string;
  readonly dates: DateRange;
  /** As written by the user, e.g. `"8.4/10"`. Never normalised, never inferred. */
  readonly grade?: string;
  readonly location?: string;
}

/**
 * One achievement line, in Google XYZ shape:
 * "Accomplished [X] as measured by [Y] by doing [Z]".
 *
 * `text` is the user's own words. Tailoring produces a rephrasing that must
 * survive evidence validation against this text.
 */
export interface Bullet {
  readonly id: ItemId;
  readonly text: string;
  /**
   * Extra context the user keeps for themselves: metrics, scale, stack detail.
   * Included in the tailoring index as *evidence* the model may draw on, so a
   * rewrite that cites a number here passes validation. Never rendered directly.
   */
  readonly evidence?: readonly string[];
  /** Skill names this bullet demonstrates. Powers local relevance scoring — no tokens spent. */
  readonly tags?: readonly string[];
}

export interface Experience {
  readonly id: ItemId;
  readonly company: string;
  readonly title: string;
  readonly dates: DateRange;
  readonly location?: string;
  readonly bullets: readonly Bullet[];
  /**
   * A short note the user writes about this role, rendered verbatim beneath it.
   *
   * Its purpose is context a bullet cannot carry — a contract or payroll
   * arrangement, a short tenure, a leave of absence, a relocation. Because that
   * is often sensitive and always personal, it is the user's own words and only
   * ever the user's own words:
   *
   * - **Never sent to a provider.** It is absent from `ProfileIndex`, so no
   *   model sees it and none can rephrase it.
   * - **Never dropped.** A `TailoringPlan` that omits a role carrying a note
   *   still renders the role and the note — otherwise the note's whole purpose,
   *   explaining something the user chose to explain, is silently defeated.
   * - **Never authored by this codebase.** No defaults, no suggested wording,
   *   no examples that could become someone's resume by accident.
   */
  readonly note?: string;
}

export interface Project {
  readonly id: ItemId;
  readonly name: string;
  readonly bullets: readonly Bullet[];
  readonly url?: string;
  readonly dates?: DateRange;
  /** Rendered inline, e.g. `TypeScript · Postgres · Docker`. */
  readonly stack?: readonly string[];
}

/** A labelled row in the skills section, e.g. "Languages: Go, TypeScript, Python". */
export interface SkillGroup {
  readonly id: ItemId;
  readonly label: string;
  readonly skills: readonly string[];
}

export interface Profile {
  /** Schema version. Bump on any breaking shape change; migrations key off this. */
  readonly version: 1;
  readonly contact: Contact;
  readonly education: readonly Education[];
  readonly experience: readonly Experience[];
  readonly projects: readonly Project[];
  readonly skills: readonly SkillGroup[];
  /** Optional one-line summary. Rendered only if the plan selects it and the page has room. */
  readonly summary?: string;
  /** ISO 8601. Used to invalidate cached tailoring plans. */
  readonly updatedAt: string;
}

/**
 * The compact form sent to a provider — IDs and truncated text only.
 *
 * Deliberately omits dates, employers, contact details and role notes: the
 * model does not need them to judge relevance, and they are joined locally at
 * render time. Bullet text is truncated to `INDEX_BULLET_CHARS`, which is enough
 * to judge relevance and not enough to fabricate detail from.
 *
 * @see docs/architecture.md §6
 */
export interface ProfileIndex {
  readonly items: readonly IndexedItem[];
  readonly skills: readonly IndexedSkillGroup[];
}

export interface IndexedItem {
  readonly id: ItemId;
  readonly kind: 'experience' | 'project';
  /** Job title, or project name. No employer, no dates. */
  readonly label: string;
  readonly bullets: readonly IndexedBullet[];
}

export interface IndexedBullet {
  readonly id: ItemId;
  /** Truncated to `INDEX_BULLET_CHARS`. */
  readonly text: string;
  readonly tags?: readonly string[];
}

export interface IndexedSkillGroup {
  readonly id: ItemId;
  readonly label: string;
  readonly skills: readonly string[];
}

/**
 * Bullet truncation width for the index.
 *
 * 90 characters is enough for a relevance judgement and too little to invent
 * detail from. Raise to 120 before ever considering full text (decision D-003).
 */
export const INDEX_BULLET_CHARS = 90;
