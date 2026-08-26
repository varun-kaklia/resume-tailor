/**
 * The one place a `ProviderId` becomes an implementation.
 *
 * Adding a provider is one file plus one line here (architecture §7). Partial
 * on purpose: an id with no entry yet is a configuration error, not a crash.
 */

import { AppError } from '../core/types';
import type { IAIProvider, ProviderConfig, ProviderFactory, ProviderId } from '../core/types';
import { createOpenAiProvider } from './openai';
import { createOpenAiCompatibleProvider } from './openai-compatible';

export const PROVIDERS: Partial<Readonly<Record<ProviderId, ProviderFactory>>> = {
  openai: createOpenAiProvider,
  'openai-compatible': createOpenAiCompatibleProvider,
};

export const createProvider = (config: ProviderConfig): IAIProvider => {
  const factory = PROVIDERS[config.id];
  if (!factory) throw new AppError('NO_PROVIDER_CONFIGURED', { context: { id: config.id } });
  return factory(config);
};
