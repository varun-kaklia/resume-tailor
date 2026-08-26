/**
 * The message contract between the extension's pages and its worker.
 *
 * One discriminated union per direction, with a type guard for anything that
 * arrives. Messages cross a trust boundary — a page can post to an injected
 * script — so nothing is assumed about their shape.
 */

import type { JobPosting, JobSpec } from '../core/types';

export const POSTING_CAPTURED = 'posting-captured';
export const CAPTURE = 'capture';
export const TAILOR = 'tailor';

export interface PostingCaptured {
  readonly type: typeof POSTING_CAPTURED;
  readonly posting: JobPosting;
}

/** Popup asks the worker to read the active tab. */
export interface CaptureRequest {
  readonly type: typeof CAPTURE;
  readonly tabId: number;
}

/** Popup asks the worker to tailor against an already-captured posting. */
export interface TailorRequest {
  readonly type: typeof TAILOR;
  readonly sourceHash: string;
  readonly emphasis?: string;
}

export type Message = PostingCaptured | CaptureRequest | TailorRequest;

/** Every worker reply is either a value or a message a person can read. */
export type Reply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface CaptureResult {
  readonly spec: JobSpec;
  readonly confidence: number;
  readonly needsModel: boolean;
}

export interface TailorResult {
  readonly latex: string;
  readonly fit: { readonly verdict: 'ok' | 'tight' | 'over'; readonly estimatedLines: number; readonly budgetLines: number };
  readonly rejected: readonly { readonly bulletId: string; readonly unsupported: string; readonly original: string; readonly rewritten: string }[];
  readonly changed: readonly { readonly bulletId: string; readonly original: string; readonly tailored: string }[];
  readonly kept: number;
  readonly usage: { readonly input: number; readonly output: number; readonly estimated: boolean };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

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

export const isCaptureRequest = (value: unknown): value is CaptureRequest =>
  isRecord(value) && value['type'] === CAPTURE && typeof value['tabId'] === 'number';

export const isTailorRequest = (value: unknown): value is TailorRequest =>
  isRecord(value) &&
  value['type'] === TAILOR &&
  typeof value['sourceHash'] === 'string' &&
  (value['emphasis'] === undefined || typeof value['emphasis'] === 'string');
