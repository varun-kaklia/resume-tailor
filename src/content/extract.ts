/**
 * Pulls job-posting text out of a page.
 *
 * No per-site selectors. Job boards restructure their markup often enough that
 * a table of CSS paths is broken maintenance work by definition, so this scores
 * candidate containers on the shape of their content instead: how much text
 * they hold, how much of it is links, and whether their tag or class marks them
 * as page furniture.
 *
 * Line structure is preserved deliberately. Downstream parsing reads headings
 * and bullet lists, so flattening the document to one long string would defeat
 * it — `textContent` alone is not enough.
 */

import { AppError, MIN_JD_CHARS } from '../core/types';
import type { JobPosting } from '../core/types';

/** Tags that never hold the posting. Removed before scoring. */
const FURNITURE = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME',
  'NAV', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA',
]);

/** Tags whose content should start on a new line. */
const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TD', 'TH', 'TR', 'UL',
]);

/** Class and id fragments that mark a container as chrome rather than content. */
const NEGATIVE = /(^|[\s_-])(nav|menu|header|footer|sidebar|side-?bar|banner|cookie|consent|modal|popup|promo|advert|ads?|social|share|comment|related|recommend|breadcrumb|pagination|skip|toolbar|masthead|subscribe|newsletter)([\s_-]|$)/i;

/** Class and id fragments that mark a container as likely to hold the posting. */
const POSITIVE = /(^|[\s_-])(job|posting|description|details|content|main|body|vacancy|position|opportunity|listing)([\s_-]|$)/i;

/** Containers worth scoring. Anything else is a wrapper or an inline element. */
const CANDIDATE_SELECTOR = 'article, main, section, div, [role="main"], [role="article"]';

/** Below this a container is too small to be a posting, whatever it scores. */
const MIN_CANDIDATE_CHARS = 200;

/** A selection shorter than this is more likely a stray click than a capture. */
const MIN_SELECTION_CHARS = 80;

/** Longest heading still plausible as a job title. */
const MAX_HINT_CHARS = 120;

/**
 * Below this, a capture is page furniture rather than a posting.
 *
 * Shares `MIN_JD_CHARS` with parsing rather than introducing a second
 * threshold. Failing here is better than failing later: this reports
 * `JD_NOT_FOUND`, whose recovery action points the user at selecting the text
 * by hand, which is the actual fix when a board withholds the description.
 */
const MIN_POSTING_CHARS = MIN_JD_CHARS;

const attribute = (element: Element, name: string): string => element.getAttribute(name) ?? '';

const marker = (element: Element): string => `${attribute(element, 'class')} ${attribute(element, 'id')}`;

/**
 * Text of an element with block boundaries turned into newlines.
 *
 * Furniture is skipped rather than removed, so the caller's document is never
 * mutated — the extension runs on someone else's page and must leave it alone.
 */
const blockText = (node: Node): string => {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  if (node.nodeType !== 1) return '';

  const element = node as Element;
  if (FURNITURE.has(element.tagName)) return '';
  if (attribute(element, 'aria-hidden') === 'true') return '';

  let text = '';
  for (const child of Array.from(element.childNodes)) text += blockText(child);
  return BLOCK.has(element.tagName) ? `\n${text}\n` : text;
};

/** Collapses runs of blank lines and trailing spaces without losing line structure. */
const tidy = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n')
    .trim();

/**
 * Length of the text this element would actually contribute.
 *
 * Deliberately not `textContent`: that counts nav, buttons and form labels that
 * `blockText` then drops, so a container full of interface chrome scored as if
 * it were prose. A search typeahead outscoring a job description was the
 * observed symptom.
 */
const contentLength = (element: Element, cache: Map<Element, number>): number => {
  const seen = cache.get(element);
  if (seen !== undefined) return seen;

  const length = blockText(element).replace(/\s+/g, ' ').trim().length;
  cache.set(element, length);
  return length;
};

const rawLength = (element: Element): number => (element.textContent ?? '').replace(/\s+/g, ' ').trim().length;

/**
 * Proportion of an element's text that sits inside links.
 *
 * Navigation and "related jobs" rails are mostly link text, which is what
 * separates them from a posting body of comparable length.
 */
const linkDensity = (element: Element, cache: Map<Element, number>): number => {
  const total = contentLength(element, cache);
  if (total === 0) return 1;

  const links = Array.from(element.querySelectorAll('a')).reduce((sum, anchor) => sum + rawLength(anchor), 0);
  return Math.min(links / total, 1);
};

