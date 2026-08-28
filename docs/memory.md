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
6. No backend. No telemetry. The only outbound request goes to the user's configured provider. Quick Mode makes no outbound request at all. A hosted free-tier proxy would break this invariant and may not be added without an entry here superseding it (D-065).
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

### D-037 — Page extraction scores containers, it does not select them
**Why:** job boards restructure their markup often, so a table of CSS paths is broken maintenance work by definition (R-05). Candidates are scored on the shape of their content instead: text length, discounted by link density, rewarded for paragraph and list-item count, adjusted by class and id hints. Nav rails and "related jobs" panels are mostly link text, which is what separates them from a posting body of similar length.
**Consequence:** extraction is only proven against fixture DOMs. Live boards are the real test and have not been run.

### D-038 — Extraction preserves line structure
**Why:** `textContent` flattens a document to one string, and `jobspec.ts` reads headings and bullet lists to decide must vs nice. Flattening would silently disable the entire section classifier while still returning plausible text. Block-level tags become newlines; the page itself is never mutated, since the extension is a guest on someone else's document.

### D-039 — The content script is injected on click, not declared
**Why:** a declared content script needs host permissions for every site it might run on. Injecting via `scripting.executeScript` under `activeTab` means the extension can only read a page the user explicitly acted on, asks for no host permissions at install time, and gives store reviewers nothing to object to (architecture §11).
**Consequence:** capture requires a click. That is the intended interaction anyway.

### D-040 — Both bundles are IIFE, and there is no polyfill
**Why:** Chrome does not load content scripts as ES modules, and building the worker the same way keeps the manifest free of `"type": "module"` and lets Firefox's event page load the identical file. `shared/runtime.ts` resolves `chrome`/`browser` structurally off `globalThis`, matching what `shared/storage.ts` already does — adding `webextension-polyfill` now would mean two mechanisms for one job. This narrows D-011 to its intent rather than its letter.

### D-041 — `happy-dom` added as a dev dependency
**Why:** testing a readability algorithm without a DOM is not reasonable, and the alternative — contorting the extractor to run against a hand-rolled node interface — would make the production code worse to keep the test dependency count down. Dev-only; nothing ships with it.

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

### D-042 — Container scoring counts only the text extraction will keep
**Why:** scoring used `textContent`, which includes nav, buttons and form labels that `blockText` then drops, so a container full of interface chrome scored as if it were prose. Observed live: a search typeahead outscored the job description on a real posting page, and the capture returned "0 notifications / Search / suggestions available". Scoring now runs on the same furniture-aware walk as extraction, memoised per element.

### D-043 — A title hint is only trusted if it looks like a title
**Why:** the first `h1` is often not the role. Two live failures: a careers site whose `h1` is `CAREERS AT <COMPANY>`, and a page carrying a translation overlay whose `h1` was "Original text". The hint is now taken from inside the chosen container first — a heading within the posting names the role, one outside it usually names the employer — and rejected when it is all-capitals or absent from the extracted text.
**Trade-off:** a genuinely all-capitals job title is rejected and falls back to text scanning. Rare, and recoverable.

### D-044 — Capture refuses below `MIN_JD_CHARS` rather than returning page chrome
**Why:** some boards render the description only for signed-in visitors. Returning the surrounding interface produced a plausible-length but meaningless result that parsed into a confident, wrong `JobSpec`. Sharing the existing threshold rather than inventing a second one keeps one number, and failing at capture reports `JD_NOT_FOUND`, whose recovery action points at manual selection — the actual fix.

### D-045 — Some boards cannot be captured automatically, and that is not fixable here
**Why:** on a signed-out LinkedIn posting the description is not in the DOM at all; the largest container on the page held 1.6 kB of interface. No extraction heuristic can recover text that was never delivered. Manual selection is the answer, which makes it a primary path in the UI rather than a fallback.

