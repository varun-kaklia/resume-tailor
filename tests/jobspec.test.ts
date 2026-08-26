import { describe, expect, it } from 'vitest';
import { CONFIDENCE_THRESHOLD, extractJobSpec, needsModelFallback } from '../src/core/prompt/jobspec';
import { AppError } from '../src/core/types';
import type { JobPosting } from '../src/core/types';

const posting = (text: string): JobPosting => ({ text, capturedAt: '2026-08-26T00:00:00.000Z', source: 'page' });

const extract = (text: string) => extractJobSpec(posting(text));

const terms = (text: string, weight: 'must' | 'nice'): string[] =>
  extract(text)
    .spec.requirements.filter((requirement) => requirement.weight === weight)
    .map((requirement) => requirement.term);

const GREENHOUSE = `
Senior Backend Engineer

About the role
We are building payment infrastructure used by thousands of businesses.

Responsibilities
- Design and operate services that move money reliably at scale
- Own the reliability of our ledger, including on-call rotation
- Partner with product engineers to ship customer-facing features

Requirements
- 5+ years of professional backend engineering experience
- Strong proficiency in Go or Java
- Experience with PostgreSQL and Kafka
- Comfortable operating services on Kubernetes

Nice to have
- Experience with Terraform
- Exposure to gRPC and event-driven architecture

Benefits
- Competitive salary and equity
- Unlimited PTO
`;

const LINKEDIN = `
Frontend Engineer
Northwind Labs · San Francisco, CA (Hybrid)
Posted 3 days ago · 47 applicants

About the job

Northwind Labs is hiring a Frontend Engineer to join our platform team.

What you'll do
- Build and maintain our customer dashboard using React and TypeScript
- Work with designers to deliver accessible, responsive interfaces
- Improve our frontend build tooling and test coverage

What you'll need
- 3+ years building production web applications
- Deep knowledge of JavaScript, React and CSS
- Familiarity with automated testing using Jest or Cypress

Preferred
- Experience with Next.js
- Interest in accessibility and design systems
`;

const WORKDAY_MESSY = `
JOB DESCRIPTION\r
Position:   Data Engineer\r
Company:  Acme Analytics\r
Location: Austin, TX\r
\r
   *   Build and maintain ETL pipelines using Python and Airflow\r
   *   Model data in Snowflake for analytics consumers\r
\r
MINIMUM QUALIFICATIONS\r
   *   Bachelor's degree or equivalent experience\r
   *   4 years of experience with SQL and Python\r
   *   Hands-on experience with dbt and Airflow\r
\r
PREFERRED QUALIFICATIONS\r
   *   Experience with Spark\r
   *   Familiarity with AWS\r
`;

describe('extractJobSpec — titles', () => {
  it('reads a bare title from the first line', () => {
    expect(extract(GREENHOUSE).spec.title).toBe('Senior Backend Engineer');
  });

  it('reads a labelled title regardless of position', () => {
    expect(extract(WORKDAY_MESSY).spec.title).toBe('Data Engineer');
  });

  it('does not mistake a prose sentence for a title', () => {
    const { spec } = extract(`
      We are a fast-growing company and we love engineers who care about quality.
      Requirements
      - Experience with Python and Django building web services for customers
      - Strong knowledge of PostgreSQL including replication and performance
      - Comfortable with Docker in production environments and CI pipelines
    `);

    expect(spec.title).not.toContain('We are a fast-growing');
  });
});

