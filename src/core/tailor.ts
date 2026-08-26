/**
 * The tailoring pipeline: a raw plan from a model becomes a plan safe to render.
 *
 * This is the one genuinely sequential step in `core` — each stage depends on
 * the last — and the only place that decides what happens to a rewrite the
 * evidence check rejects.
 *
 * Pure: no I/O, no provider, no `chrome.*`. The background worker gets the plan
 * from `IAIProvider`, parses it, and hands it here.
 *
 * @see docs/architecture.md §4, §9
 */

import { renderLatex } from './render/latex';
import { validateRewrites, unknownIds } from './validate/evidence';
import { estimateFit } from './validate/fit';
import { checkXyz } from './validate/xyz';
import { AppError } from './types';
import type { FitResult, Profile, TailoringPlan, ValidatedPlan } from './types';

/**
 * Drops the rejected rewrites, keeping everything else the plan decided.
 *
 * Selection and ordering survive a failed evidence check — only the *wording*
 * is discarded. With no rewrite for a bullet id, the renderer already falls
 * back to the profile's original text, so a rejected rewrite degrades to the
 * user's own words rather than to a hole in the document.
 */
const withoutRejected = (plan: TailoringPlan, rejectedIds: ReadonlySet<string>): TailoringPlan => ({
  ...plan,
  rewrites: plan.rewrites.filter((rewrite) => !rejectedIds.has(rewrite.id)),
});

/**
 * Validates a model's plan and returns one that is safe to render.
 *
 * Order matters. Unknown ids are fatal and checked first: a plan referencing
 * something that is not in the profile is not partially usable, and every later
 * stage would be reasoning about a bullet that does not exist. Everything after
 * that is recoverable and reported rather than thrown.
 *
 * `fit` is measured on the *surviving* plan, because a rejected rewrite falls
 * back to the original text and originals are usually longer — measuring the
 * pre-rejection plan would under-report the page.
 *
 * @throws {AppError} `UNKNOWN_ITEM_ID` — the only fatal outcome here.
 */
export const validatePlan = (plan: TailoringPlan, profile: Profile): ValidatedPlan => {
  const unknown = unknownIds(plan, profile);
  if (unknown.length > 0) {
    throw new AppError('UNKNOWN_ITEM_ID', { context: { ids: unknown.join(', '), count: unknown.length } });
  }

  const rejected = validateRewrites(plan, profile);
  const accepted = withoutRejected(plan, new Set(rejected.map((issue) => issue.bulletId)));

  return {
    plan: accepted,
    rejected,
    xyzWarnings: accepted.rewrites.flatMap((rewrite) => checkXyz(rewrite.text, rewrite.id)),
    fit: estimateFit(accepted, profile),
  };
};

/**
 * Renders a validated plan, refusing to produce a resume that runs to two pages.
 *
 * Blocking on `over` rather than warning is deliberate: one page is a hard
 * product constraint, and `estimateFit` is biased to over-warn, so a false
 * block costs the user a bullet they can put back while a false pass costs them
 * the application. `tight` renders — that is what the template's font knobs are
 * for. This is the open question in docs/PDP.md; revisit once the estimator can
 * be calibrated against a real compiler (backlog P-29).
 *
 * @throws {AppError} `DOES_NOT_FIT_ONE_PAGE` when the estimate says `over`.
 */
export const renderValidated = (validated: ValidatedPlan, profile: Profile, template: string): string => {
  const { fit } = validated;
  if (fit.verdict === 'over') {
    throw new AppError('DOES_NOT_FIT_ONE_PAGE', {
      context: { estimatedLines: fit.estimatedLines, budgetLines: fit.budgetLines, cuts: fit.suggestedCuts.length },
    });
  }
  return renderLatex(validated.plan, profile, template);
};

/** Convenience for the common path. Same throws as the two stages it chains. */
export const tailor = (plan: TailoringPlan, profile: Profile, template: string): { latex: string; validated: ValidatedPlan } => {
  const validated = validatePlan(plan, profile);
  return { latex: renderValidated(validated, profile, template), validated };
};

export type { FitResult, ValidatedPlan };