/**
 * Higher is more likely to be the posting.
 *
 * Length drives the score, link density discounts it, and the count of
 * paragraphs and list items rewards prose over a wall of one-line rows.
 */
const scoreOf = (element: Element, cache: Map<Element, number>): number => {
  const length = contentLength(element, cache);
  if (length < MIN_CANDIDATE_CHARS) return 0;

  const blocks = element.querySelectorAll('p, li, h2, h3, h4').length;
  const hint = marker(element);

  let score = length * (1 - linkDensity(element, cache)) + blocks * 25;
  if (NEGATIVE.test(hint)) score *= 0.25;
  if (POSITIVE.test(hint)) score *= 1.25;
  return score;
};

/** The highest-scoring container, or the body when nothing scores. */
const bestContainer = (doc: Document): Element | undefined => {
  const cache = new Map<Element, number>();
  let best: Element | undefined;
  let bestScore = 0;

  for (const element of Array.from(doc.querySelectorAll(CANDIDATE_SELECTOR))) {
    if (FURNITURE.has(element.tagName)) continue;
    const score = scoreOf(element, cache);
    if (score > bestScore) {
      bestScore = score;
      best = element;
    }
  }
  return best;
};

/**
 * Whether a heading is plausibly the role rather than the site.
 *
 * Two rejections, both from live pages: an all-capitals heading is site
 * branding ("CAREERS AT <COMPANY>"), and a heading absent from the posting text
 * belongs to something layered over the page rather than to the posting itself.
 */
const looksLikeTitle = (heading: string, text: string): boolean => {
  if (heading === '' || heading.length > MAX_HINT_CHARS) return false;
  if (heading === heading.toUpperCase() && /[A-Z]{4}/.test(heading)) return false;
  return text.includes(heading);
};

const headingText = (element: Element | Document | null | undefined): string | undefined =>
  element?.querySelector('h1, h2')?.textContent?.replace(/\s+/g, ' ').trim();

/**
 * The role name as the page states it.
 *
 * Preference runs inward-out: a heading inside the posting names the role, a
 * heading outside it often names the employer or the careers site. The document
 * title is the last resort, with any trailing site name removed.
 */
const titleHint = (doc: Document, container: Element | undefined, text: string): string | undefined => {
  const candidates = [
    headingText(container),
    headingText(doc),
    doc.title.replace(/\s+/g, ' ').trim().split(/\s+[|\u2013\u2014-]\s+/)[0]?.trim(),
  ];

  return candidates.find((candidate): candidate is string => candidate !== undefined && looksLikeTitle(candidate, text));
};

export interface ExtractOptions {
  /** Text the user had highlighted, if any. Takes priority over page scoring. */
  readonly selection?: string;
  readonly url?: string;
  /** Injected in tests. Defaults to the real clock. */
  readonly now?: () => string;
}

/**
 * Reads a posting from a document.
 *
 * A deliberate selection always wins: the user pointing at the text is better
 * evidence than any heuristic, and it is the escape hatch for pages this cannot
 * read. Length validation belongs downstream, where `MIN_JD_CHARS` lives — this
 * only refuses when there is nothing at all to hand over.
 *
 * @throws {AppError} `JD_NOT_FOUND` when the page yields no usable text.
 */
export const extractPosting = (doc: Document, options: ExtractOptions = {}): JobPosting => {
  const capturedAt = (options.now ?? (() => new Date().toISOString()))();
  const url = options.url ?? doc.defaultView?.location?.href;

  const withHint = (text: string, source: JobPosting['source'], container?: Element): JobPosting => {
    const hint = titleHint(doc, container, text);
    return {
      text,
      capturedAt,
      source,
      ...(url !== undefined ? { url } : {}),
      ...(hint !== undefined ? { titleHint: hint } : {}),
    };
  };

  const selection = tidy(options.selection ?? '');
  if (selection.length >= MIN_SELECTION_CHARS) return withHint(selection, 'selection');

  const container = bestContainer(doc);
  const text = tidy(blockText(container ?? doc.body ?? doc.documentElement));
  if (text.length < MIN_POSTING_CHARS) throw new AppError('JD_NOT_FOUND');

  return withHint(text, 'page', container);
};
