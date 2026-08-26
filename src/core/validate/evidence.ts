/**
 * Evidence validation — the anti-hallucination check.
 *
 * "Never invent content" is a request; this is the enforcement. Every number
 * and every proper noun in a rewritten bullet must already appear in the source
 * bullet's `text` or `evidence`. A rewrite that adds a fact is reported, never
 * silently dropped and never silently accepted: the caller shows the user both
 * versions and lets them choose.
 *
 * Pure. No I/O, no `chrome.*`, no throwing — issues are returned as data.
 *
 * @see AI_RULES.md (Content rules), docs/architecture.md §9, docs/memory.md D-008
 */

import type { Bullet, EvidenceIssue, ItemId, Profile, TailoringPlan } from '../types/index';

// --- Numbers ---------------------------------------------------------------

/**
 * A digit run with an optional scale/unit suffix.
 *
 * The suffix is guarded by `(?![a-z])` (case-insensitive, so it also excludes
 * A-Z) so that `40ms` reads as plain 40 rather than 40 million. Longer words
 * precede their single-letter forms so `1.2 million` is not read as `1.2 m`.
 */
const NUMBER_PATTERN = String.raw`(\d[\d,]*(?:\.\d+)?)(?:\s*(%|percent|pct|thousand|million|billion|trillion|bn|x|k|m|b)(?![a-z]))?`;
const NUMBER_RE = new RegExp(NUMBER_PATTERN, 'gi');
const NUMBER_ONCE = new RegExp(NUMBER_PATTERN, 'i');

const SCALES: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  trillion: 1e12,
};

/** Kills float noise from scaling (1.2 × 1e6) without losing real decimals. */
const round = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Canonical comparison key for a numeric claim, or `null` if there is no number.
 *
 * Magnitude is normalised (`1,200`, `1200`, `1.2k` all collapse). Two things
 * are deliberately kept apart:
 *
 * - the *unit*: `40%`, `40x` and `40` are three different claims, so a source
 *   saying "40 ms" does not license a rewrite saying "40%";
 * - any *alphabetic prefix*: `p99` keys as `p:99`, so a source that mentions
 *   `p50` and a bare `99` elsewhere does not license a rewrite claiming `p99`.
 *   A trailing unit (`40ms`) is not a prefix and still keys as plain `40`.
 */
export const normaliseNumber = (raw: string): string | null => {
  const match = NUMBER_ONCE.exec(raw);
  if (!match) return null;

  const value = Number((match[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;

  const prefix = raw.slice(0, match.index).match(/[A-Za-z]+$/)?.[0]?.toLowerCase();
  const key = (core: string): string => (prefix ? `${prefix}:${core}` : core);

  const suffix = (match[2] ?? '').toLowerCase();
  if (suffix === '%' || suffix === 'percent' || suffix === 'pct') return key(`${round(value)}%`);
  if (suffix === 'x') return key(`${round(value)}x`);
  return key(String(round(value * (SCALES[suffix] ?? 1))));
};

/**
 * Every numeric claim in `text`, as it appears on the page.
 *
 * Digits embedded in a word count — `p99` and `S3` are claims, and `p99` is
 * exactly the kind of detail a model invents. Any leading letters are kept in
 * the returned string so the UI names a token the user recognises.
 */
export const extractNumbers = (text: string): string[] => {
  const found: string[] = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    const at = match.index ?? 0;
    let start = at;
    while (start > 0 && /[A-Za-z]/.test(text[start - 1] ?? '')) start -= 1;
    found.push(text.slice(start, at + match[0].length));
  }
  return found;
};

// --- Proper nouns ----------------------------------------------------------

/**
 * Past-tense verbs a bullet legitimately opens with. Shared with `xyz.ts`,
 * which uses them to judge whether a bullet leads with an action.
 */
export const ACTION_VERBS: ReadonlySet<string> = new Set([
  'accelerated', 'analysed', 'analyzed', 'architected', 'authored', 'automated', 'benchmarked',
  'built', 'championed', 'consolidated', 'coordinated', 'created', 'cut', 'debugged', 'decreased',
  'delivered', 'deployed', 'designed', 'developed', 'documented', 'drove', 'eliminated',
  'engineered', 'established', 'expanded', 'fixed', 'grew', 'halved', 'hardened', 'hired',
  'implemented', 'improved', 'increased', 'instrumented', 'integrated', 'introduced', 'launched',
  'led', 'maintained', 'managed', 'mentored', 'migrated', 'modernised', 'modernized', 'monitored',
  'negotiated', 'onboarded', 'optimised', 'optimized', 'owned', 'partnered', 'ported', 'profiled',
  'prototyped', 'ran', 'rebuilt', 'reduced', 'refactored', 'removed', 'replaced', 'researched',
  'resolved', 'saved', 'scaled', 'secured', 'shipped', 'spearheaded', 'standardised',
  'standardized', 'streamlined', 'tested', 'trained', 'tuned', 'upgraded', 'won', 'wrote',
]);

/**
 * Ordinary words that carry no identity even when capitalised.
 *
 * Kept deliberately small and deliberately boring: function words, and verbs no
 * one would mistake for a product. A word wrongly on this list is a fabricated
 * fact that reaches an interview; a word wrongly off it is one click for the
 * user (D-008). Nothing that could name a company, tool or place belongs here.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  ...ACTION_VERBS,
  // Weak openers — not proper nouns, but `xyz.ts` still warns about them.
  'assisted', 'contributed', 'handled', 'helped', 'participated', 'responsible', 'supported', 'worked',
  // Function words.
  'a', 'across', 'after', 'all', 'an', 'and', 'as', 'at', 'before', 'both', 'but', 'by', 'during',
  'each', 'every', 'for', 'from', 'if', 'in', 'into', 'it', 'its', 'my', 'no', 'not', 'of', 'on',
  'or', 'our', 'over', 'per', 'that', 'the', 'their', 'then', 'these', 'this', 'those', 'through',
  'to', 'under', 'until', 'using', 'via', 'we', 'when', 'while', 'with', 'within',
]);

/** Lowercase, punctuation removed — the form both sides are compared in. */
const depunctuate = (token: string): string => token.toLowerCase().replace(/[^a-z0-9]+/g, '');

const trimEdges = (token: string): string =>
  token.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}+#]+$/u, '');

/**
 * Candidate proper nouns in `text`.
 *
 * A token qualifies when it contains an uppercase letter and at least two
 * alphanumeric characters. Two exemptions, both narrow:
 *
 * - it is on the allowlist (and is not an all-caps acronym — `AWS` is a claim
 *   even though `led` is not);
 * - it opens the bullet and looks like a past-tense verb (`Orchestrated`),
 *   which is capitalised by convention rather than by identity.
 *
 * Note that sentence-initial position alone is *not* an exemption: a rewrite
 * beginning "Kubernetes deployments…" must still answer for Kubernetes.
 */
export const extractProperNouns = (text: string): string[] => {
  const found: string[] = [];
  text
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word, index) => {
      const token = trimEdges(word);
      if (depunctuate(token).length < 2) return;
      if (!/[A-Z]/.test(token)) return;

      const isAcronym = token === token.toUpperCase();
      if (!isAcronym) {
        if (ALLOWLIST.has(depunctuate(token))) return;
        if (index === 0 && /^[A-Z][a-z]+ed$/.test(token)) return;
      }
      found.push(token);
    });
  return found;
};

