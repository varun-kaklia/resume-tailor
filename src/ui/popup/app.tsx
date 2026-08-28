/**
 * Popup: paste or capture a posting, tailor against it, export.
 *
 * Quick Mode is the default and needs nothing configured — no profile, no key.
 * The posting can be captured from the page or pasted, and pasting is the
 * route that works everywhere, so it is always on screen rather than offered
 * after a failure.
 *
 * A model is one optional step at the end: "Improve with my model" hands the
 * same posting to the worker's existing provider call. That call plans from
 * scratch — it is a second, independent pass, not a rewording of the local
 * selection — so the two results are shown separately and the user can go back
 * to the version in their own words.
 */

import { useEffect, useState } from 'preact/hooks';
import template from '../../../templates/faangpath-simple.tex?raw';
import { quickTailor } from '../../core/plan/quick';
import { extractJobSpec } from '../../core/prompt/jobspec';
import { readResume } from '../../core/profile/read';
import { isAppError, MIN_JD_CHARS } from '../../core/types';
import { CAPTURE, TAILOR } from '../../shared/messages';
import { runtime, tabs } from '../../shared/runtime';
import { loadJobSpecCache, loadProfile, loadSettings, saveJobSpecCache } from '../../shared/storage';
import type { QuickResult } from '../../core/plan/quick';
import type { JobSpec, Profile } from '../../core/types';
import type { CaptureResult, Reply, TailorResult } from '../../shared/messages';

type Stage = 'loading' | 'idle' | 'capturing' | 'tailoring' | 'improving';

