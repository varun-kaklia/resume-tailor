/**
 * Anything that speaks the OpenAI wire format at a URL the user supplies:
 * Ollama, LM Studio, OpenRouter, a corporate proxy.
 *
 * The zero-cost path — a local model means no key, no bill, and nothing leaving
 * the machine — so it reuses the OpenAI implementation rather than repeating it.
 */

import { AppError } from '../core/types';
import type { ProviderFactory } from '../core/types';
import { createWireProvider } from './openai';

export const createOpenAiCompatibleProvider: ProviderFactory = (config) => {
  if (!config.baseUrl?.trim()) {
    throw new AppError('NO_PROVIDER_CONFIGURED', {
      userMessage: 'This provider needs a server URL — for example http://localhost:11434/v1 for Ollama. Add it in settings.',
    });
  }
  return createWireProvider(config, {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (Ollama, LM Studio, OpenRouter)',
    requiresApiKey: false,
  });
};
