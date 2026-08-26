// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { extractPosting } from '../src/content/extract';
import { extractJobSpec } from '../src/core/prompt/jobspec';
import { AppError } from '../src/core/types';

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

const REQUIREMENTS = `
  <h2>Requirements</h2>
  <ul>
    <li>5+ years of backend engineering experience building services at scale</li>
    <li>Strong proficiency in Go and PostgreSQL for transactional workloads</li>
    <li>Comfortable operating production systems on Kubernetes day to day</li>
  </ul>
`;

const BOARD = `
  <body>
    <header class="site-header"><a href="/">Home</a><a href="/jobs">Jobs</a><a href="/about">About</a></header>
    <nav class="nav-primary"><a href="/a">Engineering</a><a href="/b">Design</a><a href="/c">Sales</a></nav>
    <main>
      <div class="job-description">
        <h1>Senior Backend Engineer</h1>
        <h2>Responsibilities</h2>
        <ul>
          <li>Own the reliability of our billing platform end to end for customers</li>
          <li>Partner with product engineers to ship customer-facing features</li>
        </ul>
        ${REQUIREMENTS}
      </div>
    </main>
    <aside class="related-jobs">
      <a href="/1">Staff Engineer</a><a href="/2">Backend Engineer</a><a href="/3">Platform Engineer</a>
    </aside>
    <footer class="site-footer"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
  </body>
`;

