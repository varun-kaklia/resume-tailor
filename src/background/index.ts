/**
 * Background service worker.
 *
 * Two jobs for now: inject the content script when the toolbar icon is clicked,
 * and run whatever it captures through the job-spec pipeline, caching the
 * result by source hash so the same posting is never parsed twice.
 *
 * Network calls will live here too — a service worker is the only place in the
 * extension allowed to make them — but nothing here calls a provider yet. The
 * heuristic path costs no tokens, so capture stays free until tailoring exists.
 */

import { extractJobSpec, needsModelFallback } from '../core/prompt/jobspec';
import { isAppError } from '../core/types';
import { isPostingCaptured } from '../shared/messages';
import { action, runtime, scripting } from '../shared/runtime';
import { loadJobSpecCache, saveJobSpecCache } from '../shared/storage';

const CONTENT_SCRIPT = 'content.js';

const handlePosting = async (message: unknown): Promise<void> => {
  if (!isPostingCaptured(message)) return;

  try {
    const { spec, confidence, gaps } = extractJobSpec(message.posting);

    const cache = await loadJobSpecCache();
    if (cache[spec.sourceHash] === undefined) {
      await saveJobSpecCache({ ...cache, [spec.sourceHash]: spec });
    }

    console.info('[ResumeTailor] captured', {
      title: spec.title,
      requirements: spec.requirements.length,
      confidence,
      gaps,
      needsModel: needsModelFallback({ spec, confidence, gaps }),
      source: message.posting.source,
    });
  } catch (thrown) {
    console.warn('[ResumeTailor]', isAppError(thrown) ? thrown.userMessage : thrown);
  }
};

runtime().onMessage.addListener((message) => {
  void handlePosting(message);
});

action().onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void scripting()
    .executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT] })
    .catch((thrown: unknown) => {
      console.warn('[ResumeTailor] cannot read this page', thrown);
    });
});
