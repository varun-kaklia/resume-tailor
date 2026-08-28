import { describe, expect, it } from 'vitest';
import {
  MAX_RESUME_CHARS,
  MIN_RESUME_CHARS,
  buildImportRequest,
  parseImportedProfile,
} from '../src/core/prompt/import';
import { validateProfile } from '../src/core/profile/schema';
import { AppError } from '../src/core/types';

const resume = 'Jo Rivera — Backend Engineer\n'.padEnd(MIN_RESUME_CHARS + 50, 'x');

const complete = JSON.stringify({
  contact: {
    fullName: 'Jo Rivera',
    email: 'jo@example.com',
    phone: '+1 555 0100',
    location: 'Lisbon, Portugal',
    linkedin: 'linkedin.com/in/jo',
    github: '',
  },
  summary: 'Backend engineer, payments and data',
  experience: [
    {
      company: 'Northwind Systems',
      title: 'Senior Engineer',
      start: 'Mar 2022',
      end: 'Present',
      location: 'Remote',
      bullets: ['Cut checkout latency 40% by adding a read-through cache', '  ', 'Led the payments migration'],
    },
  ],
  projects: [{ name: 'Tidebreak', url: 'example.com/tide', stack: ['Go', 'Postgres'], bullets: ['Parsed 2M rows a day'] }],
  education: [{ institution: 'Riverbank University', degree: 'BSc', field: 'Computer Science', start: '2018-08', end: '2022-05', grade: '8.4/10' }],
  skills: [{ label: 'Languages', skills: ['Go', 'TypeScript'] }],
});

const codeOf = (call: () => unknown): string => {
  try {
    call();
  } catch (thrown) {
    return thrown instanceof AppError ? thrown.code : 'NOT_AN_APP_ERROR';
  }
  return 'NO_THROW';
};

describe('buildImportRequest', () => {
  it('sends the resume text and asks for JSON back', () => {
    const request = buildImportRequest(resume);

    expect(request.user).toContain(resume.trim());
    expect(request.expectJson).toBe(true);
    expect(request.temperature).toBe(0);
  });

  it('refuses text too short to be a resume rather than paying for the call', () => {
    expect(codeOf(() => buildImportRequest('Jo Rivera, engineer'))).toBe('PROFILE_EMPTY');
  });

  it('refuses text long enough that the answer would be truncated mid-JSON', () => {
    expect(codeOf(() => buildImportRequest('x'.repeat(MAX_RESUME_CHARS + 1)))).toBe('CONTEXT_TOO_LARGE');
  });

  it('never asks for a role note — those are the user\'s own words, not the model\'s', () => {
    expect(buildImportRequest(resume).system).not.toContain('note');
  });
});

describe('parseImportedProfile', () => {
  it('reads a complete response into a valid profile', () => {
    const profile = parseImportedProfile(complete);

    expect(profile.contact.fullName).toBe('Jo Rivera');
    expect(profile.summary).toBe('Backend engineer, payments and data');
    expect(profile.experience[0]?.company).toBe('Northwind Systems');
    expect(profile.projects[0]?.stack).toEqual(['Go', 'Postgres']);
    expect(profile.education[0]?.grade).toBe('8.4/10');
    expect(profile.skills[0]?.skills).toEqual(['Go', 'TypeScript']);
    expect(validateProfile(profile).ok).toBe(true);
  });

  it('assigns ids locally, in the documented format', () => {
    const profile = parseImportedProfile(complete);

    expect(profile.experience[0]?.id).toBe('e1');
    expect(profile.experience[0]?.bullets.map((bullet) => bullet.id)).toEqual(['e1b1', 'e1b2']);
    expect(profile.projects[0]?.id).toBe('p1');
    expect(profile.education[0]?.id).toBe('d1');
    expect(profile.skills[0]?.id).toBe('s1');
  });

  it('never carries a role note, whatever the model returns', () => {
    const withNote = JSON.stringify({
      experience: [{ company: 'Northwind Systems', title: 'Engineer', start: '2022-03', end: 'present', note: 'contract role', bullets: ['Shipped it'] }],
    });

    expect(parseImportedProfile(withNote).experience[0]?.note).toBeUndefined();
  });

  it('normalises the date formats resumes actually use', () => {
    const profile = parseImportedProfile(complete);

    expect(profile.experience[0]?.dates).toEqual({ start: '2022-03', end: 'present' });
  });

  it('leaves a date it cannot read blank, so the editor asks instead of guessing', () => {
    const vague = JSON.stringify({
      experience: [{ company: 'Northwind Systems', title: 'Engineer', start: 'a while back', end: '', bullets: [] }],
    });
    const profile = parseImportedProfile(vague);

    expect(profile.experience[0]?.dates).toEqual({ start: '', end: '' });
    // Blank is invalid on purpose: the save button stays shut until it is filled.
    expect(validateProfile(profile).ok).toBe(false);
  });

  it('drops blank bullets and entries with nothing to name them', () => {
    const messy = JSON.stringify({
      experience: [
        { company: '', title: '', bullets: ['orphaned'] },
        { company: 'Northwind Systems', title: 'Engineer', start: '2022-03', end: 'present', bullets: ['Shipped it', '', '   '] },
      ],
      projects: [{ name: '', bullets: ['nameless'] }],
    });
    const profile = parseImportedProfile(messy);

    expect(profile.experience).toHaveLength(1);
    expect(profile.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual(['Shipped it']);
    expect(profile.projects).toHaveLength(0);
  });

  it('omits optional fields rather than storing blanks', () => {
    const sparse = JSON.stringify({ contact: { fullName: 'Jo Rivera', email: 'jo@example.com', phone: '' }, summary: '   ' });
    const profile = parseImportedProfile(sparse);

    expect('phone' in profile.contact).toBe(false);
    expect('summary' in profile).toBe(false);
  });

  it('defaults every missing section to empty rather than failing the import', () => {
    const profile = parseImportedProfile('{}');

    expect(profile.experience).toEqual([]);
    expect(profile.projects).toEqual([]);
    expect(profile.education).toEqual([]);
    expect(profile.skills).toEqual([]);
    expect(profile.contact.fullName).toBe('');
  });

  it('recovers JSON the model wrapped in a fence or a sentence', () => {
    expect(parseImportedProfile('```json\n{"summary":"Backend engineer"}\n```').summary).toBe('Backend engineer');
    expect(parseImportedProfile('Here you go: {"summary":"Backend engineer"}').summary).toBe('Backend engineer');
  });

  it('fails on a response that is not JSON at all', () => {
    expect(codeOf(() => parseImportedProfile('I could not read that resume.'))).toBe('BAD_RESPONSE_SHAPE');
    expect(codeOf(() => parseImportedProfile('[1,2,3]'))).toBe('BAD_RESPONSE_SHAPE');
  });
});
