import { describe, expect, it } from 'vitest';
import { needsModelImport, readResume } from '../src/core/profile/read';
import { splitDateRange, toYearMonth } from '../src/core/profile/dates';
import { AppError } from '../src/core/types';

/** Deliberately fictional throughout — no real person's data belongs in this repo (D-024). */
const RESUME = `Jo Rivera
Lisbon, Portugal
jo.rivera@example.com | +351 912 345 678
linkedin.com/in/jorivera | github.com/jorivera

SUMMARY
Backend engineer working on payments and data pipelines.

EXPERIENCE

Northwind Systems                                     Mar 2022 – Present
Senior Backend Engineer                               Lisbon, Portugal
• Cut checkout latency 40% by adding a read-through cache in Go
• Led the payments migration to Kubernetes across 14 services
• Mentored three engineers through their first on-call rotation

Tidewater Labs                                        Jun 2019 – Feb 2022
Backend Engineer
• Built an ingestion pipeline in Python handling 2M events a day
• Reduced infrastructure spend 25% by right-sizing Postgres instances

PROJECTS

Tidebreak — github.com/jorivera/tidebreak
• Parsed 2M rows a day into a columnar store

EDUCATION

Riverbank University                                  Aug 2018 – May 2022
BSc in Computer Science, GPA 8.4/10

TECHNICAL SKILLS
Languages: Go, TypeScript, Python
Infrastructure: Kubernetes, Docker, Postgres
`;

describe('toYearMonth', () => {
  it('reads the formats resumes actually use', () => {
    expect(toYearMonth('2022-03')).toBe('2022-03');
    expect(toYearMonth('Mar 2022')).toBe('2022-03');
    expect(toYearMonth('March 2022')).toBe('2022-03');
    expect(toYearMonth('03/2022')).toBe('2022-03');
    expect(toYearMonth('Present')).toBe('present');
  });

  it('refuses to invent a month it was not given', () => {
    expect(toYearMonth('2022')).toBe('');
    expect(toYearMonth('sometime in 2022')).toBe('');
    expect(toYearMonth('2022-13')).toBe('');
  });
});

describe('splitDateRange', () => {
  it('lifts the range out and hands back the rest of the line', () => {
    const { dates, rest } = splitDateRange('Northwind Systems    Mar 2022 – Present');

    expect(dates).toEqual({ start: '2022-03', end: 'present' });
    expect(rest).toBe('Northwind Systems');
  });

  it('leaves a line alone when neither end of the range is readable', () => {
    const { dates, rest } = splitDateRange('Northwind Systems 2019 - 2022');

    expect(dates).toBeUndefined();
    expect(rest).toBe('Northwind Systems 2019 - 2022');
  });
});

describe('readResume', () => {
  const { profile, gaps, confidence } = readResume(RESUME);

  it('reads the contact block', () => {
    expect(profile.contact.fullName).toBe('Jo Rivera');
    expect(profile.contact.email).toBe('jo.rivera@example.com');
    expect(profile.contact.location).toBe('Lisbon, Portugal');
    expect(profile.contact.linkedin).toBe('linkedin.com/in/jorivera');
    expect(profile.contact.github).toBe('github.com/jorivera');
  });

  it('reads roles with their dates, and keeps the profile order', () => {
    expect(profile.experience).toHaveLength(2);
    expect(profile.experience[0]?.company).toBe('Northwind Systems');
    expect(profile.experience[0]?.title).toBe('Senior Backend Engineer');
    expect(profile.experience[0]?.dates).toEqual({ start: '2022-03', end: 'present' });
    expect(profile.experience[1]?.company).toBe('Tidewater Labs');
  });

  it('keeps every bullet verbatim', () => {
    expect(profile.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Cut checkout latency 40% by adding a read-through cache in Go',
      'Led the payments migration to Kubernetes across 14 services',
      'Mentored three engineers through their first on-call rotation',
    ]);
  });

  it('assigns ids in the documented format', () => {
    expect(profile.experience.map((role) => role.id)).toEqual(['e1', 'e2']);
    expect(profile.experience[0]?.bullets[1]?.id).toBe('e1b2');
    expect(profile.projects[0]?.id).toBe('p1');
    expect(profile.education[0]?.id).toBe('d1');
    expect(profile.skills.map((group) => group.id)).toEqual(['s1', 's2']);
  });

  it('reads projects, education and skills', () => {
    expect(profile.projects[0]?.name).toBe('Tidebreak');
    expect(profile.education[0]?.institution).toBe('Riverbank University');
    expect(profile.education[0]?.degree).toBe('BSc');
    expect(profile.education[0]?.grade).toBe('8.4/10');
    expect(profile.skills[0]).toEqual({ id: 's1', label: 'Languages', skills: ['Go', 'TypeScript', 'Python'] });
  });

  it('takes the summary only from a summary heading, never from the first paragraph', () => {
    expect(profile.summary).toBe('Backend engineer working on payments and data pipelines.');
    expect(readResume(RESUME.replace('SUMMARY\n', '')).profile.summary).not.toBe(
      'Backend engineer working on payments and data pipelines.',
    );
  });

  it('never invents a role note', () => {
    expect(profile.experience.every((role) => role.note === undefined)).toBe(true);
  });

  it('reports a readable resume as needing no model', () => {
    expect(gaps).toEqual([]);
    expect(confidence).toBe(1);
    expect(needsModelImport({ profile, gaps, confidence })).toBe(false);
  });

  it('asks for the model when the layout defeated it', () => {
    const unreadable = readResume(
      'Jo Rivera\njo.rivera@example.com\n\nI have spent six years building payment systems and data pipelines for companies of various sizes, most recently in Lisbon.',
    );

    expect(unreadable.gaps).toContain('experience');
    expect(needsModelImport(unreadable)).toBe(true);
  });

  it('refuses text too short to hold any structure', () => {
    try {
      readResume('Jo Rivera');
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect(thrown instanceof AppError ? thrown.code : '').toBe('PROFILE_EMPTY');
    }
  });

  it('reads a resume written with hyphens and no blank lines', () => {
    const terse = readResume(
      [
        'Jo Rivera',
        'jo.rivera@example.com',
        'Experience',
        'Northwind Systems | Senior Engineer | Mar 2022 - Present',
        '- Cut checkout latency 40% with a read-through cache',
        '- Led the payments migration',
        'Skills',
        'Go, TypeScript, Kubernetes',
      ].join('\n'),
    );

    expect(terse.profile.experience[0]?.company).toBe('Northwind Systems');
    expect(terse.profile.experience[0]?.bullets).toHaveLength(2);
    expect(terse.profile.skills[0]?.skills).toEqual(['Go', 'TypeScript', 'Kubernetes']);
  });
});
