/**
 * Builds a `TailoringPlan` without a model.
 *
 * Bullets are scored on how much of the posting's own vocabulary they already
 * contain, then selected and ordered. **Nothing here writes text.** `rewrites`
 * is always empty, and that is a deliberate constraint rather than an
 * unfinished feature: a local planner is the easiest place in this codebase to
 * start generating prose, with no provider boundary and no evidence validator
 * in the way, so it is denied the ability by construction (D-069).
 *
 * The output is the same `TailoringPlan` a model returns and goes through the
 * same `validatePlan`. An empty rewrite list passes every check trivially —
 * routing around the validator is how a codebase eventually ships without one.
 *
 * @see docs/architecture.md §4a
 */

import { estimateFit } from '../validate/fit';
import type { FitResult, ItemId, JobSpec, PlannedSection, Profile, TailoringPlan } from '../types';

/** A "must" requirement is worth more than a "nice", which is worth more than a loose keyword. */
const WEIGHT = { must: 3, nice: 2, keyword: 1 } as const;

/** Bullets carrying nothing from the posting are still worth keeping if a role would otherwise be empty. */
const MIN_BULLETS_PER_ROLE = 1;

/** Beyond this a single role crowds out every other section, however well it matches. */
const MAX_BULLETS_PER_ROLE = 5;

export interface LocalPlan {
  readonly plan: TailoringPlan;
  readonly fit: FitResult;
  /**
   * Bullets the planner dropped to make the page, in the order it dropped them.
   *
   * Surfaced, never silent (invariant 7): the UI names each one so the user can
   * see the cost of one page rather than wonder where a bullet went.
   */
  readonly trimmed: readonly ItemId[];
  /** Posting terms that matched nothing in the profile. Honest gap, not an error. */
  readonly unmatched: readonly string[];
}

/**
 * Terms worth matching against, each with what it is worth.
 *
 * Requirements and keywords only. Responsibilities are prose and would flood
 * the match with common verbs; the extractor already lifted what matters out of
 * them into requirements.
 *
 * Keyed by the term as the posting wrote it — "Kubernetes", not "kubernetes" —
 * because `unmatched` is shown to the user and a list of lower-cased tool names
 * reads like a machine talking. Matching is case-insensitive regardless, so the
 * casing is presentation only; a lower-cased set guards against duplicates.
 */
const termsOf = (spec: JobSpec): ReadonlyMap<string, number> => {
  const terms = new Map<string, number>();
  const seen = new Map<string, string>();

  const add = (term: string, weight: number): void => {
    const key = seen.get(term.toLowerCase());
    if (key === undefined) {
      seen.set(term.toLowerCase(), term);
      terms.set(term, weight);
      return;
    }
    terms.set(key, Math.max(terms.get(key) ?? 0, weight));
  };

  for (const requirement of spec.requirements) add(requirement.term, WEIGHT[requirement.weight]);
  for (const keyword of spec.keywords) add(keyword, WEIGHT.keyword);
  return terms;
};

/**
 * Whether a term appears in text, on word boundaries.
 *
 * Substring matching would score "go" against "category" and "r" against
 * everything. Terms with regex-significant characters — "c++", ".net", "node.js"
 * — are escaped and matched with a looser trailing boundary, since `\b` does not
 * fire after a plus sign.
 */
const mentions = (text: string, term: string): boolean => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leading = /^\w/.test(term) ? '\\b' : '';
  const trailing = /\w$/.test(term) ? '\\b' : '(?!\\w)';
  return new RegExp(`${leading}${escaped}${trailing}`, 'i').test(text);
};

interface Scored {
  readonly id: ItemId;
  readonly score: number;
  /** Position in the profile. Breaks ties toward the order the user chose. */
  readonly position: number;
}

const scoreBullet = (text: string, tags: readonly string[] | undefined, terms: ReadonlyMap<string, number>): number => {
  const haystack = [text, ...(tags ?? [])].join(' ');
  let score = 0;
  for (const [term, weight] of terms) if (mentions(haystack, term)) score += weight;
  return score;
};

/** Highest score first; ties fall back to the order the profile already had. */
const byScore = (a: Scored, b: Scored): number => b.score - a.score || a.position - b.position;

