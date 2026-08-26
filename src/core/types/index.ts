/**
 * Public type surface of `src/core`.
 *
 * Import from `@core/types`, never from the individual files — the split is an
 * implementation detail and files will move.
 */

export type {
  Bullet,
  Contact,
  DateRange,
  Education,
  Experience,
  IndexedBullet,
  IndexedItem,
  IndexedSkillGroup,
  ItemId,
  Profile,
  ProfileIndex,
  Project,
  SkillGroup,
  YearMonth,
} from './profile';
export { INDEX_BULLET_CHARS } from './profile';

export type { JobPosting, JobSpec, Requirement, RequirementWeight } from './job';
export { MAX_JD_CHARS, MIN_JD_CHARS } from './job';

export type {
  BulletRewrite,
  EvidenceIssue,
  FitResult,
  PlannedSection,
  TailoringPlan,
  TailoringRequest,
  ValidatedPlan,
  XyzIssue,
} from './tailoring';

export type {
  CompletionRequest,
  CompletionResult,
  IAIProvider,
  ProviderConfig,
  ProviderFactory,
  ProviderId,
  TokenUsage,
  ValidationOutcome,
} from './provider';
export { CHARS_PER_TOKEN, estimateTokensByChars } from './provider';

export type { AppErrorInit, ErrorCode, RecoveryAction } from './errors';
export { AppError, isAppError } from './errors';
