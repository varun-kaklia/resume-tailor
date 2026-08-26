/**
 * Content script entry point.
 *
 * Injected on demand when the user clicks the toolbar icon — there is no
 * declared content script and no host permission, so this code only ever runs
 * on a page the user explicitly acted on.
 *
 * It reads the posting once and hands it to the background worker. It renders
 * nothing, listens for nothing, and leaves the page unmodified.
 */

import { extractPosting } from './extract';
import { POSTING_CAPTURED } from '../shared/messages';
import { runtime } from '../shared/runtime';
import { isAppError } from '../core/types';

const capture = (): void => {
  try {
    const posting = extractPosting(document, {
      selection: window.getSelection()?.toString() ?? '',
      url: window.location.href,
    });
    void runtime().sendMessage({ type: POSTING_CAPTURED, posting });
  } catch (thrown) {
    // The background worker owns user-facing reporting; a failure here is only
    // ever a page this cannot read, and the popup will show that when it exists.
    if (!isAppError(thrown)) throw thrown;
  }
};

capture();
