import { describe, expect, it } from 'vitest';
import {
  PROVIDER_OPTIONS,
  draftFrom,
  emptyDraft,
  isUsable,
  optionFor,
  toConfig,
  validateDraft,
} from '../src/ui/options/draft';
import { createProvider } from '../src/providers/registry';
import type { Draft } from '../src/ui/options/draft';
import type { ProviderConfig } from '../src/core/types';

const hosted: Draft = { id: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-EXAMPLE-NOT-REAL', baseUrl: '' };
const local: Draft = { id: 'openai-compatible', model: 'llama3.1', apiKey: '', baseUrl: 'http://localhost:11434/v1' };

describe('provider options', () => {
  it('offers only providers that have an implementation', () => {
    for (const option of PROVIDER_OPTIONS) {
      expect(() => createProvider({ id: option.id, model: 'm', apiKey: 'k', baseUrl: 'http://localhost/v1' })).not.toThrow();
    }
  });

  it('falls back to a known option for an unrecognised id', () => {
    expect(optionFor('gemini').id).toBe('openai');
  });
});

describe('validateDraft', () => {
  it('accepts a complete hosted configuration', () => {
    expect(validateDraft(hosted)).toEqual({});
    expect(isUsable(hosted)).toBe(true);
  });

  it('accepts a local configuration with no key at all', () => {
    expect(validateDraft(local)).toEqual({});
    expect(isUsable(local)).toBe(true);
  });

  it('requires a key only where the provider needs one', () => {
    expect(validateDraft({ ...hosted, apiKey: '  ' }).apiKey).toMatch(/\w/);
    expect(validateDraft({ ...local, apiKey: '' }).apiKey).toBeUndefined();
  });

  it('requires a server URL for a local provider', () => {
    expect(validateDraft({ ...local, baseUrl: '' }).baseUrl).toMatch(/\w/);
  });

  it('rejects a server URL that is not one', () => {
    expect(validateDraft({ ...local, baseUrl: 'localhost:11434' }).baseUrl).toMatch(/http/);
  });

  it('always requires a model, and names an example', () => {
    expect(validateDraft({ ...hosted, model: '' }).model).toContain('gpt-4o-mini');
    expect(validateDraft({ ...local, model: '' }).model).toContain('llama3.1');
  });

  it('gives every issue a message a person can act on', () => {
    for (const message of Object.values(validateDraft(emptyDraft))) {
      expect(message).toMatch(/[a-z]{3}/);
    }
  });
});

describe('toConfig', () => {
  it('trims values and omits an unused base URL', () => {
    expect(toConfig({ ...hosted, model: '  gpt-4o-mini  ' })).toEqual({
      id: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-EXAMPLE-NOT-REAL',
    });
  });

  it('keeps a blank key as an empty string so the config matches its type', () => {
    const config = toConfig(local);

    expect(config.apiKey).toBe('');
    expect(config.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('produces a config the registry accepts', () => {
    expect(() => createProvider(toConfig(local))).not.toThrow();
    expect(() => createProvider(toConfig(hosted))).not.toThrow();
  });
});

describe('draftFrom', () => {
  it('round-trips a saved configuration', () => {
    const saved: ProviderConfig = { id: 'openai-compatible', model: 'llama3.1', apiKey: '', baseUrl: 'http://x/v1' };

    expect(toConfig(draftFrom(saved))).toEqual(saved);
  });

  it('starts empty when nothing is saved', () => {
    expect(draftFrom(undefined)).toEqual(emptyDraft);
  });

  it('represents an absent base URL as a blank field', () => {
    expect(draftFrom({ id: 'openai', model: 'm', apiKey: 'k' }).baseUrl).toBe('');
  });
});
