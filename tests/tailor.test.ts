import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderValidated, tailor, validatePlan } from '../src/core/tailor';
import { AppError } from '../src/core/types/errors';
import type { Profile } from '../src/core/types/profile';
import type { TailoringPlan } from '../src/core/types/tailoring';

const TEMPLATE = readFileSync(new URL('../templates/faangpath-simple.tex', import.meta.url), 'utf8');

const profile: Profile = {
  version: 1,
  contact: { fullName: 'Ada Lovelace', email: 'ada@example.com' },
  education: [
    { id: 'ed1', institution: 'AT&T Institute', degree: 'B.Tech', field: 'CSE', dates: { start: '2018-08', end: '2022-05' } },
  ],
  experience: [
    {
      id: 'e1',
      company: 'AT&T',
      title: 'Senior Engineer',
      dates: { start: '2024-01', end: 'present' },
      bullets: [
        { id: 'e1b1', text: 'Cut p50 checkout latency by 99ms by adding a read-through cache' },
        { id: 'e1b2', text: 'Maintained the billing tier' },
      ],
    },
  ],
  projects: [],
  skills: [{ id: 's1', label: 'Languages', skills: ['Go', 'TypeScript'] }],
  updatedAt: '2026-08-26T00:00:00.000Z',
};

const planWith = (rewrites: TailoringPlan['rewrites']): TailoringPlan => ({
  experience: [{ id: 'e1', bulletIds: ['e1b1', 'e1b2'] }],
  projects: [],
  skills: [{ id: 's1', skills: ['Go', 'TypeScript'] }],
  educationIds: ['ed1'],
  rewrites,
});

describe('validatePlan', () => {
  it('keeps a grounded rewrite', () => {
    const plan = planWith([{ id: 'e1b1', text: 'Cut p50 checkout latency by 99ms via a read-through cache' }]);
    const validated = validatePlan(plan, profile);

    expect(validated.rejected).toEqual([]);
    expect(validated.plan.rewrites).toHaveLength(1);
  });

  it('rejects a fabricated percentile and drops it from the plan, keeping selection', () => {
    // Source says p50. The 99 exists, so only prefix-aware comparison catches this.
    const plan = planWith([{ id: 'e1b1', text: 'Cut p99 checkout latency by 99ms via a read-through cache' }]);
    const validated = validatePlan(plan, profile);

    expect(validated.rejected.map((issue) => issue.bulletId)).toContain('e1b1');
    // The wording is discarded so the renderer falls back to the original...
    expect(validated.plan.rewrites).toHaveLength(0);
    // ...but the model's selection and ordering survive.
    expect(validated.plan.experience[0]?.bulletIds).toEqual(['e1b1', 'e1b2']);
  });

  it('renders the user\'s original words when a rewrite was rejected', () => {
    const plan = planWith([{ id: 'e1b1', text: 'Cut p99 checkout latency by 40% via a rewrite in Rust' }]);
    const latex = renderValidated(validatePlan(plan, profile), profile, TEMPLATE);

    expect(latex).toContain('read-through cache');
    expect(latex).not.toContain('Rust');
    expect(latex).not.toContain('40');
  });

  it('throws UNKNOWN_ITEM_ID for a fabricated id rather than rendering partially', () => {
    const plan = planWith([{ id: 'e9b9', text: 'Invented an entire job' }]);

    expect(() => validatePlan(plan, profile)).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_ITEM_ID' }) as Error,
    );
  });
});

describe('renderValidated', () => {
  it('blocks export when the estimate says the resume runs over one page', () => {
    const long = 'Delivered a platform migration across many services with measurable outcomes'.repeat(40);
    const fat: Profile = {
      ...profile,
      experience: [
        {
          ...profile.experience[0]!,
          bullets: Array.from({ length: 40 }, (_, i) => ({ id: `e1b${i + 1}`, text: long })),
        },
      ],
    };
    const plan: TailoringPlan = {
      ...planWith([]),
      experience: [{ id: 'e1', bulletIds: Array.from({ length: 40 }, (_, i) => `e1b${i + 1}`) }],
    };

    const validated = validatePlan(plan, fat);
    expect(validated.fit.verdict).toBe('over');
    expect(() => renderValidated(validated, fat, TEMPLATE)).toThrowError(
      expect.objectContaining({ code: 'DOES_NOT_FIT_ONE_PAGE' }) as Error,
    );
  });

  it('tailor() chains validation and render for the common path', () => {
    const { latex, validated } = tailor(planWith([]), profile, TEMPLATE);

    expect(validated.fit.verdict).not.toBe('over');
    expect(latex).toContain('Ada Lovelace');
  });
});

describe('AppError contract', () => {
  it('every thrown failure carries a user-facing message', () => {
    try {
      validatePlan(planWith([{ id: 'nope', text: 'x' }]), profile);
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).userMessage).toMatch(/\w/);
    }
  });
});
