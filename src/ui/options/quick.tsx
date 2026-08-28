/**
 * Quick Mode — paste a resume and a posting, get a tailored page. No key.
 *
 * Everything here runs locally and synchronously: the resume is read by
 * `profile/read`, the posting by `prompt/jobspec`, the plan by `plan/local`.
 * Nothing leaves the browser, which makes this the most private path in the
 * product rather than the degraded one (D-067).
 *
 * What it produces is real output, not a preview (D-066). The bullets are
 * selected and ordered against the posting and rendered in the user's own
 * words. Connecting a model adds one thing — rewording toward the posting's
 * language — and the screen says exactly that rather than implying the result
 * is provisional.
 *
 * @see docs/architecture.md §4a
 */

import { useState } from 'preact/hooks';
import template from '../../../templates/faangpath-simple.tex?raw';
import { quickTailor } from '../../core/plan/quick';
import { extractJobSpec } from '../../core/prompt/jobspec';
import { readResume } from '../../core/profile/read';
import { isAppError, MIN_JD_CHARS } from '../../core/types';
import type { QuickResult } from '../../core/plan/quick';
import type { JobSpec, Profile } from '../../core/types';

interface Result extends QuickResult {
  readonly profile: Profile;
  readonly spec: JobSpec;
  /** True when the profile came from the paste box rather than from storage. */
  readonly fromPaste: boolean;
}

const download = (latex: string): void => {
  const url = URL.createObjectURL(new Blob([latex], { type: 'application/x-tex' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'resume.tex';
  link.click();
  URL.revokeObjectURL(url);
};

export const QuickPanel = ({
  savedProfile,
  onUseProfile,
  onConnect,
}: {
  /** When the user already has a profile, the resume box is optional. */
  savedProfile?: Profile | undefined;
  /** Hands the parsed draft to the editor. Quick Mode never saves it itself (D-071). */
  onUseProfile?: ((profile: Profile) => void) | undefined;
  onConnect?: (() => void) | undefined;
}) => {
  const [resume, setResume] = useState('');
  const [job, setJob] = useState('');
  const [result, setResult] = useState<Result | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  const usingSaved = savedProfile !== undefined && resume.trim() === '';
  const ready = job.trim().length >= MIN_JD_CHARS && (usingSaved || resume.trim() !== '');

  const run = (): void => {
    setError(undefined);
    setCopied(false);
    try {
      const profile = usingSaved && savedProfile !== undefined ? savedProfile : readResume(resume).profile;
      const { spec } = extractJobSpec({ text: job, capturedAt: new Date().toISOString(), source: 'paste' });

      setResult({ ...quickTailor(profile, spec, template), profile, spec, fromPaste: !usingSaved });
    } catch (thrown) {
      setResult(undefined);
      setError(isAppError(thrown) ? thrown.userMessage : 'Something went wrong reading that. Check both boxes and try again.');
    }
  };

  const copy = (latex: string): void => {
    void navigator.clipboard.writeText(latex).then(() => setCopied(true));
  };

  return (
    <div>
      <h1>Tailor a resume</h1>
      <p class="lead">
        Paste your resume and the job posting. Everything happens in this browser — no account, no API key, nothing
        sent anywhere.
      </p>

      <label class="field">
        <span class="field-label">Your resume</span>
        {usingSaved ? (
          <span class="field-hint">
            Using your saved profile. Paste a resume below to use a different one instead.
          </span>
        ) : null}
        <textarea
          rows={savedProfile === undefined ? 12 : 4}
          value={resume}
          placeholder={
            savedProfile === undefined
              ? 'Paste the whole thing — contact details, roles, bullets, projects, education, skills.'
              : 'Optional: paste a different resume.'
          }
          onInput={(event) => {
            setResume((event.target as HTMLTextAreaElement).value);
            setResult(undefined);
          }}
        />
      </label>

      <label class="field">
        <span class="field-label">The job posting</span>
        <textarea
          rows={10}
          value={job}
          placeholder="Paste the description. Requirements, responsibilities, the lot."
          onInput={(event) => {
            setJob((event.target as HTMLTextAreaElement).value);
            setResult(undefined);
          }}
        />
        <span class="budget">
          {job.trim().length === 0
            ? 'Pasting always works, including on the sites that hide their description from page capture.'
            : job.trim().length < MIN_JD_CHARS
              ? `${job.trim().length} characters — too short to tailor against. Paste the full posting.`
              : `${job.trim().length.toLocaleString()} characters.`}
        </span>
      </label>

      <div class="actions">
        <button type="button" disabled={!ready} onClick={run}>
          Tailor my resume
        </button>
      </div>

      {error !== undefined ? <p class="status status-error">{error}</p> : null}

      {result !== undefined ? (
        <section class="result">
          <h2>
            {result.spec.title}
            {result.spec.company !== undefined ? ` · ${result.spec.company}` : ''}
          </h2>
          <p class="field-hint">
            {result.selected} bullets selected and ordered against this posting, in your own words. Fit:{' '}
            {result.validated.fit.verdict} — an estimate, {result.validated.fit.estimatedLines} of{' '}
            {result.validated.fit.budgetLines} lines.
          </p>

          <div class="actions">
            <button type="button" onClick={() => copy(result.latex)}>
              {copied ? 'Copied' : 'Copy .tex'}
            </button>
            <button type="button" class="secondary" onClick={() => download(result.latex)}>
              Download .tex
            </button>
          </div>

          {result.trimmed.length > 0 ? (
            <p class="status">
              {result.trimmed.length} bullet{result.trimmed.length === 1 ? '' : 's'} left out to keep this to one page:{' '}
              <span class="ids">{result.trimmed.join(', ')}</span>. Shorten the ones you kept if you would rather have
              these back.
            </p>
          ) : null}

          {result.unmatched.length > 0 ? (
            <p class="status">
              Nothing in your profile mentions: <span class="ids">{result.unmatched.join(', ')}</span>. If you have done
              this work, add a bullet saying so — no tool can tailor toward something you have not written down.
            </p>
          ) : null}

          <div class="upsell">
            {result.fromPaste && onUseProfile !== undefined ? (
              <button type="button" class="secondary" onClick={() => onUseProfile(result.profile)}>
                Save this as my profile
              </button>
            ) : null}
            {onConnect !== undefined ? (
              <button type="button" class="link" onClick={onConnect}>
                Connect a model to reword bullets toward this posting
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section class="note">
        <h2>What a model would add</h2>
        <p>
          One thing: rewording your bullets toward the posting's language. Selection, ordering and the one-page fit are
          done here and cost nothing. Connect a key when you want the rewording — and note that this mode, which sends
          nothing anywhere, is the more private of the two.
        </p>
      </section>
    </div>
  );
};