const selectBullets = (
  bullets: readonly { readonly id: ItemId; readonly text: string; readonly tags?: readonly string[] }[],
  terms: ReadonlyMap<string, number>,
): { readonly ids: readonly ItemId[]; readonly score: number } => {
  const scored: Scored[] = bullets.map((bullet, position) => ({
    id: bullet.id,
    score: scoreBullet(bullet.text, bullet.tags, terms),
    position,
  }));

  const ranked = [...scored].sort(byScore);
  // Everything that matched, then padding up to the floor so a role is never
  // rendered as a bare heading, then a cap so one role cannot eat the page.
  const matching = ranked.filter((bullet) => bullet.score > 0);
  const padding = ranked.filter((bullet) => bullet.score === 0).slice(0, Math.max(0, MIN_BULLETS_PER_ROLE - matching.length));
  const chosen = [...matching, ...padding].slice(0, MAX_BULLETS_PER_ROLE);

  return {
    ids: chosen.map((bullet) => bullet.id),
    score: chosen.reduce((total, bullet) => total + bullet.score, 0),
  };
};

/**
 * Selects and orders a plan against a posting.
 *
 * Roles keep the profile's order — a resume is read chronologically, and
 * resequencing employment history by keyword match would produce a document
 * that reads as though the candidate cannot remember when they worked where.
 * Only *bullets within* a role are reordered, and projects, which carry no
 * chronology the reader depends on, are ranked by relevance.
 */
export const planLocally = (profile: Profile, spec: JobSpec): TailoringPlan => {
  const terms = termsOf(spec);

  const experience: PlannedSection[] = profile.experience.map((role) => ({
    id: role.id,
    bulletIds: selectBullets(role.bullets, terms).ids,
  }));

  const projects = profile.projects
    .map((project, position) => {
      const selected = selectBullets(project.bullets, terms);
      return { id: project.id, bulletIds: selected.ids, score: selected.score, position };
    })
    .sort(byScore)
    .map(({ id, bulletIds }) => ({ id, bulletIds }));

  // Within a group, skills the posting named come first. The group's own order
  // is the user's and is left alone: it is how they describe themselves.
  const wanted = new Set([...terms.keys()].map((term) => term.toLowerCase()));
  const skills = profile.skills.map((group) => ({
    id: group.id,
    skills: [...group.skills].sort((a, b) => Number(wanted.has(b.toLowerCase())) - Number(wanted.has(a.toLowerCase()))),
  }));

  return {
    experience,
    projects,
    skills,
    educationIds: profile.education.map((entry) => entry.id),
    rewrites: [],
  };
};

const withoutBullets = (plan: TailoringPlan, cuts: ReadonlySet<ItemId>): TailoringPlan => {
  const prune = (sections: readonly PlannedSection[]): PlannedSection[] =>
    sections.map((section) => ({ ...section, bulletIds: section.bulletIds.filter((id) => !cuts.has(id)) }));
  return { ...plan, experience: prune(plan.experience), projects: prune(plan.projects) };
};

/**
 * Drops the cheapest bullets until the plan fits one page.
 *
 * `renderValidated` blocks on `over` (D-022) because a *model's* plan is not
 * ours to edit. This one is: choosing fewer bullets is the local planner's own
 * job, so it trims rather than handing the user a wall they cannot act on. The
 * ranking comes from `fit.suggestedCuts`, so what counts as cheapest to lose
 * stays defined in exactly one place.
 *
 * Bounded by the number of planned bullets: each pass removes at least one, and
 * a plan with nothing left to cut returns whatever it has rather than looping.
 */
export const trimToFit = (plan: TailoringPlan, profile: Profile): LocalPlan => {
  const cuts = new Set<ItemId>();
  let current = plan;
  let fit = estimateFit(current, profile);

  while (fit.verdict === 'over' && fit.suggestedCuts.length > 0) {
    const before = cuts.size;
    for (const id of fit.suggestedCuts) cuts.add(id);
    if (cuts.size === before) break;

    current = withoutBullets(plan, cuts);
    fit = estimateFit(current, profile);
  }

  return { plan: current, fit, trimmed: [...cuts], unmatched: [] };
};

/**
 * The whole local path: score, select, trim to one page.
 *
 * `unmatched` names the posting's terms that appear nowhere in the profile.
 * That is the honest version of a "match score" — it says what is missing
 * rather than dressing a keyword count up as a percentage (D-007's reasoning,
 * applied to relevance instead of length).
 */
export const tailorLocally = (profile: Profile, spec: JobSpec): LocalPlan => {
  const terms = termsOf(spec);
  const plan = planLocally(profile, spec);

  const covered = new Set<string>();
  const texts = [
    ...profile.experience.flatMap((role) => role.bullets.map((bullet) => [bullet.text, ...(bullet.tags ?? [])].join(' '))),
    ...profile.projects.flatMap((project) => project.bullets.map((bullet) => [bullet.text, ...(bullet.tags ?? [])].join(' '))),
    ...profile.skills.flatMap((group) => group.skills),
  ];
  for (const term of terms.keys()) {
    if (texts.some((text) => mentions(text, term))) covered.add(term);
  }

  return { ...trimToFit(plan, profile), unmatched: [...terms.keys()].filter((term) => !covered.has(term)) };
};
