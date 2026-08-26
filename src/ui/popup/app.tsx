/**
 * Popup: capture a posting, tailor against it, review what changed, export.
 *
 * The review step is the point of the screen. A user who cannot see what the
 * model changed has no reason to trust that it changed nothing it should not.
 */

import { useEffect, useState } from 'preact/hooks';
import { CAPTURE, TAILOR } from '../../shared/messages';
import { runtime, tabs } from '../../shared/runtime';
import { loadProfile, loadSettings } from '../../shared/storage';
import type { CaptureResult, Reply, TailorResult } from '../../shared/messages';

type Stage = 'checking' | 'ready' | 'capturing' | 'captured' | 'tailoring' | 'done';

const ask = async <T,>(message: unknown): Promise<T> => {
  const reply = (await runtime().sendMessage(message)) as Reply<T> | undefined;
  if (reply === undefined) throw new Error('The extension worker did not respond. Try again.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
};

const Setup = ({ missing }: { missing: string[] }) => (
  <section class="notice">
    <p>Before tailoring you need {missing.join(' and ')}.</p>
    <button type="button" onClick={() => runtime().openOptionsPage?.()}>
      Open settings
    </button>
  </section>
);

export const App = () => {
  const [stage, setStage] = useState<Stage>('checking');
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [captured, setCaptured] = useState<CaptureResult>();
  const [result, setResult] = useState<TailorResult>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      const [profile, settings] = await Promise.all([loadProfile().catch(() => undefined), loadSettings()]);
      const gaps: string[] = [];
      if (profile === undefined || (profile.experience.length === 0 && profile.projects.length === 0)) {
        gaps.push('a profile');
      }
      if (settings === undefined) gaps.push('an AI provider');
      setMissing(gaps);
      setStage('ready');
    })();
  }, []);

  const run = async (work: () => Promise<void>, busy: Stage, settled: Stage): Promise<void> => {
    setError(undefined);
    setStage(busy);
    try {
      await work();
      setStage(settled);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Something went wrong.');
      setStage(settled === 'done' ? 'captured' : 'ready');
    }
  };

  const capture = (): Promise<void> =>
    run(
      async () => {
        const [tab] = await tabs().query({ active: true, currentWindow: true });
        if (tab?.id === undefined) throw new Error('No active tab to read.');
        setCaptured(await ask<CaptureResult>({ type: CAPTURE, tabId: tab.id }));
        setResult(undefined);
      },
      'capturing',
      'captured',
    );

  const tailor = (): Promise<void> =>
    run(
      async () => {
        if (captured === undefined) throw new Error('Capture a posting first.');
        setResult(await ask<TailorResult>({ type: TAILOR, sourceHash: captured.spec.sourceHash }));
      },
      'tailoring',
      'done',
    );

  const copy = async (): Promise<void> => {
    if (result === undefined) return;
    await navigator.clipboard.writeText(result.latex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = (): void => {
    if (result === undefined) return;
    const url = URL.createObjectURL(new Blob([result.latex], { type: 'application/x-tex' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'resume.tex';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (stage === 'checking') return <p class="loading">Loading…</p>;
  if (missing.length > 0) return <Setup missing={missing} />;

  return (
    <div>
      <div class="steps">
        <button type="button" onClick={() => void capture()} disabled={stage === 'capturing' || stage === 'tailoring'}>
          {stage === 'capturing' ? 'Reading page…' : captured === undefined ? 'Capture this posting' : 'Capture again'}
        </button>
        {captured !== undefined ? (
          <button
            type="button"
            class="secondary"
            onClick={() => void tailor()}
            disabled={stage === 'tailoring' || stage === 'capturing'}
          >
            {stage === 'tailoring' ? 'Tailoring…' : 'Tailor resume'}
          </button>
        ) : null}
      </div>

      {error !== undefined ? (
        <p class="status status-error">
          {error}
          {error.toLowerCase().includes('select') || error.toLowerCase().includes('no job description') ? (
            <span class="hint"> Select the description text on the page, then capture again.</span>
          ) : null}
        </p>
      ) : null}

      {captured !== undefined ? (
        <section class="captured">
          <h2>{captured.spec.title}</h2>
          <p class="meta">
            {captured.spec.company !== undefined ? `${captured.spec.company} · ` : ''}
            {captured.spec.requirements.length} requirements
            {captured.needsModel ? ' · low confidence, check the page was read correctly' : ''}
          </p>
          <ul class="terms">
            {captured.spec.requirements.slice(0, 12).map((requirement) => (
              <li key={requirement.term} class={requirement.weight}>
                {requirement.term}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result !== undefined ? (
        <section class="review">
          <h2>Review</h2>
          <p class={`fit fit-${result.fit.verdict}`}>
            {result.fit.verdict === 'ok'
              ? `Fits one page — about ${result.fit.estimatedLines} of ${result.fit.budgetLines} lines.`
              : `Tight — about ${result.fit.estimatedLines} of ${result.fit.budgetLines} lines. Estimated, not measured.`}
          </p>
          <p class="meta">
            {result.kept} bullets selected · {result.changed.length} reworded · about {result.usage.input + result.usage.output}{' '}
            tokens{result.usage.estimated ? ' (estimated)' : ''}
          </p>

          {result.rejected.length > 0 ? (
            <div class="rejected">
              <h3>{result.rejected.length} rewrite{result.rejected.length === 1 ? '' : 's'} rejected</h3>
              <p class="meta">These added details your profile does not contain. Your original wording was kept.</p>
              {result.rejected.map((issue) => (
                <div class="diff" key={issue.bulletId}>
                  <p class="bad">
                    <code>{issue.unsupported}</code> is not in your profile
                  </p>
                  <p class="was">{issue.original}</p>
                </div>
              ))}
            </div>
          ) : null}

          {result.changed.length > 0 ? (
            <details class="changes">
              <summary>{result.changed.length} bullets reworded</summary>
              {result.changed.map((change) => (
                <div class="diff" key={change.bulletId}>
                  <p class="was">{change.original}</p>
                  <p class="now">{change.tailored}</p>
                </div>
              ))}
            </details>
          ) : null}

          <div class="steps">
            <button type="button" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy .tex'}
            </button>
            <button type="button" class="secondary" onClick={download}>
              Download
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
};
