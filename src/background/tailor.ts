/**
 * The tailoring run, end to end.
 *
 * Lives in the worker because it makes the only network call the extension
 * makes, and because a popup closing mid-request must not abandon work the user
 * has already paid for.
 */

import template from '../../templates/faangpath-simple.tex?raw';
import { assertTailorable } from '../core/profile/schema';
import { buildTailoringRequest } from '../core/prompt/messages';
import { parseTailoringPlan } from '../core/prompt/parse';
import { buildProfileIndex } from '../core/prompt/profile-index';
import { renderValidated, validatePlan } from '../core/tailor';
import { AppError } from '../core/types';
import { createProvider } from '../providers/registry';
import { loadProfile, loadSettings } from '../shared/storage';
import type { JobSpec, Profile, TailoringPlan } from '../core/types';
import type { TailorResult } from '../shared/messages';

/** Bullets the plan selected, paired with what the user originally wrote. */
const changedBullets = (plan: TailoringPlan, profile: Profile): TailorResult['changed'] => {
  const originals = new Map<string, string>();
  for (const section of [...profile.experience, ...profile.projects]) {
    for (const bullet of section.bullets) originals.set(bullet.id, bullet.text);
  }

  return plan.rewrites.flatMap((rewrite) => {
    const original = originals.get(rewrite.id);
    return original === undefined || original === rewrite.text
      ? []
      : [{ bulletId: rewrite.id, original, tailored: rewrite.text }];
  });
};

const selectedCount = (plan: TailoringPlan): number =>
  [...plan.experience, ...plan.projects].reduce((total, section) => total + section.bulletIds.length, 0);

/**
 * @throws {AppError} for every failure — missing settings, empty profile, a
 *   provider that refused, a plan that referenced nothing real, or a resume
 *   that will not fit on one page.
 */
export const runTailoring = async (spec: JobSpec, emphasis?: string): Promise<TailorResult> => {
  const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  if (profile === undefined) throw new AppError('PROFILE_EMPTY');
  assertTailorable(profile);
  if (settings === undefined) throw new AppError('NO_PROVIDER_CONFIGURED');

  const request = buildTailoringRequest(
    buildProfileIndex(profile),
    spec,
    profile.education.map((entry) => entry.id),
    emphasis === undefined ? {} : { emphasis },
  );

  const completion = await createProvider(settings).complete(request);
  const validated = validatePlan(parseTailoringPlan(completion.text), profile);
  const latex = renderValidated(validated, profile, template);

  return {
    latex,
    fit: {
      verdict: validated.fit.verdict,
      estimatedLines: validated.fit.estimatedLines,
      budgetLines: validated.fit.budgetLines,
    },
    rejected: validated.rejected.map((issue) => ({
      bulletId: issue.bulletId,
      unsupported: issue.unsupported,
      original: issue.original,
      rewritten: issue.rewritten,
    })),
    changed: changedBullets(validated.plan, profile),
    kept: selectedCount(validated.plan),
    usage: completion.usage,
  };
};
