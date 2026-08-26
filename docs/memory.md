# ResumeTailor — Decision Memory

Long-lived context for anyone (human or AI) picking this up cold. **Read before changing architecture.**

Rules for this file: append, do not rewrite history. When a decision is reversed, mark the old one `SUPERSEDED` and add a new entry saying why. Facts, not narration.

---

## Invariants — never break without an entry here explaining why

1. `src/core/` imports nothing from `src/providers/`, `src/ui/`, `src/background/`, and touches no `chrome.*`/`browser.*` API and no `fetch`. Dependencies point inward only.
2. The AI never authors facts. It returns IDs plus rephrasings of text it was shown. Dates, employers, titles, contact details and role notes are joined locally.
3. Role notes are the user's own words. This codebase never authors, defaults or suggests note content. A note is rendered verbatim, never sent to a model, never dropped by a plan.
3b. No real person's data ships in this repo — no names, employers, dates or circumstances in fixtures, defaults, examples or docs. It is public.
4. Profile item IDs are permanent. Assigned on creation, never reused after deletion.
5. One error type (`AppError`). Every code has a hand-written `userMessage`. No bare `throw new Error()` outside `core/types/errors.ts`.
6. No backend. No telemetry. The only outbound request goes to the user's configured provider.
7. One page is mandatory. Overflow is surfaced, never silently truncated.

---

## Decisions

### D-001 — Structured Profile is the single source of truth
**Why:** every AI resume tool that lets the model hold the text ends up inventing facts. If the text only ever lives in one validated store and the model can only reference it by ID, fabrication becomes a structural impossibility rather than a prompt instruction.
**Consequence:** an empty profile means no output. No "generate a resume for me" path exists.

### D-002 — Model returns a `TailoringPlan`, not a resume
**Why:** ~20× cheaper per bullet, and it keeps dates/contact/notes off the wire entirely.
**Consequence:** the renderer, not the model, owns the document. Adding a template does not touch the prompt.

### D-003 — Truncate the profile index to ~90 chars per bullet
**Why:** enough for relevance judgement, not enough to fabricate detail, ~60% cheaper than full text.
**Watch:** if selection quality proves poor, raise to 120 before considering full text.

### D-004 — Provider-agnostic via a four-method `IAIProvider`
**Why:** users own their key and model; core must never contain a vendor type. Four methods is the smallest surface that supports completion, cost estimation, and a real "Test connection".
**Consequence:** streaming is optional (`stream?`) and unused by core. Providers map vendor errors to `AppError` codes at their boundary.

### D-005 — `estimateTokens` is characters ÷ 3.7, not a real tokenizer
**Why:** bundling tokenizers for three vendors costs megabytes to improve a pre-flight cost estimate. The UI says "approximately".
**Reverse if:** users report the estimate being misleading by more than ~25%.

### D-006 — Ship `.tex`, not PDF, in v1
**Why:** in-browser LaTeX (SwiftLaTeX) is a ~10 MB WASM asset with store-size and load-time consequences that need measuring, not assuming. Overleaf already compiles.
**Consequence:** the one-page guarantee is an *estimate* in v1 (see D-007). Revisit as backlog P-29.

### D-007 — One-page fit is a conservative estimator, labelled as an estimate
**Why:** without a compiler, exactness is a lie. A conservative estimator that occasionally over-warns is honest; a confident percentage is not.
**Consequence:** the UI never shows a fake "97% fit". It shows `ok | tight | over` with a line count.

### D-008 — Evidence validation over prompt instruction
**Why:** "do not invent" is a request. Requiring that every number and proper noun in a rewrite exist in its source bullet is enforcement.
**Consequence:** legitimate rewrites occasionally get rejected. Acceptable — the user sees both versions and decides. False rejections are recoverable; a fabricated metric in an interview is not.

### D-009 — `storage.local`, never `storage.sync`
**Why:** `storage.sync` puts the API key on Google's servers and imposes a small quota. The profile is also personal data with no business syncing.
**Consequence:** profile is per-machine. Manual JSON export/import covers moving it (P-21).

### D-010 — Preact, not React
**Why:** the UI is a form and a review list. ~4 KB versus ~45 KB in an extension bundle.
**Reverse if:** a genuine React-only dependency becomes necessary. None is foreseen.

### D-011 — `browser.*` + polyfill from day one
**Why:** retrofitting cross-browser support after writing `chrome.*` everywhere is a mechanical but repo-wide edit, and Firefox MV3 differences (event page vs service worker) are easier to hold from the start than to discover at release.

