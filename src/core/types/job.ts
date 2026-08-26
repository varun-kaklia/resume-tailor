/**
 * Job posting capture and its compacted form.
 *
 * A posting is 600–1200 words of which perhaps 80 matter. `JobSpec` is that 80,
 * extracted once and cached, so re-tailoring the same role costs nothing.
 *
 * @see docs/architecture.md §6
 */

/** Raw capture from a page or the clipboard, before any interpretation. */
export interface JobPosting {
  /** Plain text. HTML is stripped at capture; nothing downstream parses markup. */
  readonly text: string;
  readonly url?: string;
  readonly capturedAt: string;
  /**
   * How the text was obtained. Surfaced in the UI so the user knows whether to
   * trust the capture or select the text themselves.
   */
  readonly source: 'page' | 'selection' | 'paste';
}

/** How a requirement was classified, and how hard the renderer should chase it. */
export type RequirementWeight = 'must' | 'nice';

export interface Requirement {
  /** Normalised for matching, e.g. `"kubernetes"`. */
  readonly term: string;
  readonly weight: RequirementWeight;
}

/**
 * The compacted posting. This — not the raw text — is what tailoring receives.
 *
 * Produced by a heuristic keyword pass first; a model call fills the gaps only
 * when the heuristics come back thin.
 */
export interface JobSpec {
  readonly title: string;
  readonly company?: string;
  readonly requirements: readonly Requirement[];
  /**
   * ATS-relevant terms worth mirroring in bullet wording, beyond the
   * requirements themselves (tools, methodologies, domain language).
   */
  readonly keywords: readonly string[];
  readonly seniority?: 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'lead';
  /** Stable hash of the source text. Cache key — identical postings never re-extract. */
  readonly sourceHash: string;
  /** True when heuristics alone produced this, i.e. it cost zero tokens. */
  readonly heuristicOnly: boolean;
}

/** Below this, a capture is not a job description. Raises `JD_TOO_SHORT`. */
export const MIN_JD_CHARS = 200;

/** Postings are truncated to this before any model sees them (~1200 words). */
export const MAX_JD_CHARS = 7000;
