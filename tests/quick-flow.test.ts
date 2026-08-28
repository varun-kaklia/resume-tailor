import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractJobSpec } from '../src/core/prompt/jobspec';
import { tailorLocally } from '../src/core/plan/local';
import { quickTailor } from '../src/core/plan/quick';
import { readResume } from '../src/core/profile/read';

/**
 * The whole Quick Mode path, through the same `quickTailor` the popup and the
 * options page both call: two pasted strings in, one page of LaTeX out, no
 * provider anywhere. If this passes, a user with no API key gets real output.
 */
const template = readFileSync(new URL('../templates/faangpath-simple.tex', import.meta.url), 'utf8');

const RESUME = `Jo Rivera
Lisbon, Portugal
jo.rivera@example.com

EXPERIENCE

Northwind Systems                                     Mar 2022 – Present
Senior Backend Engineer
• Cut checkout latency 40% by adding a read-through cache in Go
• Led the payments migration to Kubernetes across 14 services
• Wrote the onboarding guide for the support team

Tidewater Labs                                        Jun 2019 – Feb 2022
Backend Engineer
• Built an ingestion pipeline in Python handling 2M events a day

EDUCATION

Riverbank University                                  Aug 2018 – May 2022
BSc in Computer Science

TECHNICAL SKILLS
Languages: Go, Python, TypeScript
Infrastructure: Kubernetes, Docker, Postgres
`;

const POSTING = `Senior Backend Engineer

We are looking for a backend engineer to help scale our payments platform.

Required qualifications:
- Strong experience with Go
- Production experience running Kubernetes
- Familiarity with Postgres and distributed systems

Nice to have:
- Experience with Rust
- Exposure to payment processing at scale

Responsibilities:
- Own services end to end, from design through to on-call
- Work with product engineers to ship customer-facing features
`;

describe('Quick Mode, end to end, with no provider', () => {
  const { profile } = readResume(RESUME);
  const { spec } = extractJobSpec({ text: POSTING, capturedAt: '2026-08-28T00:00:00.000Z', source: 'paste' });
  const local = tailorLocally(profile, spec);
  const { latex, validated, selected, trimmed, unmatched } = quickTailor(profile, spec, template);

  it('reads the posting without a model', () => {
    expect(spec.heuristicOnly).toBe(true);
    expect(spec.requirements.map((requirement) => requirement.term)).toContain('Kubernetes');
  });

  it('leads the role with the bullets the posting asked for', () => {
    expect(local.plan.experience[0]?.bulletIds.slice(0, 2)).toEqual(['e1b1', 'e1b2']);
  });

  it('leaves out the bullet that answers nothing in the posting', () => {
    expect(local.plan.experience[0]?.bulletIds).not.toContain('e1b3');
  });

  it('invents nothing — every rendered bullet is a string from the resume', () => {
    expect(local.plan.rewrites).toEqual([]);
    expect(latex).toContain('Cut checkout latency 40\\% by adding a read-through cache in Go');
    expect(validated.rejected).toEqual([]);
  });

  it('renders a page with the candidate\'s own details joined in locally', () => {
    expect(latex).toContain('Jo Rivera');
    expect(latex).toContain('jo.rivera@example.com');
    expect(latex).toContain('Northwind Systems');
    expect(latex).toContain('Riverbank University');
  });

  it('fits one page and says what it could not answer', () => {
    expect(validated.fit.verdict).not.toBe('over');
    // Reported as the posting spelled it, not lower-cased for the machine's convenience.
    expect(unmatched).toContain('Rust');
  });

  it('counts the bullets it selected, which is what both screens display', () => {
    expect(selected).toBe(local.plan.experience.flatMap((section) => section.bulletIds).length);
    expect(selected).toBeGreaterThan(0);
    expect(trimmed).toEqual([]);
  });
});