describe('extractJobSpec — requirements', () => {
  it('separates required from optional by section', () => {
    expect(terms(GREENHOUSE, 'must')).toEqual(expect.arrayContaining(['Go', 'PostgreSQL', 'Kafka', 'Kubernetes']));
    expect(terms(GREENHOUSE, 'nice')).toEqual(expect.arrayContaining(['Terraform', 'gRPC']));
  });

  it('treats a "Preferred" heading as optional', () => {
    expect(terms(LINKEDIN, 'nice')).toContain('Next.js');
    expect(terms(LINKEDIN, 'must')).toEqual(expect.arrayContaining(['JavaScript', 'React', 'CSS']));
  });

  it('honours an inline hedge inside a requirements section', () => {
    expect(terms(`
      Backend Engineer
      We are growing our platform team and looking for someone to help us scale.
      Requirements
      - Strong experience with Python and Django in production environments
      - Knowledge of Kubernetes is preferred but not essential for this role
      - Solid understanding of PostgreSQL including query tuning and indexing
    `, 'nice')).toContain('Kubernetes');
  });

  it('lets a hard requirement outrank the same term mentioned as optional', () => {
    const required = terms(`
      Systems Engineer
      We build low-latency infrastructure and care deeply about correctness.
      Requirements
      - Deep experience programming in Rust for production systems at scale
      Nice to have
      - Familiarity with Rust tooling such as cargo workspaces and clippy
    `, 'must');

    expect(required).toContain('Rust');
  });

  it('normalises aliases so a list has no duplicates', () => {
    const { spec } = extract(`
      Full Stack Engineer
      Join a small team shipping customer-facing products every single week.
      Requirements
      - Strong JavaScript and JS experience across the whole application stack
      - Experience developing with Node and Node.js in production environments
      - Familiarity with k8s and Kubernetes for deployment and orchestration
    `);
    const found = spec.requirements.map((requirement) => requirement.term);

    expect(found.filter((term) => term === 'JavaScript')).toHaveLength(1);
    expect(found.filter((term) => term === 'Kubernetes')).toHaveLength(1);
    expect(new Set(found).size).toBe(found.length);
  });

  it('matches terms that punctuation would normally break', () => {
    const found = terms(`
      Software Engineer
      Our desktop and services teams work across a broad technology surface.
      Requirements
      - Experience programming in C++ and C# on Windows desktop platforms
      - Familiarity with CI/CD pipelines and .NET services running in Azure
      - Comfortable writing SQL against large datasets for reporting work
    `, 'must');

    expect(found).toEqual(expect.arrayContaining(['C++', 'C#', 'CI/CD', '.NET', 'SQL']));
  });

  it('keeps ordinary English out of the requirements list', () => {
    const { spec } = extract(`
      Data Analyst
      About us
      Please go to our careers page and read the rest of this posting before you apply.
      We want someone who will go far with us and enjoy the rest of the team here.
      Requirements
      - Strong experience with Tableau and building reporting for stakeholders
      - Comfortable analysing large datasets and presenting clear conclusions
    `);
    const found = spec.requirements.map((requirement) => requirement.term);

    expect(found).not.toContain('Go');
    expect(found).not.toContain('REST');
  });

  it('accepts an ambiguous term when the line is clearly technical', () => {
    expect(terms(`
      Backend Engineer
      We are hiring engineers to extend our public API surface this year.
      Requirements
      - Strong experience programming in Go and building REST APIs at scale
      - Comfortable with PostgreSQL including schema design and migrations
    `, 'must')).toEqual(expect.arrayContaining(['Go', 'REST']));
  });
});

