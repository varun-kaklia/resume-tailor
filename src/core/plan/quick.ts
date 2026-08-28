/**
 * The local tailoring run, end to end: profile + posting in, one page out.
 *
 * The popup and the options page both offer Quick Mode and must produce
 * identical output from identical input, so the sequence lives here rather than
 * in either screen. The template is passed in because loading it is a build
 * concern, and `core` does not import assets.
 *
 * Nothing here calls a provider. The plan carries no rewrites, so the evidence
 * validator has nothing to reject and the whole run is synchronous.
 *
 * @see docs/architecture.md §4a
 */

import { tailorLocally } from './local';
import { renderValidated, validatePlan } from '../tailor';
import type { ItemId, JobSpec, Profile, ValidatedPlan } from '../types';

export interface QuickResult {
  readonly latex: string;
  readonly validated: ValidatedPlan;
  /** Bullets dropped to make the page fit. Named in the UI, never silent. */
  readonly trimmed: readonly ItemId[];
  /** Posting terms the profile answers nowhere, spelled as the posting spelled them. */
  readonly unmatched: readonly string[];
  readonly selected: number;
}

/**
 * @throws {AppError} `DOES_NOT_FIT_ONE_PAGE` if trimming could not reclaim the
 *   page, `UNKNOWN_ITEM_ID` if the plan and profile disagree — both indicate a
 *   bug here rather than anything the user did.
 */
export const quickTailor = (profile: Profile, spec: JobSpec, template: string): QuickResult => {
  const local = tailorLocally(profile, spec);
  const validated = validatePlan(local.plan, profile);

  return {
    latex: renderValidated(validated, profile, template),
    validated,
    trimmed: local.trimmed,
    unmatched: local.unmatched,
    selected: [...validated.plan.experience, ...validated.plan.projects].reduce(
      (total, section) => total + section.bulletIds.length,
      0,
    ),
  };
};