### D-046 — Live verification changed what the fixtures were worth
**Why:** every defect above passed the fixture suite. The fixtures encoded assumptions about how boards are built, and shared those assumptions with the code that was tested against them. Four boards were checked with the real shipped extractor — Greenhouse (server-rendered, two postings), Lever, Workday, and a signed-out LinkedIn posting — and each defect found now has a regression test written from the live shape rather than from the assumption.


### D-047 — Settings offers only providers that have an implementation
**Why:** `ProviderId` names four providers and `src/providers` serves two. Listing Anthropic or Gemini would let a user save a configuration that passes every check and then fails at tailoring time, which is the worst moment to discover it. `PROVIDER_OPTIONS` is the list of what actually works, and a test builds each entry through the registry so the two cannot drift apart.

### D-048 — The connection test uses the real tailoring path
**Why:** "Test connection" builds a provider from the draft and calls the same `validate()` tailoring calls (D-015). A passing test therefore means the configuration works where it matters, rather than meaning a separate check passed.

### D-049 — Form validation lives outside the component
**Why:** `draft.ts` holds the rules and `app.tsx` renders them, so what makes a configuration usable is testable without a DOM, and the same rules gate both Save and Test. Field issues stay hidden until the user acts, so an untouched form does not open covered in complaints.

### D-050 — UI pages build as HTML entries with a relative base
**Why:** extension pages load from a `chrome-extension://` origin where absolute asset paths do not resolve, so `base: './'` is required, not cosmetic. Output is `options.html` rather than `index.html` because the popup will want the same generic name and they share one output directory.

### D-051 — The editor validates with the real profile validator
**Why:** the editor calls `validateProfile` and renders its `FieldIssue` paths beside the matching fields, rather than carrying a second set of rules. One definition of a valid profile, and a field the editor accepts cannot be rejected by storage.

### D-052 — Removal never renumbers
**Why:** ids are permanent (invariant 4). Deleting the second of three roles leaves the third holding `e3`, and the next role added takes `e4`. Renumbering would silently invalidate any cached `TailoringPlan` that referenced them.

### D-053 — `Patch<T>` exists so optional fields can be cleared
**Why:** `Partial<T>` cannot express "set this back to absent" under `exactOptionalPropertyTypes`, and clearing an optional note or project link is an ordinary editing action. `Patch<T>` allows an explicit `undefined` where `Partial` would not.

### D-054 — Validation messages appear only after the user acts
**Why:** an empty profile is invalid by definition, so validating on load would open the editor covered in complaints about fields nobody has reached yet. Issues surface on the first save attempt and stay live after that.

### D-055 — Tailoring runs in the worker, not the popup
**Why:** a popup closes the moment focus moves, and a tailoring call takes several seconds the user has already paid for. Running it in the worker means closing the popup cannot abandon the request. It also keeps the single network call in the one place the architecture allows it (§11). The worker replies asynchronously and returns `true` from the listener, which holds the channel open and keeps the worker alive until the work finishes.

### D-056 — Declaring a popup removed the badge path
**Why:** `action.onClicked` does not fire once `default_popup` is set, so click-to-capture and the badge feedback it drove are gone. Capture is now a button inside the popup, which is better anyway: it can report what was read rather than encoding it in an icon colour.

### D-057 — Capture waits for the reader's message, not for the injection
**Why:** `executeScript` resolves when the file is evaluated, not when the reader has finished, so the worker holds a one-shot resolver that the injected script's message settles. A five-second timeout turns a page that never reports into `JD_NOT_FOUND` rather than a promise that never resolves.

### D-058 — The review screen shows rejections before it shows successes
**Why:** rejected rewrites are the evidence that the anti-hallucination check is real. They are rendered first, in full, naming the unsupported detail and the original wording that was kept. Reworded bullets sit behind a disclosure, because they are the expected case. A guarantee the user cannot see is a guarantee they have no reason to believe.