### D-012 — No auto-apply, no form filling
**Why:** it is the single fastest route to store removal, and it turns a tool users trust into one they must supervise.

### D-013 — Frozen employment notes live in code, not in the profile — **SUPERSEDED by D-024**
**Why:** if they lived in profile data the user could edit or delete them and the tailoring model could reach them. As constants keyed by employer they are guaranteed present, verbatim, unrewritten.
**Consequence:** adding a note means a code change. Correct for a v1 with two known notes; revisit if this ever needs to be user-managed.
**Superseded 2026-08-26:** hardcoding note content does not survive contact with a public repo. See D-024.

### D-014 — Planning docs live in `docs/`, not the repo root
**Why:** project convention (`CLAUDE.md`) keeps the root to conventional files only: README, CONTRIBUTING, AI_RULES, `.cursorrules`, `.env.example`, `.gitignore`.

### D-015 — `IAIProvider.validate()` takes no argument
**Why:** it was `validateConfig(config)` on a provider already built from a config — two sources of truth. An implementation could test one key while holding another and still look correct in review. Now it validates the config it was constructed with, and settings tests a draft via `createProvider(draft).validate()`, so the tested path and the used path are the same path.
**Corrected:** during Phase 3, while there was one implementation. The same fix across four providers would not have been cheap.

### D-016 — Provider requests carry their own deadline
**Why:** without one, `TIMEOUT` was unreachable — only a caller-supplied signal could abort — yet it is one of three retryable codes in the §8 policy, so the retry branch was dead. 60s for `complete`, 10s for `validate` (a connection test that hangs for a minute is a bad settings experience). Composed with the caller's signal via `AbortSignal.any`, never replacing it.

### D-017 — `validate()` uses GET /models, not a throwaway completion
**Why:** costs zero tokens, separates `AUTH_FAILED` from `MODEL_UNAVAILABLE` precisely, and avoids triggering a cold-start model load on Ollama. Falls back to a 1-token completion only when `/models` 404s, so proxies without the endpoint still get a real test.
**Reverse if:** a provider gates `/models` behind a scope that chat keys lack.

