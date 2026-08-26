import { describe, expect, it } from 'vitest';
import { checkXyz } from '../src/core/validate/xyz';

const missing = (text: string) => checkXyz(text, 'e1b1').map((i) => i.missing);

const FULL_XYZ = 'Cut checkout latency 38% by replacing the synchronous tax call with a cached lookup';

describe('checkXyz', () => {
  it('says nothing about a bullet with all three parts', () => {
    expect(checkXyz(FULL_XYZ, 'e1b1')).toEqual([]);
  });

  it('warns when there is no measurement', () => {
    expect(missing('Cut checkout latency by replacing the synchronous tax call')).toEqual(['measurement']);
  });

  it('warns when the bullet does not lead with an action', () => {
    expect(missing('Helped cut checkout latency 38% by caching the tax lookup')).toEqual(['action']);
    expect(missing('Responsible for a 38% latency cut, delivered by caching the tax lookup')).toEqual(['action']);
    expect(missing('Worked on the 38% latency cut using a cached lookup')).toEqual(['action']);
  });

  it('accepts past-tense verbs the list does not name', () => {
    expect(missing('Orchestrated a 38% latency cut by caching the tax lookup')).toEqual([]);
  });

  it('warns when no mechanism is given', () => {
    expect(missing('Cut checkout latency 38%')).toEqual(['outcome']);
  });

  it('accepts any of the mechanism phrasings', () => {
    for (const text of [
      'Cut latency 38% by caching the tax lookup',
      'Cut latency 38% using a cached tax lookup',
      'Cut latency 38% via a cached tax lookup',
      'Cut latency 38% through an in-process cache',
    ]) {
      expect(missing(text)).toEqual([]);
    }
  });

  it('does not accept a bare "with" as a mechanism — every bullet has one', () => {
    expect(missing('Cut latency 38% with the team')).toEqual(['outcome']);
  });

  it('reports all three when a bullet has none of them', () => {
    expect(missing('Responsible for the checkout page')).toEqual(['measurement', 'action', 'outcome']);
  });

  it('carries the bullet id and an actionable hint on every issue', () => {
    const issues = checkXyz('Responsible for the checkout page', 'e2b7');
    for (const issue of issues) {
      expect(issue.bulletId).toBe('e2b7');
      expect(issue.hint.length).toBeGreaterThan(40);
    }
  });

  it('warns rather than blocks — an honest bullet with no metric still returns issues, not an error', () => {
    expect(() => checkXyz('', 'e1b1')).not.toThrow();
    expect(missing('')).toEqual(['measurement', 'action', 'outcome']);
  });
});