### D-059 — First run is a sequence, returning visits are tabs
**Why:** the three setup steps depend on each other — read a resume, check what was read, connect the model that will tailor it — and tabs present them as three equal choices to someone who does not yet know what any of them are for. Once a profile exists the sequence has done its job, so the same three panels become tabs, which is the right shape for coming back to change one thing.
**Consequence:** `Shell` decides on load: no saved profile means setup, anything else means tabs. A storage read that *fails* lands in tabs — a failed read is not evidence of a first run, and re-running setup over an existing profile is the worse mistake.
**Progress bar:** a filled track plus the three step names. The bar alone says "there is more" without saying what, which is the part people want before starting.

### D-060 — An import is a draft, never a write
**Why:** extraction is a model reading a document, and it will misread some of it. Saving first and asking later means the first thing a new user sees is their own resume, subtly wrong, already stored. The extracted profile is held in the shell's state and handed to the editor as a seed; the first write to storage is a save the user clicked. This is P-19's "user confirms every field" made structural rather than procedural.
**Consequence:** `ProfileEditor` takes an optional `initial` that is read once on mount instead of loading from storage. The shell remounts it (keyed on an import counter) when a new draft arrives, and drops the draft after a save so later edits are never overwritten by a stale import.

### D-061 — The importer may not produce a role note, and does not allocate ids
**Why:** two things the model must not author, for different reasons. A **note** is the user's own words about their own circumstances (D-024) — a model that inferred "contract role" from a date gap would be inventing precisely the fact that matters most, so there is no `note` key in the response shape and a test asserts one never survives parsing. **IDs** are permanent by invariant 4; assigning them locally from `profile/ids` keeps that a property of this codebase rather than a request in a prompt.
**Also:** the import prompt tells the model it is transcribing, not writing — keep the candidate's wording, add no fact, and never compose a summary that is not already in the text.

### D-062 — A date the importer cannot read stays blank
**Why:** resumes say "Mar 2022", so the parser normalises the formats people actually write into `YYYY-MM`. Anything it still cannot read becomes `''`, which is deliberately not a valid `YearMonth`: `validateProfile` rejects it, the editor flags the field, and the save button stays shut until the user supplies it. The alternative — defaulting to a plausible month — writes a date nobody typed into a document about someone's career.
**Consequence:** a draft profile is allowed to be invalid. That is what the review step is for.

### D-063 — Import takes pasted text, not a PDF
**Why:** pdf.js is ~350 KB in the options bundle to extract text that a user can produce with ⌘A in any PDF viewer, and it extracts two-column resumes badly enough that the model then has to cope with scrambled reading order. Paste and `.txt` cost nothing and work today.
**Reverse if:** users actually stall at this screen. The extraction path takes a string, so adding a PDF reader in front of it changes one file.

### D-064 — Extraction is gated on the provider screen, not reordered around it
**Why:** reading a resume is a real API call, and the model is connected on step 3. Moving the connection to step 1 would open onboarding with an API-key form — the highest-friction screen first, before the user has seen anything work. Instead step 1 says a model is needed, offers the jump to step 3, and keeps "skip, fill it in by hand" open throughout, so a user without a key is never stuck on the first screen of an extension they just installed.

### D-065 — Hybrid: the model upgrades stages, it does not gate the pipeline
**Why:** requiring an API key before the first output means a new user's first experience of a resume tool is signing up for an AI provider. But the alternative usually taken — a hosted free tier — is a backend, and invariant 6 says there is none. The way out is that every stage of this pipeline already had, or could have, a local implementation: heuristic JD extraction shipped in Phase 2 and costs nothing, and selecting bullets by term overlap is arithmetic. So the model became an upgrade to individual stages rather than a precondition of the whole.
**Consequence:** two modes over one pipeline (architecture §4a). Quick Mode is local end to end; Pro Mode swaps in a model at three specific stages. There is no third code path and no "demo mode" branch.

### D-066 — Quick Mode returns real output, not a sample
**Why:** a plan with no rewrites is a complete plan. D-021 already established that a bullet with no rewrite renders in the user's own words, so a local plan produces a genuine one-page resume — right bullets, right order, the candidate's own wording. Shipping that as a watermarked teaser would be a lie about what it is, and would train users to ignore the free path.
**Consequence:** what a key buys is stated precisely and only that: bullets reworded toward the posting's language. Nothing in the UI may imply Quick Mode output is provisional, unfinished, or watermarked.

