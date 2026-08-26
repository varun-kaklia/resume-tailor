import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARKERS, escapeLatex, experienceRenderOrder, renderLatex } from '../src/core/render/latex';
import { AppError } from '../src/core/types/errors';
import type { Profile } from '../src/core/types/profile';
import type { TailoringPlan } from '../src/core/types/tailoring';

const TEMPLATE = readFileSync(new URL('../templates/faangpath-simple.tex', import.meta.url), 'utf8');

const profile: Profile = {
  version: 1,
  contact: { fullName: 'Ada Lovelace', email: 'ada@example.com', github: 'github.com/ada' },
  education: [
    {
      id: 'ed1',
      institution: 'AT&T Institute',
      degree: 'B.Tech',
      field: 'CSE',
      dates: { start: '2018-08', end: '2022-05' },
      grade: '8.4/10',
    },
  ],
  experience: [
    {
      id: 'e1',
      company: 'AT&T',
      title: 'Senior Engineer',
      dates: { start: '2024-01', end: 'present' },
      bullets: [
        { id: 'e1b1', text: 'Held 99% uptime across the billing tier' },
        { id: 'e1b2', text: 'Shipped a C# service reaching ~50ms p99' },
      ],
    },
    {
      id: 'e2',
      company: 'Contract Studio',
      title: 'SDE',
      dates: { start: '2025-07', end: '2026-01' },
      note: 'Six-month contract engagement.',
      bullets: [{ id: 'e2b1', text: 'Maintained an internal tool' }],
    },
  ],
  projects: [
    {
      id: 'p1',
      name: 'Rex_Tool',
      stack: ['Go', 'Postgres'],
      bullets: [{ id: 'p1b1', text: 'Parsed logs from C:\\Users\\ada\\logs' }],
    },
  ],
  skills: [{ id: 's1', label: 'Languages', skills: ['Go', 'TypeScript', 'C#'] }],
  updatedAt: '2026-08-26T00:00:00.000Z',
};

const plan: TailoringPlan = {
  experience: [{ id: 'e1', bulletIds: ['e1b2', 'e1b1'] }],
  projects: [{ id: 'p1', bulletIds: ['p1b1'] }],
  skills: [{ id: 's1', skills: ['C#', 'Go'] }],
  rewrites: [{ id: 'e1b2', text: 'Delivered a C# service at ~50ms p99' }],
  educationIds: ['ed1'],
};

describe('escapeLatex', () => {
  it('escapes every character LaTeX treats as syntax', () => {
    expect(escapeLatex('& % $ # _ { }')).toBe('\\& \\% \\$ \\# \\_ \\{ \\}');
  });

  it('handles the three that need a command, without re-escaping their own braces', () => {
    expect(escapeLatex('\\')).toBe('\\textbackslash{}');
    expect(escapeLatex('~')).toBe('\\textasciitilde{}');
    expect(escapeLatex('^')).toBe('\\textasciicircum{}');
  });

  it('survives real-world resume text', () => {
    expect(escapeLatex('AT&T')).toBe('AT\\&T');
    expect(escapeLatex('99% uptime')).toBe('99\\% uptime');
    expect(escapeLatex('C#')).toBe('C\\#');
    expect(escapeLatex('~50ms')).toBe('\\textasciitilde{}50ms');
    expect(escapeLatex('C:\\Users\\ada')).toBe('C:\\textbackslash{}Users\\textbackslash{}ada');
    expect(escapeLatex('a_b^c~d')).toBe('a\\_b\\textasciicircum{}c\\textasciitilde{}d');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLatex('Reduced latency by half')).toBe('Reduced latency by half');
  });
});

describe('renderLatex', () => {
  const tex = renderLatex(plan, profile, TEMPLATE);

  it('leaves no marker unsubstituted', () => {
    expect(tex).not.toMatch(/<<<[A-Z_]+>>>/);
    for (const marker of MARKERS) expect(TEMPLATE).toContain(`<<<${marker}>>>`);
  });

  it('escapes profile text and model text alike', () => {
    expect(tex).toContain('AT\\&T');
    expect(tex).toContain('99\\% uptime');
    expect(tex).toContain('C\\#');
    expect(tex).toContain('\\textasciitilde{}50ms');
    expect(tex).toContain('C:\\textbackslash{}Users\\textbackslash{}ada\\textbackslash{}logs');
    expect(tex).toContain('Rex\\_Tool');
  });

  it('applies a rewrite by id and falls back to the original for bullets without one', () => {
    expect(tex).toContain('Delivered a C\\# service');
    expect(tex).not.toContain('Shipped a C\\# service');
    expect(tex).toContain('Held 99\\% uptime across the billing tier');
  });

  it('respects the plan bullet order, not the profile order', () => {
    expect(tex.indexOf('Delivered a C\\#')).toBeLessThan(tex.indexOf('Held 99\\%'));
  });

  it('joins dates locally, never from the plan', () => {
    expect(tex).toContain('Jan 2024 -- Present');
    expect(tex).toContain('Aug 2018 -- May 2022');
  });

  it('renders a user note verbatim even though the plan omitted that role', () => {
    expect(plan.experience.map((s) => s.id)).not.toContain('e2');
    expect(tex).toContain('Contract Studio');
    expect(tex).toContain(profile.experience[1]?.note ?? 'MISSING');
  });

  it('keeps a noted role in its profile position relative to the roles kept', () => {
    expect(experienceRenderOrder(plan, profile)).toEqual(['e1', 'e2']);
  });

  it('drops skills the plan named but the profile does not have', () => {
    const invented: TailoringPlan = { ...plan, skills: [{ id: 's1', skills: ['Rust', 'Go'] }] };
    const out = renderLatex(invented, profile, TEMPLATE);
    expect(out).not.toContain('Rust');
    expect(out).toContain('Go');
  });

  it('omits a section the plan left empty rather than leaving an orphan heading', () => {
    const noProjects: TailoringPlan = { ...plan, projects: [] };
    expect(renderLatex(noProjects, profile, TEMPLATE)).not.toContain('\\section{Projects}');
  });

  it('will not let the plan add a summary the user never wrote', () => {
    const withSummary: TailoringPlan = { ...plan, summary: 'Invented summary line' };
    expect(renderLatex(withSummary, profile, TEMPLATE)).not.toContain('Invented summary line');
  });

  it('throws RENDER_FAILED for a template missing a marker, and renders nothing', () => {
    const broken = TEMPLATE.replace('<<<SKILLS>>>', '');
    expect(() => renderLatex(plan, profile, broken)).toThrowError(AppError);
    try {
      renderLatex(plan, profile, broken);
    } catch (e) {
      expect((e as AppError).code).toBe('RENDER_FAILED');
    }
  });

  it('throws RENDER_FAILED for a marker the renderer does not know', () => {
    expect(() => renderLatex(plan, profile, `${TEMPLATE}\n<<<PHOTO>>>`)).toThrowError(/RENDER_FAILED/);
  });
});
