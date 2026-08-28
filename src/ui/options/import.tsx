/**
 * Read an existing resume into a draft profile.
 *
 * Local first (D-068): `profile/read` parses ordinary resumes for nothing, in
 * no time, without a key. The model call is the escape hatch for a layout the
 * reader could not follow — offered when the reading comes back thin, and only
 * to users who have a provider configured.
 *
 * Nothing here writes to storage either way. The draft is handed to the editor,
 * where the user confirms every field before the first save; an import the user
 * never approved is an import that never happened (D-060).
 *
 * The model call runs here rather than in the worker (D-055 sends tailoring
 * there): the options page is a tab, not a popup, so it does not close under
 * the user and there is nothing for the worker to protect.
 */

import { useEffect, useState } from 'preact/hooks';
import { buildImportRequest, parseImportedProfile, MAX_RESUME_CHARS, MIN_RESUME_CHARS } from '../../core/prompt/import';
import { MIN_READABLE_CHARS, needsModelImport, readResume } from '../../core/profile/read';
import { isAppError } from '../../core/types';
import { createProvider } from '../../providers/registry';
import { loadSettings } from '../../shared/storage';
import type { Profile, ProviderConfig } from '../../core/types';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'error'; readonly message: string }
  /** The local reader ran and did not find enough. The model is worth offering. */
  | { readonly kind: 'thin'; readonly message: string };

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
  const canRead = length >= MIN_READABLE_CHARS && status.kind !== 'busy';
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

  /**
   * The default path: no key, no request, no wait.
   *
   * A thin reading is reported rather than thrown away — the draft still goes
   * to the editor, and the model is offered as a second opinion for the parts
   * the reader missed.
   */
  const read = (): void => {
    try {
      const reading = readResume(resume);
      if (needsModelImport(reading) && configured) {
        setStatus({
          kind: 'thin',
          message: 'That layout was hard to follow — roles or bullets are missing. Your model may read it better.',
        });
      }
      onImported(reading.profile);
    } catch (thrown) {
      setStatus({
        kind: 'error',
        message: isAppError(thrown) ? thrown.userMessage : 'Could not read that resume. Try pasting it as plain text.',
      });
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
        Paste the resume you already have. It is read into the fields on the next screen, where you check every line
        before anything is saved. Reading happens in this browser and needs no key.
      </p>

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
        <button type="button" disabled={!canRead} onClick={read}>
          Read my resume
        </button>
        <button type="button" class="secondary" onClick={onSkip}>
          Skip, fill it in by hand
        </button>
      </div>

      {status.kind === 'error' ? <p class="status status-error">{status.message}</p> : null}
      {status.kind === 'busy' ? (
        <p class="status status-busy">One call to your provider. This usually takes a few seconds.</p>
      ) : null}
      {status.kind === 'thin' ? <p class="status status-error">{status.message}</p> : null}

      {configured ? (
        <p class="field-hint">
          Unusual layout — two columns, a table, no bullet markers?{' '}
          <button type="button" class="link" disabled={!canExtract} onClick={() => void extract()}>
            Read it with your model instead
          </button>{' '}
          — one call on your key.
        </p>
      ) : onConnect !== undefined ? (
        <p class="field-hint">
          If the reader struggles with your layout, a model can do better.{' '}
          <button type="button" class="link" onClick={onConnect}>
            Connect one
          </button>{' '}
          — optional, and never needed to fill this in by hand.
        </p>
      ) : null}

      <section class="note">
        <h2>What happens to your resume</h2>
        <p>
          Reading it here is structure only — headings, dates, bullet markers — and the text never leaves this browser.
          If you ask your model to read it instead, it is told to restructure your own words and nothing else: no
          improved bullets, no invented dates, no summary you did not write. Either way, anything that could not be
          read is left blank for you to fill in, and every field is editable on the next screen before the first save.
        </p>
      </section>
    </div>
  );
};