### D-018 — A 404 only means `MODEL_UNAVAILABLE` when the body is about the model
**Why:** the commonest local-model misconfiguration is omitting `/v1` from the base URL. A bare 404 mapped to `MODEL_UNAVAILABLE` told users to change their *model* when their *URL* was wrong. A 404 naming the model still maps to `MODEL_UNAVAILABLE` (OpenAI's real bad-model 404 says "The model `x` does not exist"); anything else surfaces as a wrong-endpoint message naming the URL.

### D-019 — `openai-compatible` is `openai` with a different base URL
**Why:** identical wire format. One implementation, two registry entries, shared rather than copied. Note this does not generalise — Anthropic and Gemini do not speak it and get no free ride.

### D-020 — Numeric claims normalise magnitude but preserve prefix and unit
**Why:** `1.2k` and `1200` are the same claim; `40%`, `40x` and `40` are three different ones; and `p99` is not `99`. The last one was a live bug: dropping the alphabetic prefix let a source saying "cut p50 latency by 99ms" license a rewrite claiming **p99**, because a 99 existed somewhere. `p99` is lowercase, so the proper-noun path did not catch it either. The anti-hallucination check was failing open — the one direction it must never fail — and 27 passing tests did not show it, because the tests shared the code's assumption.

### D-021 — A rejected rewrite loses its wording, not its place
**Why:** evidence rejection discards only the *rewording*. Selection and ordering survive, and with no rewrite for a bullet id the renderer already falls back to the profile's original text. So a rejected rewrite degrades to the user's own words rather than to a hole in the document — and `fit` is measured on the surviving plan, since originals are usually longer than rewrites and measuring pre-rejection would under-report the page.

### D-022 — `renderValidated` blocks export on `over`, it does not warn
**Why:** one page is a hard product constraint, and `estimateFit` is deliberately biased to over-warn (D-007). A false block costs a bullet the user can put back; a false pass costs them the application. `tight` renders — that is what the template's font knobs exist for.
**Open:** this is question 3 in PDP.md. Revisit once the estimator can be calibrated against a real compiler (P-29).

### D-023 — Storage normalises a missing API key to `''`, it does not widen the type
**Why:** local models (Ollama, LM Studio) need no key, but `ProviderConfig.apiKey` is `string`. Widening the type guard to accept `undefined` made it assert `value is ProviderConfig` about an object that was not one — and a type predicate is an assertion, so `tsc` stayed clean and the runtime `TypeError` waited for the first `.trim()`. Normalising at the boundary keeps the object honest to its type, and the provider already treats `''` correctly (the Authorization header is only set `if (apiKey)`).

### D-024 — Role notes are user-authored profile data, not constants — supersedes D-013
**Why:** D-013 kept note content as constants in source. The reasoning behind it was sound — a note the model can reach is a note the model can paraphrase — but the mechanism put specific note text into everyone's copy of the code. Whatever a note says, it is personal by definition: shipping one means every install carries it and every contributor reads it.

The guarantee was worth keeping; the mechanism was not. `Experience.note` is now optional user-authored free text, and the protections moved from "it is a constant" to properties the renderer and index enforce for whatever the user wrote: absent from `ProfileIndex` so no model sees it, rendered verbatim, and never dropped even when a plan omits the role.

**Consequence:** the codebase ships no note content at all — no defaults, no suggested wording, no examples. `MAX_NOTE_CHARS` (240) is the single judgement it makes, and only so a pasted paragraph cannot eat the one page.

**Rule this establishes:** personal data does not belong in this repository in any form — fixtures, defaults, examples, comments, docs. Test fixtures use obviously-fictional companies. Recorded because the original mistake was easy to make and would not have been caught by any test.

### D-025 — `ProfileIndex` is built as an allowlist, never as a redaction
**Why:** the index is assembled field by field from the profile rather than copied and stripped. Stripping requires remembering to strip: a field added to `Profile` later would start travelling to providers by default, and the failure is silent and unrecoverable — the data has already left. Allowlisting fails the other way, which is a missing field in a prompt.
**Consequence:** adding something to the index is a deliberate edit in one place. Contact details, employers, dates, locations, grades, project URLs, bullet evidence and role notes are all absent by construction.

### D-026 — Note exclusion is proven by mutation, not by types
**Why:** `IndexedItem` has no `note` field, so TypeScript already makes a leak hard — but a type cannot stop a leak through a field that does exist, e.g. interpolating a note into `label`. The leak tests fill every private field with a distinct marker and assert none appears in the serialised index or in `system + user`. They were then verified against three deliberate leaks (note via `label`, note via the prompt builder with the index untouched, employer via `label`); each failed the suite. A leak test that has never failed is not evidence.
**Consequence:** re-run that check when the index gains a field. A green leak suite proves nothing on its own.

### D-027 — Line-oriented prompt in, JSON out
**Why:** braces and quotes are tokens that carry no meaning on the way in, and the input is built by this codebase so it needs no parser. The response is JSON because it does. Roughly 30% cheaper on the input side than sending the index as JSON.
**Consequence:** the system message is fixed text and everything variable sits in the user message, so the system half caches across calls.

### D-028 — `BAD_RESPONSE_SHAPE` and `PLAN_INVALID` are separate codes
**Why:** "not JSON at all" is usually fixed by retrying, often on a stronger model. "JSON of the wrong shape" is not, and retrying it burns the user's money to fail the same way. They are different failures and get different codes, per the retry policy in §8.

### D-029 — The parser recovers packaging faults but not content faults
**Why:** smaller models wrap JSON in code fences or a sentence of prose despite being told not to. Retrying costs a real call, so a response whose only fault is packaging is unwrapped rather than rejected. A blank rewrite is dropped for the same reason — the bullet falls back to the user's original wording (D-021), which beats failing an otherwise sound plan over one bad entry.
**Boundary:** the parser checks shape only. Whether an id exists is the profile's business and is decided by `core/tailor.ts`, which has the profile to check against.

### D-030 — Job parsing matches a fixed vocabulary rather than inferring what a skill looks like
**Why:** a posting can call anything a requirement, so pattern-guessing ("capitalised word near the word 'experience'") produces noise that looks like data. A known term found under a known heading is a fact. Terms outside the vocabulary are simply not extracted — a visible miss the user can correct, rather than a confident wrong answer they cannot spot.
**Consequence:** `vocabulary.ts` needs occasional additions as tooling changes. That is maintenance, not a design flaw.

### D-031 — Ambiguous skill terms require a technical signal on the same line
**Why:** `go`, `c`, `r`, `rest`, `node` and `spring` are ordinary English. Matching them normally turns "please go to our careers page and read the rest of this posting" into two requirements. They are accepted only next to words like *experience*, *proficiency*, *programming*, *using*.
**Trade-off:** a posting that names Go in a line with no technical vocabulary at all will miss it. Preferred over the alternative, which fills every requirement list with nonsense.

### D-032 — Section headings decide must vs nice; an inline hedge can downgrade
**Why:** postings mark optionality structurally ("Nice to have", "Preferred qualifications") far more reliably than they mark it in prose. Inline hedges ("Kubernetes is preferred") are handled as a second pass within a required section. A term named as required *anywhere* outranks the same term named as optional elsewhere, because under-claiming a skill costs the user a match.

### D-033 — "About the role" is prose, not a duty list
**Why:** treating it as a responsibilities heading pulled marketing copy into `responsibilities`. Prose headings now close the previous section without opening a collecting one. `job description` matters too — it is a document title on some boards, and reading it as a heading swallowed the labelled fields beneath it.

### D-034 — The fallback asks only for the gaps, on a truncated posting
**Why:** a posting with clear requirements but an unrecognisable title should cost one short question, not a full re-parse. The request carries `FALLBACK_CHARS` (2000) of the posting — titles and requirements sit near the top; the tail is benefits and legal boilerplate — and names only the missing fields.
**Consequence:** a merge never overwrites a heuristic result. A value read from the posting's own structure is better evidence than one a model produced, and letting the model overwrite would make the free path pointless.

### D-035 — A missing company never triggers a model call on its own
**Why:** it is cosmetic, plenty of postings genuinely omit it, and it has no effect on which bullets get selected. Only a missing title or a requirement list too thin to tailor against justifies spending the user's money.

### D-036 — New `JobSpec` fields are not automatically prompt fields
**Why:** `responsibilities`, `location`, `workMode` and `minYearsExperience` exist for the review UI and local scoring. `responsibilities` is the longest field in the spec and the requirements already carry what the model needs to judge relevance, so sending it would be paid-for noise. Same allowlist discipline as D-025, enforced by a test that fails if any of them reaches the wire.

---

## Deferred, with the reason

| Thing | Why not now |
|-------|-------------|
| Runtime schema library (zod) | The profile schema is small and stable. Hand-rolled guards cost less than the dependency. Adopt if the schema grows past ~10 types. |
| Streaming responses | Same token cost, complicates validation, saves a few seconds. Interface allows it; nothing calls it. |
| Multiple profiles | Adds a keying layer to every storage call for a use case one user in twenty has. Wait for the request. |
| In-browser PDF | See D-006. |
| Analytics | Never. There is no backend to send them to, and that is the point. |
| A `CANCELLED` error code | A deliberate user cancel and a real timeout both surface as "took too long". No visible cancel button exists yet, and the fix lands in `errors.ts`, which stays frozen while other lanes build against it. **Trigger:** revisit when the popup grows a cancel button. |
| Anthropic and Gemini providers | The seam is proven with two implementations that share a wire format. Adding a genuinely different one is Phase 3 work, not foundation work. |

---

## Known unknowns

- Whether generic JD extraction actually works across LinkedIn, Indeed, Greenhouse, Lever and Workday without per-site adapters. Fixture tests in Phase 2 answer this. The manual-paste fallback exists because the answer may be no.
- Whether the fit estimator is accurate enough to block export rather than merely warn. Needs measurement against real compiles.
- Real-world cost per tailoring. The ~$0.01 target is arithmetic from token estimates, not observation.
- How often evidence validation rejects a *legitimate* rewrite. The rule is deliberately strict (D-008, D-020) and the allowlist deliberately small, so some false rejections are expected and acceptable — but nobody has measured the rate against real model output. If it is high enough to be annoying, the fix is a better allowlist, not a looser rule.
- **`Bullet.evidence` is currently unreachable by the model.** Its doc comment says it is "included in the tailoring index as evidence the model may draw on", but `IndexedBullet` has no evidence field and the prompt does not send one, so a rewrite can only cite what is in the visible 90 characters. Evidence still widens what the *validator* accepts, which makes it a safety valve for text the model saw rather than a generation aid. Either the comment is wrong or the index is; deciding needs real model output. Sending evidence would cost tokens and hand the model more detail to recombine, so the current behaviour is the safe default, not an oversight.
- Whether `p99`-style prefixed identifiers have siblings the extractor still misses. The class is "a token whose alphabetic part carries meaning the numeric part does not"; `p99` was found by inspection, not by a systematic sweep.
