/**
 * The tailoring contract: what the model is allowed to return.
 *
 * The model does not write a resume. It returns a *plan* — which profile items
 * to include, in what order, and how selected bullets should be reworded. Full
 * text, dates, employers, contact details and role notes are joined locally
 * at render time, where no model can touch them.
 *
 * @see docs/architecture.md §4, §9
 */

import type { ItemId } from './profile';

/**
 * A single rewritten bullet.
 *
 * `text` must survive evidence validation: every number, percentage, currency
 * amount and proper noun in it must appear in the source bullet's `text` or
 * `evidence`. A rewrite that adds a fact is rejected, not silently accepted.
 */
export interface BulletRewrite {
  /** Must exist in the profile. An unknown ID fails the whole plan. */
  readonly id: ItemId;
  readonly text: string;
  /** One short line the UI shows next to the diff. Optional — costs tokens. */
  readonly rationale?: string;
}

/** One included experience or project, with its chosen bullets in order. */
export interface PlannedSection {
  readonly id: ItemId;
  /** Order matters: this is render order, most relevant first. */
  readonly bulletIds: readonly ItemId[];
}

/** What the model returns. Nothing here is text the user has not already written. */
export interface TailoringPlan {
  readonly experience: readonly PlannedSection[];
  readonly projects: readonly PlannedSection[];
  /** Skill group order, and within each group the prioritised skill names. */
  readonly skills: readonly { readonly id: ItemId; readonly skills: readonly string[] }[];
  readonly rewrites: readonly BulletRewrite[];
  /** Education IDs to include, in order. Usually all of them. */
  readonly educationIds: readonly ItemId[];
  /** Rewritten summary line, if the profile has one and it is worth the space. */
  readonly summary?: string;
}

/** Outcome of validating one rewrite against its source bullet. */
export interface EvidenceIssue {
  readonly bulletId: ItemId;
  /** The number or proper noun with no support in the source. */
  readonly unsupported: string;
  readonly rewritten: string;
  readonly original: string;
}

/** Advisory Google XYZ shape check. Warns, never blocks. */
export interface XyzIssue {
  readonly bulletId: ItemId;
  readonly missing: 'measurement' | 'action' | 'outcome';
  readonly hint: string;
}

/** One-page fit verdict. Never a percentage — the estimate is not that good. */
export interface FitResult {
  readonly verdict: 'ok' | 'tight' | 'over';
  readonly estimatedLines: number;
  readonly budgetLines: number;
  /** Bullet IDs to cut first when `over`, cheapest loss first. */
  readonly suggestedCuts: readonly ItemId[];
}

/** A plan that has been through validation and is safe to render. */
export interface ValidatedPlan {
  readonly plan: TailoringPlan;
  /** Rewrites that failed evidence checks. Their originals are kept instead. */
  readonly rejected: readonly EvidenceIssue[];
  readonly xyzWarnings: readonly XyzIssue[];
  readonly fit: FitResult;
}

/** Everything the tailoring pipeline needs. Assembled by the background worker. */
export interface TailoringRequest {
  readonly profileHash: string;
  readonly jobHash: string;
  /** Extra instruction from the user, e.g. "emphasise the data work". Optional. */
  readonly emphasis?: string;
}
