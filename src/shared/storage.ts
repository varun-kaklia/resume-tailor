/**
 * Typed wrapper over `browser.storage.local`.
 *
 * This is one of the edges: platform APIs are allowed here, and nothing in
 * `src/core/` may import it (invariant #1).
 *
 * `storage.local` only, never `storage.sync` — the API key must not leave the
 * machine (decision D-009). Nothing in this file logs a value, because one of
 * them is that key.
 */

import { validateProfile } from '../core/profile/schema';
import { AppError } from '../core/types';
import type { JobSpec, Profile, ProviderConfig, ProviderId } from '../core/types';

/** The keys this extension owns. One typed accessor pair each — no stringly-typed bag. */
export type StorageKey = 'profile' | 'settings' | 'jobSpecCache';

/**
 * The slice of `browser.storage.local` we use.
 *
 * Declared structurally instead of pulling in `webextension-polyfill`: it keeps
 * the module runnable — and testable — in plain Node via `useStorageArea`.
 */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface ExtensionGlobal {
  readonly storage?: { readonly local?: StorageArea };
}

let injected: StorageArea | undefined;

/** Test seam. Pass `undefined` to fall back to the real extension API. */
export const useStorageArea = (area: StorageArea | undefined): void => {
  injected = area;
};

const area = (): StorageArea => {
  const global = globalThis as { chrome?: ExtensionGlobal; browser?: ExtensionGlobal };
  const found = injected ?? global.chrome?.storage?.local ?? global.browser?.storage?.local;
  if (!found) {
    throw new AppError('STORAGE_FAILED', {
      userMessage: 'Browser storage is unavailable, so nothing can be loaded or saved.',
      action: 'none',
    });
  }
  return found;
};

/** Browsers word quota failures differently, so this matches on the message. */
const storageError = (thrown: unknown): AppError => {
  if (thrown instanceof AppError) return thrown;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const code = /quota|exceed|too (?:large|big)/i.test(message) ? 'STORAGE_QUOTA' : 'STORAGE_FAILED';
  return new AppError(code, { cause: thrown });
};

const read = async (key: StorageKey): Promise<unknown> => {
  try {
    return (await area().get(key))[key];
  } catch (thrown) {
    throw storageError(thrown);
  }
};

const write = async (key: StorageKey, value: unknown): Promise<void> => {
  try {
    await area().set({ [key]: value });
  } catch (thrown) {
    throw storageError(thrown);
  }
};

/**
 * `undefined` when nothing has been saved yet.
 *
 * @throws {AppError} `PROFILE_INVALID` if what is stored is not a valid profile.
 *   Only validated profiles are ever written, so this means the data was
 *   corrupted or hand-edited — not something a form can fix field by field.
 */
export const loadProfile = async (): Promise<Profile | undefined> => {
  const raw = await read('profile');
  if (raw === undefined) return undefined;

  const result = validateProfile(raw);
  if (!result.ok) throw new AppError('PROFILE_INVALID', { context: { issues: result.issues.length } });
  return result.profile;
};

export const saveProfile = async (profile: Profile): Promise<void> => {
  await write('profile', profile);
};

const PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'openai-compatible'] as const satisfies readonly ProviderId[];

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * Builds the config rather than asserting one, so what comes back really is a
 * `ProviderConfig`: a missing key becomes `''`, which is how the provider layer
 * already spells "no key needed" (`authHeaders` in src/providers/openai.ts).
 */
const toProviderConfig = (value: unknown): ProviderConfig | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const stored = value as Record<string, unknown>;

  const id = PROVIDER_IDS.find((known) => known === stored['id']);
  const model = stored['model'];
  if (id === undefined || !text(model)) return undefined;

  const apiKey = typeof stored['apiKey'] === 'string' ? stored['apiKey'] : '';
  const baseUrl = typeof stored['baseUrl'] === 'string' ? stored['baseUrl'] : undefined;

  // A local model runs unauthenticated at a URL the user supplies; a hosted one needs the key.
  if (id === 'openai-compatible' ? !text(baseUrl) : !text(apiKey)) return undefined;

  return baseUrl === undefined ? { id, model, apiKey } : { id, model, apiKey, baseUrl };
};

/** `undefined` when unconfigured — or when what is stored is unusable, which is the same thing to the UI. */
export const loadSettings = async (): Promise<ProviderConfig | undefined> => toProviderConfig(await read('settings'));

export const saveSettings = async (settings: ProviderConfig): Promise<void> => {
  await write('settings', settings);
};

/** Shallow — a bad entry costs one re-extraction, so it is dropped rather than trusted or thrown over. */
const isJobSpec = (value: unknown): value is JobSpec => {
  if (typeof value !== 'object' || value === null) return false;
  const spec = value as Record<string, unknown>;
  return (
    text(spec['title']) &&
    text(spec['sourceHash']) &&
    Array.isArray(spec['requirements']) &&
    Array.isArray(spec['keywords']) &&
    typeof spec['heuristicOnly'] === 'boolean'
  );
};

/** Extracted `JobSpec`s keyed by `sourceHash`, so an unchanged posting never costs tokens again. */
export const loadJobSpecCache = async (): Promise<Record<string, JobSpec>> => {
  const raw = await read('jobSpecCache');
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, JobSpec] => isJobSpec(entry[1])));
};

export const saveJobSpecCache = async (cache: Record<string, JobSpec>): Promise<void> => {
  await write('jobSpecCache', cache);
};
