import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/core/types';
import type { Profile, ProviderConfig } from '../src/core/types';
import {
  loadJobSpecCache,
  loadProfile,
  loadSettings,
  saveJobSpecCache,
  saveProfile,
  saveSettings,
  useStorageArea,
} from '../src/shared/storage';
import type { StorageArea } from '../src/shared/storage';

/** In-memory stand-in for `browser.storage.local`. */
const fakeArea = (failWith?: Error): StorageArea & { readonly data: Record<string, unknown> } => {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key) => {
      if (failWith) throw failWith;
      return key in data ? { [key]: data[key] } : {};
    },
    set: async (items) => {
      if (failWith) throw failWith;
      Object.assign(data, items);
    },
  };
};

const profile: Profile = {
  version: 1,
  contact: { fullName: 'Test User', email: 't@example.com' },
  education: [],
  projects: [],
  skills: [],
  updatedAt: '2026-08-26T00:00:00.000Z',
  experience: [
    { id: 'e1', company: 'Contract Studio', title: 'SDE', dates: { start: '2025-07', end: '2026-01' }, bullets: [] },
  ],
};

const settings: ProviderConfig = { id: 'anthropic', model: 'claude-sonnet-5', apiKey: 'not-a-real-key' };

const codeThrownBy = async (call: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await call();
    return undefined;
  } catch (thrown) {
    return thrown instanceof AppError ? thrown.code : 'not an AppError';
  }
};

afterEach(() => {
  useStorageArea(undefined);
});

describe('storage', () => {
  it('round-trips a profile, a settings object and the job spec cache', async () => {
    useStorageArea(fakeArea());

    expect(await loadProfile()).toBeUndefined();
    expect(await loadSettings()).toBeUndefined();
    expect(await loadJobSpecCache()).toEqual({});

    await saveProfile(profile);
    await saveSettings(settings);
    await saveJobSpecCache({
      abc: { title: 'SDE', requirements: [], keywords: [], sourceHash: 'abc', heuristicOnly: true },
    });

    expect((await loadProfile())?.contact.fullName).toBe('Test User');
    expect(await loadSettings()).toEqual(settings);
    expect(Object.keys(await loadJobSpecCache())).toEqual(['abc']);
  });

  it('round-trips a user-authored role note without altering it', async () => {
    useStorageArea(fakeArea());
    const withNote: Profile = {
      ...profile,
      experience: [{ ...profile.experience[0]!, note: '  Contract engagement — my own wording.  ' }],
    };
    await saveProfile(withNote);

    // Storage stores; it does not author, trim, or inject. The note comes back byte-identical.
    expect((await loadProfile())?.experience[0]?.note).toBe('  Contract engagement — my own wording.  ');
  });

  it('stores a profile with no note at all, adding nothing', async () => {
    useStorageArea(fakeArea());
    await saveProfile(profile);

    expect((await loadProfile())?.experience[0]?.note).toBeUndefined();
  });

  it('rejects a corrupted stored profile instead of returning it', async () => {
    const area = fakeArea();
    useStorageArea(area);
    area.data['profile'] = { ...profile, contact: { fullName: 'X', email: 'nope' } };

    expect(await codeThrownBy(loadProfile)).toBe('PROFILE_INVALID');
  });

  it('ignores settings that are not usable rather than handing back a broken config', async () => {
    const area = fakeArea();
    useStorageArea(area);
    area.data['settings'] = { id: 'not-a-provider', model: 'x', apiKey: 'y' };

    expect(await loadSettings()).toBeUndefined();
  });

  it('keeps a local provider configured without an API key, but not a hosted one', async () => {
    const area = fakeArea();
    useStorageArea(area);

    const ollama: ProviderConfig = { id: 'openai-compatible', model: 'llama3', apiKey: '', baseUrl: 'http://localhost:11434/v1' };
    area.data['settings'] = ollama;
    expect(await loadSettings()).toEqual(ollama);

    const { apiKey: _omitted, ...noKeyField } = ollama;
    area.data['settings'] = noKeyField;
    expect(await loadSettings()).toEqual(ollama);

    area.data['settings'] = { ...ollama, baseUrl: '' };
    expect(await loadSettings()).toBeUndefined();

    area.data['settings'] = { ...settings, apiKey: '' };
    expect(await loadSettings()).toBeUndefined();
  });

  it('drops malformed job spec cache entries and keeps the rest', async () => {
    const area = fakeArea();
    useStorageArea(area);
    area.data['jobSpecCache'] = {
      good: { title: 'SDE', requirements: [], keywords: [], sourceHash: 'good', heuristicOnly: true },
      bad: { title: 'SDE', sourceHash: 'bad' },
    };

    expect(Object.keys(await loadJobSpecCache())).toEqual(['good']);
  });

  it('maps a quota overrun and a generic failure to their own codes', async () => {
    useStorageArea(fakeArea(new Error('QUOTA_BYTES quota exceeded')));
    expect(await codeThrownBy(() => saveProfile(profile))).toBe('STORAGE_QUOTA');

    useStorageArea(fakeArea(new Error('storage is disabled')));
    expect(await codeThrownBy(() => saveProfile(profile))).toBe('STORAGE_FAILED');
  });

  it('fails with an AppError when there is no storage area at all', async () => {
    expect(await codeThrownBy(loadProfile)).toBe('STORAGE_FAILED');
  });
});