describe('extractJobSpec — other fields', () => {
  it('reads company, location and work mode', () => {
    const { spec } = extract(LINKEDIN);

    expect(spec.company).toBe('Northwind Labs');
    expect(spec.location).toBe('San Francisco, CA');
    expect(spec.workMode).toBe('hybrid');
  });

  it('reads labelled company and location', () => {
    const { spec } = extract(WORKDAY_MESSY);

    expect(spec.company).toBe('Acme Analytics');
    expect(spec.location).toBe('Austin, TX');
  });

  it('reads seniority from the title in preference to the body', () => {
    expect(extract(GREENHOUSE).spec.seniority).toBe('senior');
  });

  it('reads the lower bound of an experience range', () => {
    expect(extract(GREENHOUSE).spec.minYearsExperience).toBe(5);
    expect(extract(LINKEDIN).spec.minYearsExperience).toBe(3);
    expect(extract(WORKDAY_MESSY).spec.minYearsExperience).toBe(4);
  });

  it('collects responsibilities and stops before the benefits section', () => {
    const { spec } = extract(GREENHOUSE);

    expect(spec.responsibilities?.[0]).toContain('move money reliably');
    expect(spec.responsibilities?.join(' ')).not.toContain('Unlimited PTO');
  });

  it('detects a fully remote role', () => {
    expect(extract(`
      Platform Engineer
      This is a fully remote position open to candidates across the whole EU.
      We operate asynchronously and support flexible working hours for everyone.
      Requirements
      - Experience with Kubernetes and Terraform in production environments
      - Strong Python skills for building and maintaining internal tooling
    `).spec.workMode).toBe('remote');
  });

  it('offers unclaimed technologies as keywords rather than requirements', () => {
    const { spec } = extract(GREENHOUSE);
    const required = new Set(spec.requirements.map((requirement) => requirement.term));

    for (const keyword of spec.keywords) expect(required.has(keyword)).toBe(false);
  });

  it('hashes the source so an unchanged posting is recognised', () => {
    expect(extract(GREENHOUSE).spec.sourceHash).toBe(extract(GREENHOUSE).spec.sourceHash);
    expect(extract(GREENHOUSE).spec.sourceHash).not.toBe(extract(LINKEDIN).spec.sourceHash);
  });

  it('always reports the heuristic path as free', () => {
    expect(extract(GREENHOUSE).spec.heuristicOnly).toBe(true);
  });
});

describe('extractJobSpec — edge cases', () => {
  it('rejects empty text', () => {
    expect(() => extract('   ')).toThrowError(expect.objectContaining({ code: 'JD_NOT_FOUND' }) as Error);
  });

  it('rejects text too short to be a posting', () => {
    expect(() => extract('Backend Engineer wanted. Apply now.')).toThrowError(
      expect.objectContaining({ code: 'JD_TOO_SHORT' }) as Error,
    );
  });

  it('gives every rejection a user-facing message', () => {
    try {
      extract('too short');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).userMessage).toMatch(/\w/);
    }
  });

  it('survives a posting with no structure at all', () => {
    const { spec, gaps } = extract(
      'we need somebody good to help us out with our stuff and things around the office. '.repeat(5),
    );

    expect(spec.title).toBe('Untitled role');
    expect(gaps).toContain('title');
  });

  it('handles carriage returns, non-breaking spaces and asterisk bullets', () => {
    expect(terms(WORKDAY_MESSY, 'must')).toEqual(expect.arrayContaining(['SQL', 'Python', 'dbt', 'Airflow']));
  });
});

describe('needsModelFallback', () => {
  it('stays local for a well-structured posting', () => {
    for (const text of [GREENHOUSE, LINKEDIN, WORKDAY_MESSY]) {
      const extraction = extract(text);
      expect(extraction.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
      expect(needsModelFallback(extraction)).toBe(false);
    }
  });

  it('asks for help when there is no title', () => {
    expect(needsModelFallback(extract(
      'we need somebody good to help us out with our stuff and things around here. '.repeat(5),
    ))).toBe(true);
  });

  it('asks for help when requirements are too thin to tailor against', () => {
    const extraction = extract(`
      Product Manager
      We are looking for a product manager to own our roadmap and work with
      stakeholders across the business to deliver outcomes that matter to customers.
      You will run discovery, write specs, and partner closely with engineering.
    `);

    expect(extraction.gaps).toContain('requirements');
    expect(needsModelFallback(extraction)).toBe(true);
  });

  it('does not spend a call on a missing company alone', () => {
    const extraction = extract(`
      Senior Platform Engineer
      Requirements
      - 6 years of experience with Kubernetes and Terraform
      - Strong Python and Go skills for writing tooling
      - Experience operating PostgreSQL in production
      Responsibilities
      - Own the reliability of our compute platform end to end
    `);

    expect(extraction.gaps).toContain('company');
    expect(needsModelFallback(extraction)).toBe(false);
  });
});
