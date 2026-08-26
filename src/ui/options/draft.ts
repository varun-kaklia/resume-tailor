/**
 * Settings form state and its validation.
 *
 * Kept separate from rendering so the rules that decide whether a
 * configuration is usable can be tested without a DOM, and so the same rules
 * govern both the save button and the connection test.
 */

import type { ProviderConfig, ProviderId } from '../../core/types';

export interface ProviderOption {
  readonly id: ProviderId;
  readonly label: string;
  /** Shown under the selector so the choice is not guesswork. */
  readonly hint: string;
  readonly needsApiKey: boolean;
  readonly needsBaseUrl: boolean;
  readonly exampleModel: string;
}

/**
 * Only providers with an implementation are offered.
 *
 * Listing Anthropic or Gemini before `src/providers` can serve them would
 * produce a settings screen that saves happily and then fails at tailoring
 * time, which is the worst place to discover it.
 */
export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'Uses api.openai.com. Your key is stored on this device only.',
    needsApiKey: true,
    needsBaseUrl: false,
    exampleModel: 'gpt-4o-mini',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (Ollama, LM Studio, OpenRouter)',
    hint: 'Any server speaking the OpenAI API. A local model costs nothing per tailoring.',
    needsApiKey: false,
    needsBaseUrl: true,
    exampleModel: 'llama3.1',
  },
];

export const optionFor = (id: ProviderId): ProviderOption =>
  PROVIDER_OPTIONS.find((option) => option.id === id) ?? PROVIDER_OPTIONS[0]!;

export interface Draft {
  readonly id: ProviderId;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl: string;
}

export const emptyDraft: Draft = { id: 'openai', model: '', apiKey: '', baseUrl: '' };

export const draftFrom = (config: ProviderConfig | undefined): Draft =>
  config === undefined
    ? emptyDraft
    : { id: config.id, model: config.model, apiKey: config.apiKey, baseUrl: config.baseUrl ?? '' };

/** Field-level problems, keyed by the field they belong to. */
export type DraftIssues = Partial<Record<keyof Draft, string>>;

export const validateDraft = (draft: Draft): DraftIssues => {
  const option = optionFor(draft.id);
  const issues: DraftIssues = {};

  if (draft.model.trim() === '') issues.model = `Enter a model, for example ${option.exampleModel}.`;
  if (option.needsApiKey && draft.apiKey.trim() === '') issues.apiKey = 'This provider needs an API key.';

  if (option.needsBaseUrl) {
    const url = draft.baseUrl.trim();
    if (url === '') {
      issues.baseUrl = 'Enter the server URL, for example http://localhost:11434/v1.';
    } else if (!/^https?:\/\/\S+$/i.test(url)) {
      issues.baseUrl = 'This does not look like a URL. It should start with http:// or https://.';
    }
  }
  return issues;
};

export const isUsable = (draft: Draft): boolean => Object.keys(validateDraft(draft)).length === 0;

/**
 * The draft as a stored config.
 *
 * A blank key is normalised to an empty string rather than dropped: local
 * models legitimately have none, and `ProviderConfig.apiKey` is not optional.
 */
export const toConfig = (draft: Draft): ProviderConfig => {
  const baseUrl = draft.baseUrl.trim();
  return {
    id: draft.id,
    model: draft.model.trim(),
    apiKey: draft.apiKey.trim(),
    ...(baseUrl !== '' ? { baseUrl } : {}),
  };
};
