import { describe, expect, it } from 'vitest';
import { planLocally, tailorLocally, trimToFit } from '../src/core/plan/local';
import { validatePlan } from '../src/core/tailor';
import type { JobSpec, Profile } from '../src/core/types';

const bullet = (id: string, text: string) => ({ id, text });

const profile: Profile = {
  version: 1,
  contact: { fullName: 'Jo Rivera', email: 'jo.rivera@example.com' },
  education: [{ id: 'd1', institution: 'Riverbank University', degree: 'BSc', field: 'Computer Science', dates: { start: '2018-08', end: '2022-05' } }],
  experience: [
    {
      id: 'e1',
      company: 'Northwind Systems',
      title: 'Senior Engineer',
      dates: { start: '2022-03', end: 'present' },
      bullets: [
        bullet('e1b1', 'Mentored three engineers through their first on-call rotation'),
        bullet('e1b2', 'Cut checkout latency 40% with a read-through cache in Go'),
        bullet('e1b3', 'Led the payments migration to Kubernetes across 14 services'),
      ],
    },
    {
      id: 'e2',
      company: 'Tidewater Labs',
      title: 'Engineer',
      dates: { start: '2019-06', end: '2022-02' },
      bullets: [bullet('e2b1', 'Wrote internal documentation for the support team')],
    },
  ],
  projects: [
    { id: 'p1', name: 'Deskmate', bullets: [bullet('p1b1', 'A calendar app for shared offices')] },
    { id: 'p2', name: 'Tidebreak', bullets: [bullet('p2b1', 'Parsed 2M rows a day into Postgres with Go')] },
  ],
  skills: [{ id: 's1', label: 'Languages', skills: ['Python', 'Go', 'TypeScript'] }],
  updatedAt: '2026-08-28T00:00:00.000Z',
};

const spec: JobSpec = {
  title: 'Senior Backend Engineer',
  requirements: [
    { term: 'go', weight: 'must' },
    { term: 'kubernetes', weight: 'must' },
    { term: 'postgres', weight: 'nice' },
  ],
  keywords: ['caching', 'rust'],
  sourceHash: 'abc123',
  heuristicOnly: true,
};

describe('planLocally', () => {
  const plan = planLocally(profile, spec);

  it('never writes text — the whole point of the local path', () => {
    expect(plan.rewrites).toEqual([]);
    expect(plan.summary).toBeUndefined();
  });

  it('orders bullets within a role by what the posting asked for', () => {
    // e1b2 (Go) and e1b3 (Kubernetes) match; the mentoring bullet does not.
    expect(plan.experience[0]?.bulletIds.slice(0, 2)).toEqual(['e1b2', 'e1b3']);
    expect(plan.experience[0]?.bulletIds).not.toContain('e1b1');
  });

  it('keeps roles in the profile order, because a resume is read chronologically', () => {
    expect(plan.experience.map((section) => section.id)).toEqual(['e1', 'e2']);
  });

  it('keeps a matchless role from rendering as a bare heading', () => {
    expect(plan.experience[1]?.bulletIds).toEqual(['e2b1']);
  });

  it('ranks projects by relevance, since they carry no chronology', () => {
    expect(plan.projects.map((section) => section.id)).toEqual(['p2', 'p1']);
  });

  it('puts the skills the posting named first, without regrouping them', () => {
    expect(plan.skills[0]?.skills[0]).toBe('Go');
    expect(plan.skills[0]?.skills).toHaveLength(3);
  });

  it('includes every education entry', () => {
    expect(plan.educationIds).toEqual(['d1']);
  });

  it('matches terms on word boundaries, not substrings', () => {
    const noise: Profile = {
      ...profile,
      // No skills section: "go" must be found in bullet text or nowhere.
      skills: [],
      projects: [],
      experience: [{ ...profile.experience[0]!, bullets: [bullet('e1b1', 'Sorted items by category in a spreadsheet')] }],
    };

    // "category" contains "go"; a substring match would score this bullet.
    expect(planLocally(noise, { ...spec, requirements: [{ term: 'go', weight: 'must' }], keywords: [] }).experience[0]?.bulletIds).toEqual(['e1b1']);
    expect(tailorLocally(noise, { ...spec, requirements: [{ term: 'go', weight: 'must' }], keywords: [] }).unmatched).toContain('go');
  });
});

describe('a local plan through the normal validator', () => {
  it('passes every check, so there is no second code path around it', () => {
    const validated = validatePlan(planLocally(profile, spec), profile);

    expect(validated.rejected).toEqual([]);
    expect(validated.xyzWarnings).toEqual([]);
    expect(validated.fit.verdict).not.toBe('over');
  });
});

describe('trimToFit', () => {
  it('leaves a plan that already fits alone', () => {
    const plan = planLocally(profile, spec);

    expect(trimToFit(plan, profile).trimmed).toEqual([]);
  });

  it('drops bullets until the page fits, and names every one it dropped', () => {
    const long = 'Delivered a substantial programme of work across many teams and services, '.repeat(8);
    const role = (id: string) => ({
      id,
      company: 'Northwind Systems',
      title: 'Senior Engineer',
      dates: { start: '2022-03', end: 'present' } as const,
      bullets: Array.from({ length: 5 }, (_, index) => bullet(`${id}b${index + 1}`, `${long} item ${index} with Go and Kubernetes`)),
    });
    const heavy: Profile = { ...profile, projects: [], experience: [role('e1'), role('e2'), role('e3')] };

    const result = trimToFit(planLocally(heavy, spec), heavy);

    expect(result.fit.verdict).not.toBe('over');
    expect(result.trimmed.length).toBeGreaterThan(0);
    const planned = result.plan.experience.flatMap((section) => section.bulletIds);
    expect(planned.some((id) => result.trimmed.includes(id))).toBe(false);
  });
});

describe('tailorLocally', () => {
  it('reports the posting terms the profile cannot answer, rather than a score', () => {
    const { unmatched } = tailorLocally(profile, spec);

    expect(unmatched).toContain('rust');  // as the spec spelled it
    expect(unmatched).not.toContain('go');
    expect(unmatched).not.toContain('kubernetes');
  });

  it('finds a skill listed only in the skills section', () => {
    expect(tailorLocally(profile, { ...spec, requirements: [{ term: 'typescript', weight: 'must' }], keywords: [] }).unmatched).toEqual([]);
  });
});
