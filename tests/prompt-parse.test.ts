import { describe, expect, it } from 'vitest';
import { parseTailoringPlan } from '../src/core/prompt/parse';
import { AppError } from '../src/core/types';

const complete = JSON.stringify({
  experience: [{ id: 'e1', bulletIds: ['e1b2', 'e1b1'] }],
  projects: [{ id: 'p1', bulletIds: ['p1b1'] }],
  skills: [{ id: 's1', skills: ['Go', 'TypeScript'] }],
  educationIds: ['d1'],
  rewrites: [{ id: 'e1b2', text: 'Cut nightly batch runtime by moving to incremental loads', rationale: 'matches JD' }],
  summary: 'Backend engineer',
});

const codeOf = (raw: string): string => {
  try {
    parseTailoringPlan(raw);
  } catch (thrown) {
    return thrown instanceof AppError ? thrown.code : 'NOT_AN_APP_ERROR';
  }
  return 'NO_THROW';
};

describe('parseTailoringPlan', () => {
  it('parses a complete plan', () => {
    const plan = parseTailoringPlan(complete);

    expect(plan.experience).toEqual([{ id: 'e1', bulletIds: ['e1b2', 'e1b1'] }]);
    expect(plan.projects[0]?.bulletIds).toEqual(['p1b1']);
    expect(plan.skills[0]?.skills).toEqual(['Go', 'TypeScript']);
    expect(plan.educationIds).toEqual(['d1']);
    expect(plan.rewrites[0]?.id).toBe('e1b2');
    expect(plan.rewrites[0]?.rationale).toBe('matches JD');
    expect(plan.summary).toBe('Backend engineer');
  });

  it('preserves the order the model chose', () => {
    expect(parseTailoringPlan(complete).experience[0]?.bulletIds).toEqual(['e1b2', 'e1b1']);
  });

  it('defaults missing sections to empty rather than failing a usable plan', () => {
    const plan = parseTailoringPlan('{"experience":[{"id":"e1","bulletIds":["e1b1"]}]}');

    expect(plan.projects).toEqual([]);
    expect(plan.skills).toEqual([]);
    expect(plan.rewrites).toEqual([]);
    expect(plan.educationIds).toEqual([]);
    expect(plan.summary).toBeUndefined();
  });

  it('omits an absent or blank summary instead of carrying an empty string', () => {
    expect(parseTailoringPlan('{"summary":"   "}').summary).toBeUndefined();
    expect(parseTailoringPlan('{"summary":" Backend engineer "}').summary).toBe('Backend engineer');
  });

  it('drops a blank rewrite so the bullet keeps its original wording', () => {
    const plan = parseTailoringPlan('{"rewrites":[{"id":"e1b1","text":"   "},{"id":"e1b2","text":"Shipped it"}]}');

    expect(plan.rewrites.map((rewrite) => rewrite.id)).toEqual(['e1b2']);
  });

  it('omits a blank rationale rather than carrying an empty one', () => {
    expect(parseTailoringPlan('{"rewrites":[{"id":"e1b1","text":"Shipped it","rationale":"  "}]}').rewrites[0])
      .toEqual({ id: 'e1b1', text: 'Shipped it' });
  });
});

describe('parseTailoringPlan recovers packaging faults', () => {
  it('accepts a fenced response', () => {
    expect(parseTailoringPlan(`\`\`\`json\n${complete}\n\`\`\``).educationIds).toEqual(['d1']);
  });

  it('accepts a fence with no language tag', () => {
    expect(parseTailoringPlan(`\`\`\`\n${complete}\n\`\`\``).educationIds).toEqual(['d1']);
  });

  it('accepts a response wrapped in prose', () => {
    expect(parseTailoringPlan(`Here is the plan:\n${complete}\nLet me know if you want changes.`).summary)
      .toBe('Backend engineer');
  });

  it('accepts surrounding whitespace', () => {
    expect(parseTailoringPlan(`\n\n  ${complete}  \n`).educationIds).toEqual(['d1']);
  });
});

describe('parseTailoringPlan rejects malformed responses', () => {
  it('separates "not JSON" from "wrong shape"', () => {
    expect(codeOf('I cannot help with that.')).toBe('BAD_RESPONSE_SHAPE');
    expect(codeOf('{"experience": "e1"}')).toBe('PLAN_INVALID');
  });

  it.each([
    ['empty response', ''],
    ['truncated JSON', '{"experience":[{"id":"e1","bulletIds":['],
    ['a bare string', '"just text"'],
    ['a JSON array', '[1,2,3]'],
  ])('rejects %s', (_what, raw) => {
    expect(['BAD_RESPONSE_SHAPE', 'PLAN_INVALID']).toContain(codeOf(raw));
  });

  it.each([
    ['a section that is not a list', '{"experience":{"id":"e1"}}'],
    ['a section entry with no id', '{"experience":[{"bulletIds":["e1b1"]}]}'],
    ['a section entry with a blank id', '{"experience":[{"id":"  ","bulletIds":[]}]}'],
    ['bulletIds that are not a list', '{"experience":[{"id":"e1","bulletIds":"e1b1"}]}'],
    ['a non-string bulletId', '{"experience":[{"id":"e1","bulletIds":[7]}]}'],
    ['skills that are not a list', '{"skills":"Go"}'],
    ['a skills entry with no id', '{"skills":[{"skills":["Go"]}]}'],
    ['a non-string skill', '{"skills":[{"id":"s1","skills":[7]}]}'],
    ['educationIds that are not a list', '{"educationIds":"d1"}'],
    ['rewrites that are not a list', '{"rewrites":{"id":"e1b1"}}'],
    ['a rewrite with no id', '{"rewrites":[{"text":"Shipped it"}]}'],
    ['a rewrite with no text', '{"rewrites":[{"id":"e1b1"}]}'],
    ['a rewrite whose text is not a string', '{"rewrites":[{"id":"e1b1","text":42}]}'],
  ])('rejects %s as PLAN_INVALID', (_what, raw) => {
    expect(codeOf(raw)).toBe('PLAN_INVALID');
  });

  it('gives every rejection a user-facing message', () => {
    for (const raw of ['not json at all', '{"experience":"e1"}']) {
      try {
        parseTailoringPlan(raw);
      } catch (thrown) {
        expect(thrown).toBeInstanceOf(AppError);
        expect((thrown as AppError).userMessage).toMatch(/\w/);
      }
    }
  });

  it('does not treat an id it cannot verify as a shape failure', () => {
    // Whether e9b9 exists is the profile's business, checked later by core/tailor.ts.
    expect(() => parseTailoringPlan('{"rewrites":[{"id":"e9b9","text":"Invented"}]}')).not.toThrow();
  });
});