describe('extractPosting', () => {
  it('finds the posting and leaves page furniture behind', () => {
    const { text, source } = extractPosting(parse(BOARD));

    expect(source).toBe('page');
    expect(text).toContain('Senior Backend Engineer');
    expect(text).toContain('Kubernetes');
    expect(text).not.toContain('Privacy');
    expect(text).not.toContain('Staff Engineer');
  });

  it('preserves line structure, which downstream heading parsing depends on', () => {
    const lines = extractPosting(parse(BOARD)).text.split('\n');

    expect(lines).toContain('Requirements');
    expect(lines).toContain('Responsibilities');
    expect(lines.length).toBeGreaterThan(5);
  });

  it('feeds the job-spec parser end to end', () => {
    const spec = extractJobSpec(extractPosting(parse(BOARD))).spec;

    expect(spec.title).toBe('Senior Backend Engineer');
    expect(spec.requirements.map((requirement) => requirement.term)).toEqual(
      expect.arrayContaining(['Go', 'PostgreSQL', 'Kubernetes']),
    );
    expect(spec.minYearsExperience).toBe(5);
  });

  it('prefers a deliberate selection over anything it would score', () => {
    const selection = `Data Engineer\n${'We need someone to build ETL pipelines using Python and Airflow. '.repeat(3)}`;
    const { text, source } = extractPosting(parse(BOARD), { selection });

    expect(source).toBe('selection');
    expect(text).toContain('Data Engineer');
    expect(text).not.toContain('Senior Backend Engineer');
  });

  it('ignores a stray selection too short to be a capture', () => {
    expect(extractPosting(parse(BOARD), { selection: 'Apply now' }).source).toBe('page');
  });

  it('discounts a container that is mostly links', () => {
    const linkHeavy = `
      <body>
        <div class="listing">${Array.from({ length: 40 }, (_, i) => `<a href="/j/${i}">Senior Engineer role number ${i}</a>`).join('')}</div>
        <div class="content"><h1>Platform Engineer</h1>${REQUIREMENTS}</div>
      </body>
    `;

    expect(extractPosting(parse(linkHeavy)).text).toContain('Platform Engineer');
  });

  it('skips script, style and aria-hidden content', () => {
    const noisy = `
      <body>
        <div class="job">
          <script>var tracking = "SHOULD_NOT_APPEAR";</script>
          <style>.x { color: red; }</style>
          <span aria-hidden="true">HIDDEN_DECORATION</span>
          <h1>Backend Engineer</h1>
          ${REQUIREMENTS}
        </div>
      </body>
    `;
    const { text } = extractPosting(parse(noisy));

    expect(text).not.toContain('SHOULD_NOT_APPEAR');
    expect(text).not.toContain('HIDDEN_DECORATION');
    expect(text).not.toContain('color: red');
    expect(text).toContain('Backend Engineer');
  });

  it('collapses blank runs without joining separate lines', () => {
    const spaced = `<body><div class="job"><h1>Backend   Engineer</h1><div></div><div></div>${REQUIREMENTS}</div></body>`;
    const { text } = extractPosting(parse(spaced));

    expect(text).not.toMatch(/\n{3}/);
    expect(text).toContain('Backend Engineer');
  });

  it('falls back to the body when nothing scores as a container', () => {
    const bare = `<body>Senior Backend Engineer. ${'We want someone who can build and operate services. '.repeat(6)}</body>`;

    expect(extractPosting(parse(bare)).text).toContain('Senior Backend Engineer');
  });

  it('refuses an empty page', () => {
    expect(() => extractPosting(parse('<body></body>'))).toThrowError(
      expect.objectContaining({ code: 'JD_NOT_FOUND' }) as Error,
    );
  });

  it('gives a refusal a user-facing message', () => {
    try {
      extractPosting(parse('<body>   </body>'));
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).userMessage).toMatch(/\w/);
    }
  });

  it('records where the capture came from', () => {
    const posting = extractPosting(parse(BOARD), {
      url: 'https://example.com/jobs/1',
      now: () => '2026-08-26T00:00:00.000Z',
    });

    expect(posting.url).toBe('https://example.com/jobs/1');
    expect(posting.capturedAt).toBe('2026-08-26T00:00:00.000Z');
  });

  it('does not modify the page it reads', () => {
    const doc = parse(BOARD);
    const before = doc.body.innerHTML;
    extractPosting(doc);

    expect(doc.body.innerHTML).toBe(before);
  });

  it('prefers a heading inside the posting over site branding outside it', () => {
    // A careers site puts its own name in an h1 above the posting.
    const branded = `
      <body>
        <div class="masthead"><h1>CAREERS AT EXAMPLE CORP</h1></div>
        <div class="job"><h2>Senior QA Engineer</h2>${REQUIREMENTS}</div>
      </body>
    `;

    expect(extractPosting(parse(branded)).titleHint).toBe('Senior QA Engineer');
  });

  it('rejects an all-capitals heading as branding rather than a title', () => {
    const shouty = `<body><div class="job"><h1>CAREERS AT EXAMPLE CORP</h1>${REQUIREMENTS}</div></body>`;

    expect(extractPosting(parse(shouty)).titleHint).toBeUndefined();
  });

  it('rejects a heading that does not appear in the posting text', () => {
    // Overlays injected over the page (a translation panel, for one) own headings
    // that belong to no posting.
    const overlaid = `
      <body>
        <div class="overlay" aria-hidden="true"><h1>Original text</h1></div>
        <div class="job"><h2>Platform Engineer</h2>${REQUIREMENTS}</div>
      </body>
    `;

    expect(extractPosting(parse(overlaid)).titleHint).toBe('Platform Engineer');
  });

  it('does not let interface chrome outscore a real posting', () => {
    // Scoring counts only what extraction keeps, so a panel padded with buttons
    // and form labels cannot beat prose of the same apparent size.
    const chrome = Array.from({ length: 30 }, (_, i) => `<button>Suggestion number ${i} for your search</button>`).join('');
    const page = `
      <body>
        <div class="typeahead">${chrome}</div>
        <div class="posting"><h2>Backend Engineer</h2>${REQUIREMENTS}</div>
      </body>
    `;
    const { text } = extractPosting(parse(page));

    expect(text).toContain('Kubernetes');
    expect(text).not.toContain('Suggestion number');
  });

  it('refuses a page that withholds the description instead of returning its chrome', () => {
    // Some boards render the posting only for signed-in visitors.
    const gated = `
      <body>
        <div class="header"><h1>Frontend Engineer</h1></div>
        <div class="wall"><p>Sign in to view this job.</p></div>
      </body>
    `;

    expect(() => extractPosting(parse(gated))).toThrowError(
      expect.objectContaining({ code: 'JD_NOT_FOUND' }) as Error,
    );
  });
});