### D-067 — Quick Mode is the most private mode, so "Pro" names capability, not trust
**Why:** the mode that sends nothing anywhere is the free one. Naming the paid-effort path "Private" or "Secure" — the industry reflex — would be backwards and, worse, would imply Quick Mode is not. Pro means more capability: rewording, and better reading of unusual layouts.
**Rule this establishes:** no copy in this product may describe Quick Mode as less private than BYOK. It is strictly more so.

### D-068 — A local resume reader, with the model as the fallback
**Why:** the same shape as `jobspec.ts` (D-030 onward): a heuristic pass that handles ordinary input for nothing, and a model call for the input it cannot follow. Resumes are more regular than job postings — headings, date ranges, bullet markers — so the heuristic floor is higher here than it is there.
**Consequence:** `core/profile/read.ts` is the default import path in every mode, including for users who have a key. `core/prompt/import.ts` becomes the escape hatch for layouts the reader gives up on, rather than the only way in. Date normalisation moved to `core/profile/dates.ts` so both use one implementation and cannot disagree.

### D-069 — The local planner may select and order, never write
**Why:** it is the anti-hallucination argument again, arrived at from the other side. A local planner *could* trivially generate text — string templates, verb substitution — and it would be the single easiest place in this codebase to start inventing achievements, with no provider boundary and no evidence validator in the way. So its output type is deliberately the same `TailoringPlan` a model returns, with `rewrites` always empty.
**Consequence:** it goes through `validatePlan` like any other plan. An empty rewrite list passes every check trivially, and that is the point: routing it around the validator is how a codebase eventually ships without one.

### D-070 — A local plan is trimmed to fit before render, and what was cut is shown
**Why:** `renderValidated` blocks on `over` (D-022) because a *model's* plan is not ours to edit. A local plan is: choosing fewer bullets is the planner's own job, so it drops the lowest-scoring bullets until `estimateFit` clears, rather than handing the user a block they cannot act on. Invariant 7 still holds — the result screen names every bullet left out, so the overflow is surfaced, never silent.
**Boundary:** the trimming loop uses `fit.suggestedCuts`, so cut ranking stays in one place and Quick Mode cannot drift from what the estimator considers cheapest to lose.

### D-071 — Quick Mode drafts a profile in the background and still will not save it
**Why:** the whole point of the mode is that the second run is better than the first, which needs the parsed profile to persist. But D-060 says an import is a draft, never a write, and reading a resume badly is exactly as likely when it happens invisibly. So Quick Mode parses in the background and *offers* the result: the tailoring appears immediately, and saving the profile is a separate, visible act.
**Consequence:** a user can tailor repeatedly without ever saving anything. That is a supported state, not a funnel to be closed.

### D-072 — Manual paste is an entry point, not a fallback (delivers D-045)
**Why:** live-board testing established that the reader cannot see the description on some sites at all, and that no amount of generic extraction fixes a page that renders its content behind an interaction. A paste box that only appears after a failure is a fallback; one that is simply there is an entry point, and it is the only capture route that works everywhere.
**Consequence:** Quick Mode's job-description box is a plain textarea, always present, with page capture as the convenience on top rather than the other way round. The popup's paste box (still open) is the same decision applied to the other surface.

### D-073 — The popup leads with Quick Mode, and no longer gates on setup
**Why:** it opened with "before tailoring you need a profile and an AI provider" and a button to settings, which is a door with a lock on it. Nothing about the local pipeline needs either, so the popup now shows two boxes and a button. A saved profile and a configured key change what the screen offers, never whether it works.
**Consequence:** the `Setup` gate is gone. Missing pieces are surfaced where they become relevant — "save this as your profile", "connect a model" — rather than in front of the door.