// --- Validation ------------------------------------------------------------

/**
 * Supporting word forms of the source, at two granularities: the whole
 * punctuation-stripped token (`CI/CD` → `cicd`) and each alphanumeric run
 * inside it (`Kubernetes-based` → `kubernetes`, `based`). A rewrite matches if
 * either form is present.
 */
const supportedWords = (source: string): ReadonlySet<string> => {
  const words = new Set<string>();
  for (const token of source.split(/\s+/)) {
    const whole = depunctuate(token);
    if (whole) words.add(whole);
    for (const run of token.toLowerCase().match(/[a-z0-9]+/g) ?? []) words.add(run);
  }
  return words;
};

const bulletsById = (profile: Profile): ReadonlyMap<ItemId, Bullet> => {
  const bullets = new Map<ItemId, Bullet>();
  for (const section of [...profile.experience, ...profile.projects]) {
    for (const bullet of section.bullets) bullets.set(bullet.id, bullet);
  }
  return bullets;
};

/**
 * Every claim in the plan's rewrites that the profile does not support.
 *
 * One issue per unsupported claim. An empty result means every rewrite is
 * grounded; it never means "probably fine".
 */
export const validateRewrites = (plan: TailoringPlan, profile: Profile): EvidenceIssue[] => {
  const bullets = bulletsById(profile);
  const issues: EvidenceIssue[] = [];

  for (const rewrite of plan.rewrites) {
    const source = bullets.get(rewrite.id);
    // An unknown id is not an evidence failure — there is no original to show
    // the user. `unknownIds` reports it and the caller raises UNKNOWN_ITEM_ID.
    if (!source) continue;

    const grounds = [source.text, ...(source.evidence ?? [])].join(' \n ');
    const numbers = new Set(extractNumbers(grounds).map(normaliseNumber));
    const words = supportedWords(grounds);

    const reported = new Set<string>();
    const flag = (unsupported: string): void => {
      if (reported.has(unsupported.toLowerCase())) return;
      reported.add(unsupported.toLowerCase());
      issues.push({
        bulletId: rewrite.id,
        unsupported,
        rewritten: rewrite.text,
        original: source.text,
      });
    };

    for (const claim of extractNumbers(rewrite.text)) {
      if (!numbers.has(normaliseNumber(claim))) flag(claim);
    }
    for (const noun of extractProperNouns(rewrite.text)) {
      if (!words.has(depunctuate(noun))) flag(noun);
    }
  }

  return issues;
};

/**
 * Every `ItemId` the plan references that the profile does not contain.
 *
 * A non-empty result is fatal to the plan: callers raise
 * `AppError('UNKNOWN_ITEM_ID')` rather than rendering a partial document.
 */
export const unknownIds = (plan: TailoringPlan, profile: Profile): ItemId[] => {
  const known = new Set<ItemId>();
  for (const section of [...profile.experience, ...profile.projects]) {
    known.add(section.id);
    for (const bullet of section.bullets) known.add(bullet.id);
  }
  for (const entry of profile.education) known.add(entry.id);
  for (const group of profile.skills) known.add(group.id);

  const referenced: ItemId[] = [
    ...[...plan.experience, ...plan.projects].flatMap((section) => [section.id, ...section.bulletIds]),
    ...plan.skills.map((group) => group.id),
    ...plan.rewrites.map((rewrite) => rewrite.id),
    ...plan.educationIds,
  ];

  return [...new Set(referenced.filter((id) => !known.has(id)))];
};
