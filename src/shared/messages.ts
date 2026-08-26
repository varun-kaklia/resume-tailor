/**
 * The message contract between the content script and the background worker.
 *
 * One discriminated union, one type guard per direction. Messages cross a trust
 * boundary — anything on the page can post to an injected script — so nothing
 * is assumed about their shape.
 */

import type { JobPosting } from '../core/types';

export const POSTING_CAPTURED = 'posting-captured';

export interface PostingCaptured {
  readonly type: typeof POSTING_CAPTURED;
  readonly posting: JobPosting;
}

export type ContentMessage = PostingCaptured;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPosting = (value: unknown): value is JobPosting => {
  if (!isRecord(value)) return false;
  const source = value['source'];
  return (
    typeof value['text'] === 'string' &&
    typeof value['capturedAt'] === 'string' &&
    (source === 'page' || source === 'selection' || source === 'paste') &&
    (value['url'] === undefined || typeof value['url'] === 'string')
  );
};

export const isPostingCaptured = (value: unknown): value is PostingCaptured =>
  isRecord(value) && value['type'] === POSTING_CAPTURED && isPosting(value['posting']);