### D-074 — "Improve with my model" is a second pass, not a constrained rewording
**Why:** the natural reading is that the model rewords the bullets the local planner picked. Making that literally true means a new prompt mode that fixes selection and asks only for wording, and a message contract to carry the selection. The existing Pro path already plans and rewords in one call, so reusing it unchanged costs nothing and ships now.
**Consequence:** the model may select differently from the local planner, so the two results are shown separately and the user can go back to the version in their own words. The UI does not claim the model merely reworded what was there.
**Open:** whether a selection-preserving mode is worth its own prompt. Worth answering only if users report the model dropping bullets they wanted.

### D-075 — A pasted posting reaches the worker through the JobSpec cache
**Why:** the worker looks postings up by `sourceHash`, which is how a captured posting already reaches it. Writing a pasted spec into the same cache before asking to tailor reuses that path exactly, instead of adding a message type that carries raw text across the boundary and re-extracts on the other side. It also means a pasted posting is cached like any other, so re-tailoring it costs nothing.

### D-076 — The Pro path requires a saved profile, so the popup offers it only then
**Why:** `runTailoring` reads the profile from storage, which is what keeps the profile out of the message contract and out of the popup's hands. A resume pasted into the popup and never saved therefore cannot be tailored by the model — so the button is replaced by a line saying to save it first, rather than shown and then failing.
**Rejected alternative:** sending the draft profile through the message. It widens the contract, puts full profile text on a channel that currently carries ids and hashes, and makes the worker's storage read no longer the single source of what gets tailored.

## Known unknowns

- Whether generic JD extraction actually works across LinkedIn, Indeed, Greenhouse, Lever and Workday without per-site adapters. Fixture tests in Phase 2 answer this. The manual-paste fallback exists because the answer may be no.
- Whether the fit estimator is accurate enough to block export rather than merely warn. Needs measurement against real compiles.
- Real-world cost per tailoring. The ~$0.01 target is arithmetic from token estimates, not observation.
- How often evidence validation rejects a *legitimate* rewrite. The rule is deliberately strict (D-008, D-020) and the allowlist deliberately small, so some false rejections are expected and acceptable — but nobody has measured the rate against real model output. If it is high enough to be annoying, the fix is a better allowlist, not a looser rule.
- **`Bullet.evidence` is currently unreachable by the model.** Its doc comment says it is "included in the tailoring index as evidence the model may draw on", but `IndexedBullet` has no evidence field and the prompt does not send one, so a rewrite can only cite what is in the visible 90 characters. Evidence still widens what the *validator* accepts, which makes it a safety valve for text the model saw rather than a generation aid. Either the comment is wrong or the index is; deciding needs real model output. Sending evidence would cost tokens and hand the model more detail to recombine, so the current behaviour is the safe default, not an oversight.
- **Year-only date ranges come back blank.** "2018 – 2022" is how most resumes write education, but `YearMonth` needs a month and inventing one breaks D-062, so the reader leaves both ends empty and the editor asks. That is consistent and honest, and it means a typical import needs months typed in by hand. The alternatives are widening `YearMonth` to allow a bare year, or mapping a start year to `-01` and an end year to `-12` and admitting the precision is invented. Undecided.
- **How well the local resume reader copes with real layouts.** It handles the fixtures and the two shapes tested by hand — headed sections with bullet markers, and a terse hyphenated variant. Nobody has run it over a two-column export, a table-based template, or a resume with no section headings at all. `needsModelImport` exists for those, but its threshold is a guess.
- **Whether an extension page can reach a provider at all without host permissions.** The manifest declares none; a page reaches a host only where the provider sends CORS headers. OpenAI may work and Ollama blocks cross-origin by default, so the settings test, resume import and worker tailoring may all be failing for reasons that look like bad keys. Nobody has run it against a live provider.
- Whether `p99`-style prefixed identifiers have siblings the extractor still misses. The class is "a token whose alphabetic part carries meaning the numeric part does not"; `p99` was found by inspection, not by a systematic sweep.
