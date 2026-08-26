/**
 * Background service worker.
 *
 * Owns the two things a page cannot do safely: injecting the reader into the
 * active tab, and making the one network call the extension makes. Tailoring
 * runs here so that closing the popup does not abandon a request the user has
 * already paid for.
 */

import { extractJobSpec, needsModelFallback } from '../core/prompt/jobspec';
import { AppError, isAppError } from '../core/types';
import { isCaptureRequest, isPostingCaptured, isTailorRequest } from '../shared/messages';
import { runtime, scripting } from '../shared/runtime';
import { loadJobSpecCache, saveJobSpecCache } from '../shared/storage';
import { runTailoring } from './tailor';
import type { CaptureResult, Reply, TailorResult } from '../shared/messages';
import type { JobPosting } from '../core/types';

const CONTENT_SCRIPT = 'content.js';

/** How long the reader has to report back before capture is called a failure. */
const CAPTURE_TIMEOUT_MS = 5000;

/**
 * The injected reader reports asynchronously, so capture waits on the next
 * posting it sends rather than on the injection call, which resolves as soon as
 * the file is evaluated.
 */
let pending: ((posting: JobPosting) => void) | undefined;

const nextPosting = (): Promise<JobPosting> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = undefined;
      reject(new AppError('JD_NOT_FOUND'));
    }, CAPTURE_TIMEOUT_MS);

    pending = (posting) => {
      clearTimeout(timer);
      pending = undefined;
      resolve(posting);
    };
  });

const capture = async (tabId: number): Promise<CaptureResult> => {
  const arrival = nextPosting();
  await scripting().executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });

  const { spec, confidence, gaps } = extractJobSpec(await arrival);
  const cache = await loadJobSpecCache();
  await saveJobSpecCache({ ...cache, [spec.sourceHash]: spec });

  return { spec, confidence, needsModel: needsModelFallback({ spec, confidence, gaps }) };
};

const tailor = async (sourceHash: string, emphasis?: string): Promise<TailorResult> => {
  const spec = (await loadJobSpecCache())[sourceHash];
  if (spec === undefined) throw new AppError('JD_NOT_FOUND');
  return runTailoring(spec, emphasis);
};

const failed = (thrown: unknown): Reply<never> => ({
  ok: false,
  error: isAppError(thrown) ? thrown.userMessage : 'Something went wrong. Try again.',
});

/**
 * Returning `true` keeps the message channel open for the async reply, which
 * also keeps the worker alive until the work finishes.
 */
runtime().onMessage.addListener((message, _sender, respond) => {
  if (isPostingCaptured(message)) {
    pending?.(message.posting);
    return false;
  }

  if (isCaptureRequest(message)) {
    capture(message.tabId)
      .then((value) => respond({ ok: true, value }))
      .catch((thrown: unknown) => respond(failed(thrown)));
    return true;
  }

  if (isTailorRequest(message)) {
    tailor(message.sourceHash, message.emphasis)
      .then((value) => respond({ ok: true, value }))
      .catch((thrown: unknown) => respond(failed(thrown)));
    return true;
  }

  return false;
});
