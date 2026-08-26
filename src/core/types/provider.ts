/**
 * The AI provider seam.
 *
 * ResumeTailor is provider-agnostic: users bring their own key and model.
 * This is the *only* place the rest of the application learns that an AI
 * exists. Nothing outside `src/providers/` may import a vendor SDK or mention
 * a vendor name.
 *
 * Adding a provider = one file in `src/providers/` + one registry entry.
 * No core file changes.
 *
 * @see docs/architecture.md §7
 */

import type { AppError } from './errors';

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible';

export interface ProviderConfig {
  readonly id: ProviderId;
  /** Model identifier as the vendor spells it, e.g. `claude-sonnet-5`. */
  readonly model: string;
  /** Stays in `storage.local` on this device. Never synced, never logged. */
  readonly apiKey: string;
  /** For `openai-compatible`: Ollama, OpenRouter, LM Studio, a proxy. */
  readonly baseUrl?: string;
}

/**
 * A single completion.
 *
 * Deliberately not a chat transcript. ResumeTailor makes one-shot structured
 * requests; a message array would be shape the providers have to unpick again.
 */
export interface CompletionRequest {
  /** Role and hard constraints. Stable across calls, so it caches well. */
  readonly system: string;
  /** The variable part: profile index + JobSpec.
   */
  readonly user: string;
  /**
   * Require a JSON object back. Providers use whatever native mechanism they
   * have (`response_format`, a tool call, or prompt instruction as a last
   * resort) and must return parseable JSON in `CompletionResult.text`.
   */
  readonly expectJson: boolean;
  readonly maxOutputTokens: number;
  /** 0 for tailoring. Determinism matters more than flair here. */
  readonly temperature: number;
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
}

export interface CompletionResult {
  readonly text: string;
  /**
   * Reported by the provider when available, estimated otherwise.
   * `estimated: true` means do not present it as a cost.
   */
  readonly usage: TokenUsage & { readonly estimated: boolean };
  readonly model: string;
}

/** Result of a "Test connection" in settings. */
export type ValidationOutcome =
  | { readonly ok: true; readonly model: string }
  | { readonly ok: false; readonly error: AppError };

/**
 * Implemented once per vendor. Four methods, on purpose.
 *
 * Implementations MUST map every vendor failure to an `AppError` with a
 * specific code (401 → `AUTH_FAILED`, 429 → `RATE_LIMITED`, and so on).
 * A vendor error object must never escape this boundary — core handles four
 * failure cases, not forty.
 */
export interface IAIProvider {
  readonly id: ProviderId;
  /** Shown in the settings dropdown. */
  readonly label: string;

  /**
   * Perform one completion.
   * @throws {AppError} always — never a vendor error, never a bare `Error`.
   */
  complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult>;

  /**
   * Approximate token count, for the pre-flight cost estimate.
   *
   * A heuristic (characters ÷ ~3.7), not a tokenizer: bundling three vendor
   * tokenizers costs megabytes to sharpen a number the UI labels
   * "approximately" anyway (decision D-005).
   */
  estimateTokens(text: string): number;

  /**
   * Cheapest possible round-trip to prove this provider's key and model work.
   * Never throws — a bad key is an expected outcome here, not an exception.
   *
   * Takes no argument on purpose. It validates the config this provider was
   * built with, so there is exactly one to validate: an implementation cannot
   * test one key while holding another and still look correct under review.
   * Settings tests a draft by building a provider for it —
   * `createProvider(draft).validate()` — which is also the call the popup makes,
   * so the tested path and the used path are the same path.
   */
  validate(): Promise<ValidationOutcome>;

  /**
   * Optional. Nothing in `src/core/` calls this: validation needs the whole
   * response before it can accept anything, so streaming buys perceived speed
   * only. Present so a provider may offer it without widening the base contract.
   */
  stream?(req: CompletionRequest, onDelta: (chunk: string) => void, signal?: AbortSignal): Promise<CompletionResult>;
}

/** Builds a configured provider. One entry per `ProviderId` in the registry. */
export type ProviderFactory = (config: ProviderConfig) => IAIProvider;

/** Shared heuristic so every provider's estimate is consistently wrong, not differently wrong. */
export const CHARS_PER_TOKEN = 3.7;
export const estimateTokensByChars = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);