const ask = async <T,>(message: unknown): Promise<T> => {
  const reply = (await runtime().sendMessage(message)) as Reply<T> | undefined;
  if (reply === undefined) throw new Error('The extension worker did not respond. Try again.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
};

const messageOf = (thrown: unknown): string =>
  isAppError(thrown) ? thrown.userMessage : thrown instanceof Error ? thrown.message : 'Something went wrong.';

const saveTex = (latex: string): void => {
  const url = URL.createObjectURL(new Blob([latex], { type: 'application/x-tex' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'resume.tex';
  link.click();
  URL.revokeObjectURL(url);
};

const Export = ({ latex }: { latex: string }) => {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(latex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="steps">
      <button type="button" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy .tex'}
      </button>
      <button type="button" class="secondary" onClick={() => saveTex(latex)}>
        Download
      </button>
    </div>
  );
};

export const App = () => {
  const [stage, setStage] = useState<Stage>('loading');
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [configured, setConfigured] = useState(false);
  const [job, setJob] = useState('');
  const [resume, setResume] = useState('');
  /** Set when the user chooses to tailor a pasted resume over their saved profile. */
  const [pasting, setPasting] = useState(false);
  const [spec, setSpec] = useState<JobSpec | undefined>(undefined);
  const [quick, setQuick] = useState<QuickResult | undefined>(undefined);
  const [improved, setImproved] = useState<TailorResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const [saved, settings] = await Promise.all([
        loadProfile().catch(() => undefined),
        loadSettings().catch(() => undefined),
      ]);
      setProfile(saved);
      setConfigured(settings !== undefined);
      setStage('idle');
    })();
  }, []);

  const usingSaved = profile !== undefined && !pasting;
  const jobReady = spec !== undefined || job.trim().length >= MIN_JD_CHARS;
  const resumeReady = usingSaved || resume.trim() !== '';
  /** The worker reads the profile from storage, so an unsaved paste cannot use the Pro path. */
  const canImprove = configured && usingSaved && quick !== undefined;

  const reset = (): void => {
    setQuick(undefined);
    setImproved(undefined);
    setError(undefined);
  };

  const capture = async (): Promise<void> => {
    reset();
    setStage('capturing');
    try {
      const [tab] = await tabs().query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('No active tab to read.');
      const captured = await ask<CaptureResult>({ type: CAPTURE, tabId: tab.id });
      setSpec(captured.spec);
      setJob('');
    } catch (thrown) {
      setError(messageOf(thrown));
    } finally {
      setStage('idle');
    }
  };

  const tailor = (): void => {
    reset();
    setStage('tailoring');
    try {
      const source =
        spec ?? extractJobSpec({ text: job, capturedAt: new Date().toISOString(), source: 'paste' }).spec;
      const against = usingSaved && profile !== undefined ? profile : readResume(resume).profile;

      setSpec(source);
      setQuick(quickTailor(against, source, template));
    } catch (thrown) {
      setError(messageOf(thrown));
    } finally {
      setStage('idle');
    }
  };

  /**
   * Runs the posting through the Pro path unchanged.
   *
   * The spec is written to the cache first because the worker looks postings up
   * by hash — that is how a captured posting reaches it too, so a pasted one
   * takes the same route rather than needing a second message type.
   */
  const improve = async (): Promise<void> => {
    if (spec === undefined) return;
    setError(undefined);
    setStage('improving');
    try {
      const cache = await loadJobSpecCache();
      await saveJobSpecCache({ ...cache, [spec.sourceHash]: spec });
      setImproved(await ask<TailorResult>({ type: TAILOR, sourceHash: spec.sourceHash }));
    } catch (thrown) {
      setError(messageOf(thrown));
    } finally {
      setStage('idle');
    }
  };

  const busy = stage === 'capturing' || stage === 'tailoring' || stage === 'improving';

  if (stage === 'loading') return <p class="loading">Loading…</p>;

  return (
    <div>
      <section class="input">
        <div class="label-row">
          <span class="label">Job posting</span>
          <button type="button" class="link" onClick={() => void capture()} disabled={busy}>
            {stage === 'capturing' ? 'Reading page…' : 'Read this page'}
          </button>
        </div>

        {spec !== undefined && job.trim() === '' ? (
          <p class="captured-line">
            <strong>{spec.title}</strong>
            {spec.company !== undefined ? ` · ${spec.company}` : ''} · {spec.requirements.length} requirements
            <button
              type="button"
              class="link"
              onClick={() => {
                setSpec(undefined);
                reset();
              }}
            >
              clear
            </button>
          </p>
        ) : (
          <textarea
            rows={5}
            value={job}
            placeholder="Paste the job description here."
            onInput={(event) => {
              setJob((event.target as HTMLTextAreaElement).value);
              setSpec(undefined);
              reset();
            }}
          />
        )}
      </section>

      <section class="input">
        <span class="label">Your resume</span>
        {usingSaved ? (
          <p class="meta">
            Using your saved profile.
            <button type="button" class="link" onClick={() => runtime().openOptionsPage?.()}>
              edit
            </button>
          </p>
        ) : profile !== undefined ? (
          <p class="meta">
            Tailoring a pasted resume.
            <button
              type="button"
              class="link"
              onClick={() => {
                setPasting(false);
                reset();
              }}
            >
              use my saved profile
            </button>
          </p>
        ) : null}
        {usingSaved ? (
          <button type="button" class="link" onClick={() => setPasting(true)}>
            use a different resume
          </button>
        ) : (
          <textarea
            rows={5}
            value={resume}
            placeholder={profile === undefined ? 'Paste your resume here.' : 'Paste a different resume.'}
            onInput={(event) => {
              setResume((event.target as HTMLTextAreaElement).value);
              reset();
            }}
          />
        )}
      </section>

      <div class="steps">
        <button type="button" onClick={tailor} disabled={busy || !jobReady || !resumeReady}>
          {stage === 'tailoring' ? 'Tailoring…' : 'Tailor my resume'}
        </button>
      </div>

      {!jobReady && job.trim() !== '' ? (
        <p class="meta">That posting is too short to tailor against — paste the whole thing.</p>
      ) : null}

      {error !== undefined ? <p class="status status-error">{error}</p> : null}

      {quick !== undefined && improved === undefined ? (
        <section class="review">
          <p class={`fit fit-${quick.validated.fit.verdict}`}>
            {quick.selected} bullets selected, in your own words. About {quick.validated.fit.estimatedLines} of{' '}
            {quick.validated.fit.budgetLines} lines — an estimate.
          </p>

          {quick.trimmed.length > 0 ? (
            <p class="meta">
              Left out to keep one page: <span class="ids">{quick.trimmed.join(', ')}</span>
            </p>
          ) : null}

          {quick.unmatched.length > 0 ? (
            <p class="meta">
              Not mentioned anywhere in your profile: <span class="ids">{quick.unmatched.join(', ')}</span>
            </p>
          ) : null}

          <Export latex={quick.latex} />

          <div class="upgrade">
            {canImprove ? (
              <button type="button" class="secondary" onClick={() => void improve()} disabled={busy}>
                {stage === 'improving' ? 'Rewording…' : 'Improve with my model'}
              </button>
            ) : configured ? (
              <p class="meta">Save this resume as your profile to reword these bullets with your model.</p>
            ) : (
              <p class="meta">
                With your own AI key, a model can also reword these bullets toward the posting.
                <button type="button" class="link" onClick={() => runtime().openOptionsPage?.()}>
                  connect a model
                </button>
              </p>
            )}
          </div>
        </section>
      ) : null}

      {improved !== undefined ? (
        <section class="review">
          <p class={`fit fit-${improved.fit.verdict}`}>
            {improved.kept} bullets · {improved.changed.length} reworded · about{' '}
            {improved.usage.input + improved.usage.output} tokens
            {improved.usage.estimated ? ' (estimated)' : ''}
          </p>

          {improved.rejected.length > 0 ? (
            <div class="rejected">
              <h3>
                {improved.rejected.length} rewrite{improved.rejected.length === 1 ? '' : 's'} rejected
              </h3>
              <p class="meta">These added details your profile does not contain. Your original wording was kept.</p>
              {improved.rejected.map((issue) => (
                <div class="diff" key={issue.bulletId}>
                  <p class="bad">
                    <code>{issue.unsupported}</code> is not in your profile
                  </p>
                  <p class="was">{issue.original}</p>
                </div>
              ))}
            </div>
          ) : null}

          {improved.changed.length > 0 ? (
            <details class="changes">
              <summary>{improved.changed.length} bullets reworded</summary>
              {improved.changed.map((change) => (
                <div class="diff" key={change.bulletId}>
                  <p class="was">{change.original}</p>
                  <p class="now">{change.tailored}</p>
                </div>
              ))}
            </details>
          ) : null}

          <Export latex={improved.latex} />
          <button type="button" class="link" onClick={() => setImproved(undefined)}>
            back to the version in your own words
          </button>
        </section>
      ) : null}
    </div>
  );
};
