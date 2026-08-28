/**
 * Step 1 — read an existing resume into a draft profile.
 *
 * Nothing here writes to storage. The draft is handed to the editor in step 2,
 * where the user confirms every field before the first save; an import the
 * user never approved is an import that never happened.
 *
 * The call runs here rather than in the worker (D-055 sends tailoring there):
 * the options page is a tab, not a popup, so it does not close under the user
 * and there is nothing for the worker to protect.
 *
 * Extraction needs a configured provider, which is step 3. Rather than reorder
 * the flow around an API-key form, this screen reports the gap and offers the
 * jump — and "fill it in by hand" stays open throughout, so a user without a
 * key is never stuck on the first screen of an extension they just installed.
 */

import { useEffect, useState } from 'preact/hooks';
import { buildImportRequest, parseImportedProfile, MAX_RESUME_CHARS, MIN_RESUME_CHARS } from '../../core/prompt/import';
import { isAppError } from '../../core/types';
import { createProvider } from '../../providers/registry';
import { loadSettings } from '../../shared/storage';
import type { Profile, ProviderConfig } from '../../core/types';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'error'; readonly message: string };

const readTextFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsText(file);
  });

export const ImportPanel = ({
  onImported,
  onSkip,
  onConnect,
}: {
  onImported: (profile: Profile) => void;
  /** Straight to the editor with a blank profile. */
  onSkip: () => void;
  /** Jump to the provider screen, when there is one to jump to. */
  onConnect?: (() => void) | undefined;
}) => {
  const [resume, setResume] = useState('');
  const [settings, setSettings] = useState<ProviderConfig | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .catch(() => setSettings(undefined))
      .finally(() => setLoaded(true));
  }, []);

  const length = resume.trim().length;
  const configured = settings !== undefined && settings.model.trim() !== '';
  const canExtract = configured && length >= MIN_RESUME_CHARS && length <= MAX_RESUME_CHARS && status.kind !== 'busy';

  const pick = async (event: Event): Promise<void> => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file === undefined) return;
    try {
      setResume(await readTextFile(file));
      setStatus({ kind: 'idle' });
    } catch {
      setStatus({ kind: 'error', message: 'That file could not be read. Paste the text instead.' });
    }
  };

  const extract = async (): Promise<void> => {
    if (settings === undefined) return;
    setStatus({ kind: 'busy' });
    try {
      const result = await createProvider(settings).complete(buildImportRequest(resume));
      onImported(parseImportedProfile(result.text));
    } catch (thrown) {
      setStatus({
        kind: 'error',
        message: isAppError(thrown) ? thrown.userMessage : 'Could not read that resume. Try again.',
      });
    }
  };

  if (!loaded) return <p class="loading">Loading…</p>;

  return (
    <div>
      <h1>Start from your resume</h1>
      <p class="lead">
        Paste the resume you already have. It is read once into the fields on the next screen, where you check every
        line before anything is saved. Your text goes to the model you configure and nowhere else.
      </p>

      {!configured ? (
        <p class="status status-error">
          No model is connected yet, and reading a resume is one call on your own key.{' '}
          {onConnect !== undefined ? (
            <button type="button" class="link" onClick={onConnect}>
              Connect a model first
            </button>
          ) : (
            'Add one in Settings.'
          )}{' '}
          Or fill your profile in by hand — nothing here is required.
        </p>
      ) : null}

      <label class="field">
        <span class="field-label">Your resume</span>
        <textarea
          rows={14}
          value={resume}
          placeholder="Paste the whole thing — contact details, roles, bullets, projects, education, skills."
          onInput={(event) => {
            setResume((event.target as HTMLTextAreaElement).value);
            setStatus({ kind: 'idle' });
          }}
        />
        <span class="budget">
          {length === 0
            ? 'Or choose a .txt file below.'
            : length < MIN_RESUME_CHARS
              ? `${length} characters — too short to read as a resume.`
              : length > MAX_RESUME_CHARS
                ? `${length.toLocaleString()} characters — too long to read in one pass. Paste a resume, not a full CV.`
                : `${length.toLocaleString()} characters.`}
        </span>
      </label>

      <label class="field">
        <span class="field-label">Or open a text file</span>
        <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void pick(event)} />
        <span class="field-hint">
          Plain text only. From a PDF, select all in your reader and paste above — it keeps the wording, which is all
          this needs.
        </span>
      </label>

      <div class="actions">
        <button type="button" disabled={!canExtract} onClick={() => void extract()}>
          {status.kind === 'busy' ? 'Reading…' : 'Read my resume'}
        </button>
        <button type="button" class="secondary" onClick={onSkip}>
          Skip, fill it in by hand
        </button>
      </div>

      {status.kind === 'error' ? <p class="status status-error">{status.message}</p> : null}
      {status.kind === 'busy' ? (
        <p class="status status-busy">One call to your provider. This usually takes a few seconds.</p>
      ) : null}

      <section class="note">
        <h2>What the model is allowed to do here</h2>
        <p>
          Restructure your own words into fields — nothing else. It is told not to improve a bullet, not to invent a
          date, and never to write a summary you did not write. Anything it cannot find is left blank for you to fill
          in, and every field is editable on the next screen before the first save.
        </p>
      </section>
    </div>
  );
};
