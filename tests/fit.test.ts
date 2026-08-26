import { describe, expect, it } from 'vitest';
import { BUDGET_LINES, CHARS_PER_LINE, estimateFit } from '../src/core/validate/fit';
import type { Bullet, Experience, Profile, Project } from '../src/core/types/profile';
import type { TailoringPlan } from '../src/core/types/tailoring';

const bullet = (id: string, chars: number): Bullet => ({ id, text: 'x'.repeat(chars) });

const role = (id: string, bulletCount: number, chars: number): Experience => ({
  id,
  company: `Co ${id}`,
  title: 'Engineer',
  dates: { start: '2024-01', end: 'present' },
  bullets: Array.from({ length: bulletCount }, (_, i) => bullet(`${id}b${i + 1}`, chars)),
});

const project = (id: string, bulletCount: number, chars: number): Project => ({
  id,
  name: `Project ${id}`,
  bullets: Array.from({ length: bulletCount }, (_, i) => bullet(`${id}b${i + 1}`, chars)),
});

const buildProfile = (experience: readonly Experience[], projects: readonly Project[] = []): Profile => ({
  version: 1,
  contact: { fullName: 'Ada Lovelace', email: 'ada@example.com' },
  education: [
    { id: 'ed1', institution: 'Uni', degree: 'B.Tech', field: 'CSE', dates: { start: '2018-08', end: '2022-05' } },
  ],
  experience,
  projects,
  skills: [{ id: 's1', label: 'Languages', skills: ['Go', 'TypeScript'] }],
  updatedAt: '2026-08-26T00:00:00.000Z',
});

const buildPlan = (profile: Profile): TailoringPlan => ({
  experience: profile.experience.map((r) => ({ id: r.id, bulletIds: r.bullets.map((b) => b.id) })),
  projects: profile.projects.map((p) => ({ id: p.id, bulletIds: p.bullets.map((b) => b.id) })),
  skills: profile.skills.map((s) => ({ id: s.id, skills: [...s.skills] })),
  rewrites: [],
  educationIds: profile.education.map((e) => e.id),
});

describe('estimateFit', () => {
  it('returns ok for a short resume', () => {
    const profile = buildProfile([role('e1', 3, 80)]);
    const fit = estimateFit(buildPlan(profile), profile);
    expect(fit.verdict).toBe('ok');
    expect(fit.estimatedLines).toBeLessThan(fit.budgetLines);
    expect(fit.suggestedCuts).toEqual([]);
  });

  it('returns over for an obviously-too-long plan and names enough cuts to fix it', () => {
    const profile = buildProfile([role('e1', 10, 200), role('e2', 10, 200)], [project('p1', 6, 200)]);
    const plan = buildPlan(profile);
    const fit = estimateFit(plan, profile);

    expect(fit.verdict).toBe('over');
    expect(fit.estimatedLines).toBeGreaterThan(fit.budgetLines);
    expect(fit.suggestedCuts.length).toBeGreaterThan(0);

    const cut = new Set(fit.suggestedCuts);
    const trimmed: TailoringPlan = {
      ...plan,
      experience: plan.experience.map((s) => ({ ...s, bulletIds: s.bulletIds.filter((id) => !cut.has(id)) })),
      projects: plan.projects.map((s) => ({ ...s, bulletIds: s.bulletIds.filter((id) => !cut.has(id)) })),
    };
    expect(estimateFit(trimmed, profile).verdict).not.toBe('over');
  });

  it('cuts the least-relevant section first — projects sit below every role', () => {
    const profile = buildProfile([role('e1', 8, 180), role('e2', 8, 180)], [project('p1', 4, 180)]);
    const cuts = estimateFit(buildPlan(profile), profile).suggestedCuts;
    expect(cuts[0]?.startsWith('p1')).toBe(true);
  });

  it('never reports a percentage — only a verdict and two line counts', () => {
    const profile = buildProfile([role('e1', 3, 80)]);
    expect(Object.keys(estimateFit(buildPlan(profile), profile)).sort()).toEqual([
      'budgetLines',
      'estimatedLines',
      'suggestedCuts',
      'verdict',
    ]);
  });

  it('warns tight before it blocks', () => {
    // Grow one role a bullet at a time; the first non-ok verdict must be `tight`.
    const verdicts = Array.from({ length: 14 }, (_, i) => {
      const profile = buildProfile([role('e1', i + 1, CHARS_PER_LINE * 2)]);
      return estimateFit(buildPlan(profile), profile).verdict;
    });
    expect(verdicts.find((v) => v !== 'ok')).toBe('tight');
  });

  it('counts a noted role the plan omitted, because the renderer still draws it', () => {
    const noted: Experience = { ...role('e2', 2, 120), note: 'x'.repeat(120) };
    const profile = buildProfile([role('e1', 3, 100), noted]);
    const full = buildPlan(profile);
    const withoutE2: TailoringPlan = { ...full, experience: full.experience.filter((s) => s.id !== 'e1') };
    const droppedRole: TailoringPlan = { ...full, experience: full.experience.filter((s) => s.id !== 'e2') };

    // Dropping e2's bullets still leaves its header and its two-line note on the page.
    expect(estimateFit(droppedRole, profile).estimatedLines).toBeGreaterThan(
      estimateFit(withoutE2, profile).estimatedLines - 10,
    );
    expect(estimateFit(droppedRole, profile).estimatedLines).toBeGreaterThan(15);
  });

  it('honours overridden knobs when the user has shrunk the template font', () => {
    const profile = buildProfile([role('e1', 16, 200)]);
    const plan = buildPlan(profile);
    expect(estimateFit(plan, profile).verdict).toBe('over');
    expect(estimateFit(plan, profile, { charsPerLine: 200, budgetLines: 70 }).verdict).not.toBe('over');
  });

  it('exports the constants a future real compiler can calibrate against', () => {
    expect(CHARS_PER_LINE).toBeGreaterThan(0);
    expect(BUDGET_LINES).toBeGreaterThan(0);
    expect(estimateFit(buildPlan(buildProfile([])), buildProfile([])).budgetLines).toBe(BUDGET_LINES);
  });
});
