/**
 * Settings screen: choose a provider, store a key, prove it works.
 *
 * The connection test builds a provider from the draft and calls the same
 * `validate()` the tailoring path uses, so a passing test here means the
 * configuration will work when it matters.
 */

import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { createProvider } from '../../providers/registry';
import { isAppError } from '../../core/types';
import { loadSettings, saveSettings } from '../../shared/storage';
import { PROVIDER_OPTIONS, draftFrom, emptyDraft, isUsable, optionFor, toConfig, validateDraft } from './draft';
import type { Draft } from './draft';
import type { ProviderId } from '../../core/types';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly message: string }
  | { readonly kind: 'ok'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

const Field = ({
  label,
  hint,
  issue,
  children,
}: {
  label: string;
  hint?: string | undefined;
  issue?: string | undefined;
  children: ComponentChildren;
}) => (
  <label class="field">
    <span class="field-label">{label}</span>
    {children}
    {issue !== undefined ? <span class="field-issue">{issue}</span> : hint !== undefined ? <span class="field-hint">{hint}</span> : null}
  </label>
);

export const SettingsPanel = () => {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    loadSettings()
      .then((saved) => setDraft(draftFrom(saved)))
      .catch((thrown: unknown) => {
        setStatus({ kind: 'error', message: isAppError(thrown) ? thrown.userMessage : 'Could not read saved settings.' });
      })
      .finally(() => setLoaded(true));
  }, []);

  const option = optionFor(draft.id);
  // Issues stay hidden until the user has tried something, so an untouched
  // form does not open covered in complaints.
  const issues = touched ? validateDraft(draft) : {};
  const update = (patch: Partial<Draft>): void => {
    setDraft({ ...draft, ...patch });
    setStatus({ kind: 'idle' });
  };

  const test = async (): Promise<void> => {
    setTouched(true);
    if (!isUsable(draft)) return;

    setStatus({ kind: 'busy', message: 'Testing…' });
    try {
      const outcome = await createProvider(toConfig(draft)).validate();
      setStatus(
        outcome.ok
          ? { kind: 'ok', message: `Connected. ${outcome.model} is available.` }
          : { kind: 'error', message: outcome.error.userMessage },
      );
    } catch (thrown) {
      setStatus({ kind: 'error', message: isAppError(thrown) ? thrown.userMessage : 'Could not reach that provider.' });
    }
  };

  const save = async (): Promise<void> => {
    setTouched(true);
    if (!isUsable(draft)) return;

    try {
      await saveSettings(toConfig(draft));
      setStatus({ kind: 'ok', message: 'Saved.' });
    } catch (thrown) {
      setStatus({ kind: 'error', message: isAppError(thrown) ? thrown.userMessage : 'Could not save settings.' });
    }
  };

  if (!loaded) return <p class="loading">Loading…</p>;

  return (
    <div>
      <h1>Settings</h1>
      <p class="lead">
        Bring your own key. Requests go from this browser straight to the provider you choose — there is no server in
        between.
      </p>

      <Field label="Provider" hint={option.hint}>
        <select
          value={draft.id}
          onChange={(event) => update({ id: (event.target as HTMLSelectElement).value as ProviderId })}
        >
          {PROVIDER_OPTIONS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Model" hint={`For example ${option.exampleModel}.`} issue={issues.model}>
        <input
          type="text"
          value={draft.model}
          placeholder={option.exampleModel}
          spellcheck={false}
          onInput={(event) => update({ model: (event.target as HTMLInputElement).value })}
        />
      </Field>

      {option.needsBaseUrl ? (
        <Field label="Server URL" hint="Ollama runs at http://localhost:11434/v1 by default." issue={issues.baseUrl}>
          <input
            type="url"
            value={draft.baseUrl}
            placeholder="http://localhost:11434/v1"
            spellcheck={false}
            onInput={(event) => update({ baseUrl: (event.target as HTMLInputElement).value })}
          />
        </Field>
      ) : null}

      <Field
        label={option.needsApiKey ? 'API key' : 'API key (optional)'}
        hint={option.needsApiKey ? undefined : 'Local servers usually need no key. Leave blank if yours does not.'}
        issue={issues.apiKey}
      >
        <input
          type="password"
          value={draft.apiKey}
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => update({ apiKey: (event.target as HTMLInputElement).value })}
        />
      </Field>

      <div class="actions">
        <button type="button" onClick={() => void save()}>
          Save
        </button>
        <button type="button" class="secondary" onClick={() => void test()} disabled={status.kind === 'busy'}>
          Test connection
        </button>
      </div>

      {status.kind !== 'idle' ? <p class={`status status-${status.kind}`}>{status.message}</p> : null}

      <section class="note">
        <h2>Where your key is kept</h2>
        <p>
          Your key is stored in this browser's extension storage, on this device. It is never synced and never sent
          anywhere except the provider above. That storage is not encrypted, so anyone with access to this browser
          profile can read it — use a key with a spending limit, and rotate it if you share the machine. If you would
          rather not store a key at all, point ResumeTailor at a local model instead.
        </p>
      </section>
    </div>
  );
};
