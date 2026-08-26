import { describe, expect, it } from 'vitest';
import {
  CAPTURE,
  POSTING_CAPTURED,
  TAILOR,
  isCaptureRequest,
  isPostingCaptured,
  isTailorRequest,
} from '../src/shared/messages';

const posting = { text: 'a posting', capturedAt: '2026-08-26T00:00:00.000Z', source: 'page' };

describe('message guards', () => {
  it('accepts the messages the extension sends', () => {
    expect(isPostingCaptured({ type: POSTING_CAPTURED, posting })).toBe(true);
    expect(isCaptureRequest({ type: CAPTURE, tabId: 7 })).toBe(true);
    expect(isTailorRequest({ type: TAILOR, sourceHash: 'abc' })).toBe(true);
    expect(isTailorRequest({ type: TAILOR, sourceHash: 'abc', emphasis: 'data work' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'capture'],
    ['an array', []],
    ['no type', { tabId: 1 }],
    ['the wrong type', { type: 'something-else', tabId: 1 }],
  ])('rejects %s', (_what, value) => {
    expect(isCaptureRequest(value)).toBe(false);
    expect(isTailorRequest(value)).toBe(false);
    expect(isPostingCaptured(value)).toBe(false);
  });

  it('rejects a capture request without a numeric tab', () => {
    expect(isCaptureRequest({ type: CAPTURE, tabId: '7' })).toBe(false);
    expect(isCaptureRequest({ type: CAPTURE })).toBe(false);
  });

  it('rejects a tailor request without a hash', () => {
    expect(isTailorRequest({ type: TAILOR })).toBe(false);
    expect(isTailorRequest({ type: TAILOR, sourceHash: 7 })).toBe(false);
    expect(isTailorRequest({ type: TAILOR, sourceHash: 'a', emphasis: 7 })).toBe(false);
  });

  it('rejects a posting whose shape is wrong', () => {
    expect(isPostingCaptured({ type: POSTING_CAPTURED, posting: { ...posting, source: 'invented' } })).toBe(false);
    expect(isPostingCaptured({ type: POSTING_CAPTURED, posting: { ...posting, text: 42 } })).toBe(false);
    expect(isPostingCaptured({ type: POSTING_CAPTURED, posting: { ...posting, url: 9 } })).toBe(false);
    expect(isPostingCaptured({ type: POSTING_CAPTURED })).toBe(false);
  });

  it('accepts a posting carrying an optional url', () => {
    expect(isPostingCaptured({ type: POSTING_CAPTURED, posting: { ...posting, url: 'https://x/1' } })).toBe(true);
  });
});
