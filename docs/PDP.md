# ResumeTailor — Product Definition (PDP)

## Problem

Tailoring a resume per application is correct advice and unbearable practice. Twenty applications means twenty rounds of reordering bullets, swapping keywords, re-fitting one page, and re-exporting a PDF. So people send one generic resume to forty companies and lose to keyword filters they never see.

Existing AI resume tools fail in one of three ways:

- They **invent achievements** the candidate never had, which fails the first interview question.
- They lock the user into **one vendor's key and one model**, priced per month.
- They produce **HTML that looks like a resume** rather than a typeset one-page PDF a recruiter accepts.

## Solution

A browser extension that keeps one **Structured Profile** — the user's real history, entered once — and, per job posting, selects and rephrases *only what is already there* into a one-page LaTeX resume. The user brings their own API key and picks their own model.

The rewrite is bounded: the AI may reorder, select, and rephrase using the Google XYZ formula. It may not add a fact.

## Users

**Primary — the volume applicant.** Engineer, new grad or 2–8 years in, applying to 10–50 roles. Already has a resume, already has LaTeX or is willing to paste into Overleaf. Wants per-job tailoring without per-job tedium. Owns an OpenAI/Anthropic/Gemini key, or runs Ollama.

**Secondary — the career switcher.** Same history, different framing per target role. Needs emphasis to move between projects, not new projects invented.

**Explicit non-user.** Someone who wants a resume written for them from nothing. ResumeTailor has nothing to say to an empty profile, by design.

## Principles

1. **The profile is the truth.** If it is not in the profile, it does not reach the PDF. No exceptions, no "reasonable inference".
2. **The user owns everything.** Key, data, model choice, output. No account, no backend, no telemetry, no subscription.
3. **One page or a clear reason why not.** The constraint is the product. Never silently truncate.
4. **Every error speaks English.** A user who hits a failure knows what happened and what to do next.
5. **Spend tokens like the user's money.** Because it is.

## Scope — v1

**In**

- Structured Profile: contact, education, experience, projects, skills, with stable IDs
- Manual entry, plus assisted import from an existing resume (user confirms every field)
- Job capture from the active tab, with a manual paste fallback
- BYOK settings: provider, model, API key, optional base URL, connection test
- Tailoring: bullet selection, ordering, XYZ rephrasing, skill prioritisation
- Evidence validation rejecting unsupported claims
- Optional per-role notes, written by the user, rendered verbatim and never model-visible
- FAANGPath Simple LaTeX render with font controls at the top of the template
- One-page fit estimate with actionable overflow guidance
- `.tex` download, clipboard copy, Overleaf link
- Chrome, Firefox, Edge (MV3)

**Out (v1)**

- In-browser PDF compilation — backlog P-29, gated on bundle-size measurement
- Cover letters, application tracking, multiple profiles, alternate templates
- Any hosted service, account system, or sync
- Auto-apply / form filling. Deliberate: it is what gets extensions removed from stores.

## Success criteria

| Criterion | Bar |
|-----------|-----|
| Profile entry | Under 20 minutes from an existing resume |
| Tailor to `.tex` | Under 30 seconds, one click after capture |
| Cost per tailoring | Under $0.01 on a mid-tier model |
| Hallucination rate | Zero unsupported claims reach export — structurally enforced, not measured after the fact |
| One page | The exported `.tex` compiles to one page on Overleaf, unedited |
| Errors | Every failure the user sees names a cause and a next action |
| Setup | Working first tailoring without reading documentation |

## Competitive position

Not "AI writes your resume". **"Your resume, aimed."** The differentiators are the ones competitors structurally cannot copy without rebuilding: no invented content, no vendor lock, real LaTeX typesetting, no subscription.

## Open questions

1. Does the assisted resume import (P-19) do more harm than good? A bad parse fills the profile with subtly wrong facts that then propagate to every application. Possibly it should default off, or require field-by-field confirmation with the source text shown alongside.
2. Do store reviewers treat "resume tailoring with your own API key" as an AI-content policy risk? Determines the store listing language, not the architecture.
3. Is the fit estimator trustworthy enough to *block* export on `over`, or should it only warn? Depends on measured accuracy against real compiles.
