/**
 * The one error type in ResumeTailor.
 *
 * Every failure — network, provider, validation, storage — becomes an `AppError`
 * with a machine-readable `code` and a `userMessage` written for a human.
 * Nothing else in the codebase may `throw new Error()`.
 *
 * @see docs/architecture.md §8
 */

/** Every way this application is allowed to fail. */
export type ErrorCode =
  // --- Configuration ---
  | 'NO_PROVIDER_CONFIGURED'
  | 'NO_API_KEY'
  | 'AUTH_FAILED'
  | 'MODEL_UNAVAILABLE'
  // --- Network / provider ---
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'CONTEXT_TOO_LARGE'
  | 'BAD_RESPONSE_SHAPE'
  // --- Profile ---
  | 'PROFILE_EMPTY'
  | 'PROFILE_INVALID'
  | 'UNKNOWN_ITEM_ID'
  // --- Job capture ---
  | 'JD_NOT_FOUND'
  | 'JD_TOO_SHORT'
  // --- Tailoring output ---
  | 'UNSUPPORTED_CLAIM'
  | 'PLAN_INVALID'
  // --- Render ---
  | 'DOES_NOT_FIT_ONE_PAGE'
  | 'RENDER_FAILED'
  // --- Platform ---
  | 'STORAGE_FAILED'
  | 'STORAGE_QUOTA'
  | 'UNKNOWN';

/** What the UI should offer the user after showing the message. */
export type RecoveryAction =
  | 'open_settings'
  | 'retry'
  | 'edit_profile'
  | 'paste_manually'
  | 'shorten_resume'
  | 'none';

export interface AppErrorInit {
  /** Overrides the default message for this code. Must be written for a human. */
  readonly userMessage?: string;
  /** Overrides the default recovery action. */
  readonly action?: RecoveryAction;
  /** Original failure. For the console only — never rendered. */
  readonly cause?: unknown;
  /** Non-sensitive debugging context. Never contains API keys or profile text. */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

/** Default user-facing message and recovery action for each code. */
const CATALOGUE: Readonly<Record<ErrorCode, readonly [message: string, action: RecoveryAction]>> = {
  NO_PROVIDER_CONFIGURED: [
    'No AI provider is set up yet. Choose a provider and add your API key to get started.',
    'open_settings',
  ],
  NO_API_KEY: ['Your API key is missing. Add it in settings — it stays on this device.', 'open_settings'],
  AUTH_FAILED: ['That API key was rejected. Check it in settings, or generate a new one.', 'open_settings'],
  MODEL_UNAVAILABLE: [
    'Your provider does not offer that model on this account. Pick a different model in settings.',
    'open_settings',
  ],

  NETWORK: ['Could not reach your AI provider. Check your internet connection and try again.', 'retry'],
  TIMEOUT: ['Your provider took too long to respond. Try again.', 'retry'],
  RATE_LIMITED: ['Your provider is rate-limiting requests. Wait a few seconds and try again.', 'retry'],
  PROVIDER_ERROR: ['Your AI provider returned an error. This is usually temporary — try again.', 'retry'],
  CONTEXT_TOO_LARGE: [
    'This job description is too long for the selected model. Try a model with a larger context window, or shorten the description.',
    'open_settings',
  ],
  BAD_RESPONSE_SHAPE: [
    'The model returned something we could not read. Smaller models sometimes do this — try again, or switch to a stronger model.',
    'retry',
  ],

  PROFILE_EMPTY: ['Add your experience to your profile first — tailoring needs something to work with.', 'edit_profile'],
  PROFILE_INVALID: ['Some profile fields are incomplete. Fix the highlighted fields and try again.', 'edit_profile'],
  UNKNOWN_ITEM_ID: [
    'The tailored result referenced something that is not in your profile, so it was discarded. Try again.',
    'retry',
  ],

  JD_NOT_FOUND: ['No job description found on this page. Select the description text and capture again.', 'paste_manually'],
  JD_TOO_SHORT: ['That job description is too short to tailor against. Select the full posting.', 'paste_manually'],

  UNSUPPORTED_CLAIM: [
    'A rewritten bullet contained details that are not in your profile, so it was rejected. Your original wording was kept.',
    'retry',
  ],
  PLAN_INVALID: ['The tailored result was incomplete and has been discarded. Try again.', 'retry'],

  DOES_NOT_FIT_ONE_PAGE: [
    'This resume will not fit on one page. Remove a few bullets, or reduce the font size in template settings.',
    'shorten_resume',
  ],
  RENDER_FAILED: ['Could not build the LaTeX file. Please report this with your profile export.', 'none'],

  STORAGE_FAILED: ['Could not save to browser storage. Check that storage is not blocked for extensions.', 'retry'],
  STORAGE_QUOTA: ['Browser storage is full. Remove old application history to free space.', 'none'],

  UNKNOWN: ['Something went wrong. Try again — if it keeps happening, please report it.', 'retry'],
};

/** Codes worth one automatic retry. Everything else fails immediately. */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['NETWORK', 'TIMEOUT', 'RATE_LIMITED']);

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly action: RecoveryAction;
  readonly retryable: boolean;
  readonly context?: Readonly<Record<string, string | number | boolean>>;

  constructor(code: ErrorCode, init: AppErrorInit = {}) {
    const [defaultMessage, defaultAction] = CATALOGUE[code];
    const userMessage = init.userMessage ?? defaultMessage;
    super(`[${code}] ${userMessage}`, { cause: init.cause });
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.action = init.action ?? defaultAction;
    this.retryable = RETRYABLE.has(code);
    if (init.context) this.context = init.context;
  }

  /**
   * Wraps anything thrown into an `AppError`.
   * Use at every boundary that catches: `catch (e) { throw AppError.from(e); }`
   */
  static from(thrown: unknown, fallback: ErrorCode = 'UNKNOWN'): AppError {
    return thrown instanceof AppError ? thrown : new AppError(fallback, { cause: thrown });
  }
}

/** Narrowing helper for `catch (e: unknown)`. */
export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
