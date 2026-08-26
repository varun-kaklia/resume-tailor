/**
 * One-page fit estimation.
 *
 * CEILING: this counts characters, it does not typeset. It cannot see a long
 * unbreakable word, a hyphenation decision, or a widow line. Exact measurement
 * arrives with in-browser compilation (backlog P-29, decision D-006); until then
 * the verdict is deliberately coarse and the UI says "estimated".
 *
 * Never returns a percentage — D-007. A confident number here would be a lie.
 *
 * @see docs/architecture.md §10 — AI_RULES.md invariant 7
 */

import { experienceRenderOrder, resolvedBulletText } from '../render/latex';
import type { Bullet, ItemId, Profile } from '../types/profile';
import type { FitResult, TailoringPlan } from '../types/tailoring';

/**
 * Characters that fit on one rendered line at the template's defaults.
 *
 * US Letter minus 0.5in margins is 540pt of text width; at 11pt with an average
 * glyph around 0.5em (5.5pt) that measures out near 98 characters, ~96 inside a
 * bullet's indent. Biased down to 85, roughly 13% pessimistic, so a line that is
 * nearly full counts as full.
 */
export const CHARS_PER_LINE = 85;

/**
 * Lines available on one page at the template's defaults.
 *
 * 10in of text height at a 13.2pt baseline is about 54 lines. Biased down to 50,
 * roughly 8% pessimistic, to absorb the vertical space this estimator cannot see.
 *
 * Combined with `CHARS_PER_LINE` the estimator runs ~20% conservative: it will
 * warn on a resume that would have fit, and should never pass one that would not.
 */
export const BUDGET_LINES = 50;

/** Name, contact line, and the whitespace around them. */
const CONTACT_BLOCK_LINES = 4;
/** Heading, rule, and the gap above it. */
const SECTION_HEADER_LINES = 2;
/** Company/location line plus title line, with their spacing. */
const ENTRY_HEADER_LINES = 2.4;
/** Inter-bullet gap at the template's default `\rtBulletSep`. */
const BULLET_GAP_LINES = 0.2;

/** Above this fraction of the budget the resume is `tight` — worth a warning, not a block. */
const TIGHT_FRACTION = 0.92;

export interface FitOptions {
  /** Override when the user has changed the template's font or margin knobs. */
  readonly charsPerLine?: number;
  readonly budgetLines?: number;
}

const linesForText = (text: string, charsPerLine: number): number =>
  Math.max(1, Math.ceil(text.length / charsPerLine));

/** One bullet as it will render, with the section it belongs to for cut ranking. */
interface MeasuredBullet {
  readonly id: ItemId;
  readonly lines: number;
  /** Position of the owning section in render order. Higher means less relevant. */
  readonly sectionRank: number;
}

const measureBullets = (
  bullets: readonly Bullet[],
  bulletIds: readonly ItemId[],
  rewrites: ReadonlyMap<ItemId, string>,
  sectionRank: number,
  charsPerLine: number,
): readonly MeasuredBullet[] => {
  const byId = new Map(bullets.map((b) => [b.id, b]));
  return bulletIds
    .map((id) => byId.get(id))
    .filter((b): b is Bullet => b !== undefined)
    .map((b) => ({
      id: b.id,
      lines: linesForText(resolvedBulletText(b, rewrites), charsPerLine) + BULLET_GAP_LINES,
      sectionRank,
    }));
};

/**
 * Estimates whether the plan renders on one page.
 *
 * `suggestedCuts` names the bullets to drop first when `over`: cheapest loss
 * first, meaning the longest bullets from the sections the plan ranked lowest.
 * Enough are listed to bring the estimate back under budget.
 */
export const estimateFit = (plan: TailoringPlan, profile: Profile, opts?: FitOptions): FitResult => {
  const charsPerLine = opts?.charsPerLine ?? CHARS_PER_LINE;
  const budgetLines = opts?.budgetLines ?? BUDGET_LINES;

  const rewrites = new Map(plan.rewrites.map((r) => [r.id, r.text]));
  let fixed = CONTACT_BLOCK_LINES;
  const measured: MeasuredBullet[] = [];

  if (profile.summary !== undefined) {
    fixed += SECTION_HEADER_LINES + linesForText(plan.summary ?? profile.summary, charsPerLine);
  }

  const educationById = new Map(profile.education.map((e) => [e.id, e]));
  const education = plan.educationIds.filter((id) => educationById.has(id));
  if (education.length > 0) fixed += SECTION_HEADER_LINES + education.length * ENTRY_HEADER_LINES;

  // Roles carrying a user note still render when omitted, so they still cost lines.
  const roleById = new Map(profile.experience.map((r) => [r.id, r]));
  const plannedBullets = new Map(plan.experience.map((s) => [s.id, s.bulletIds]));
  const roles = experienceRenderOrder(plan, profile);
  if (roles.length > 0) fixed += SECTION_HEADER_LINES;
  roles.forEach((id, rank) => {
    const role = roleById.get(id);
    if (role === undefined) return;
    fixed += ENTRY_HEADER_LINES;
    if (role.note !== undefined) fixed += linesForText(role.note, charsPerLine);
    measured.push(...measureBullets(role.bullets, plannedBullets.get(id) ?? [], rewrites, rank, charsPerLine));
  });

  const projectById = new Map(profile.projects.map((p) => [p.id, p]));
  const projects = plan.projects.filter((p) => projectById.has(p.id));
  if (projects.length > 0) fixed += SECTION_HEADER_LINES;
  projects.forEach((planned, index) => {
    const project = projectById.get(planned.id);
    if (project === undefined) return;
    fixed += ENTRY_HEADER_LINES;
    // Projects sit below experience, so they rank below every role for cut ordering.
    const rank = roles.length + index;
    measured.push(...measureBullets(project.bullets, planned.bulletIds, rewrites, rank, charsPerLine));
  });

  const skillById = new Map(profile.skills.map((s) => [s.id, s]));
  const skills = plan.skills.filter((s) => skillById.has(s.id));
  if (skills.length > 0) {
    fixed += SECTION_HEADER_LINES;
    for (const planned of skills) {
      const group = skillById.get(planned.id);
      if (group === undefined) continue;
      const names = planned.skills.length > 0 ? planned.skills : group.skills;
      fixed += linesForText(`${group.label}: ${names.join(', ')}`, charsPerLine);
    }
  }

  const total = fixed + measured.reduce((sum, b) => sum + b.lines, 0);
  const estimatedLines = Math.ceil(total);

  const suggestedCuts: ItemId[] = [];
  if (estimatedLines > budgetLines) {
    // Least-relevant section first; within a section, the longest bullet — most
    // lines recovered per bullet the user gives up.
    const candidates = [...measured].sort((a, b) => b.sectionRank - a.sectionRank || b.lines - a.lines);
    let remaining = total;
    for (const bullet of candidates) {
      if (remaining <= budgetLines) break;
      suggestedCuts.push(bullet.id);
      remaining -= bullet.lines;
    }
  }

  const verdict: FitResult['verdict'] =
    estimatedLines > budgetLines ? 'over' : estimatedLines > budgetLines * TIGHT_FRACTION ? 'tight' : 'ok';

  return { verdict, estimatedLines, budgetLines, suggestedCuts };
};
