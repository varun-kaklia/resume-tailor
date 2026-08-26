# ResumeTailor — TODO (active work)

> Full, unprioritised inventory lives in [backlog.md](./backlog.md).
> This file holds only **the current phase + the next phase**. Move items here as phases open.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Phase 0 — Foundation (current)

**Goal:** a repo any contributor (human or AI) can pick up without asking questions.
**Success criteria:** all docs below exist, `src/core/types` compiles under `strict: true`, no runtime code yet.

- [x] `docs/TODO.md`, `docs/backlog.md` — task breakdown
- [x] `docs/architecture.md` — stack, folders, data model, diagrams
- [x] `docs/PDP.md` — product definition
- [x] `docs/memory.md` — decision log for AI agents
- [x] `AI_RULES.md` + `.cursorrules` — hard rules for AI contributors
- [x] `README.md`, `CONTRIBUTING.md`, `.env.example`, `.gitignore`
- [x] `src/core/types/*` — Profile, JobSpec, TailoringPlan, IAIProvider, errors
- [x] `package.json` + `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [x] `config/vite.*.config.ts` + MV3 manifest — builds to `dist/chrome`, loads unpacked
- [ ] `npm run typecheck` green in CI

---

## Phase 1 — Profile is the source of truth

**Goal:** a user can enter and persist a Structured Profile; nothing else works without it.
**Success criteria:** profile survives browser restart; invalid profile produces a field-level error, never a crash; a user-written role note round-trips byte-identical.

- [x] `src/core/profile/schema.ts` — runtime validation of `Profile` (zod or hand-rolled guards)
- [x] `src/core/profile/ids.ts` — stable short IDs (`e1`, `e1b3`) assigned on create, never reassigned
- [x] User-authored role notes (`Experience.note`) — validated, rendered verbatim, never model-visible
- [x] `src/shared/storage.ts` — `chrome.storage.local` wrapper, typed, quota-aware
- [x] Options page: BYOK settings — provider, model, key, base URL, live connection test
- [x] Options page: profile editor (contact, education, experience, projects, skills) — round-trip editing
- [ ] Profile editor: reordering roles, projects and bullets
- [x] Options page: per-role note field, with the character budget shown as the user types
- [ ] Import: paste existing resume text → draft profile (single LLM call, user confirms every field)
- [ ] Export/import profile as JSON (user owns their data)
- [ ] Tests: round-trip persistence, note round-trip, ID stability across edits

---

## Phase 2 — Job capture

**Goal:** one click on a job posting yields a compact `JobSpec`.
**Success criteria:** LinkedIn / Indeed / Greenhouse / Lever / Workday parse without a per-site adapter; unknown sites fall back to selected text, and the user is told which path was used.

- [x] `src/content/extract.ts` — generic readable-region extraction, no per-site selectors
- [x] `src/content/index.ts` — injected on toolbar click, captures once, sends to background
- [x] `src/background/index.ts` — injects on click, runs the job-spec pipeline, caches by hash
- [x] `src/shared/{runtime,messages}.ts` — extension API access and the message contract
- [x] Fallback: user selects text before clicking → selection wins over page scoring
- [ ] Context-menu entry as a second route to capture
- [x] `src/core/prompt/vocabulary.ts` — skill terms, section headings, ambiguity guards
- [x] `src/core/prompt/jobspec.ts` — JD text → `JobSpec`, heuristics only, zero tokens
- [x] `src/core/prompt/jobspec-fallback.ts` — gap-filling model call for unstructured postings
- [x] Heuristic keyword pass runs first; LLM call only fills gaps (token budget)
- [x] Cache `JobSpec` by source hash — re-tailoring the same posting costs zero tokens
- [x] Tests: fixture DOM → JobSpec end to end
- [x] Verify extraction against live Greenhouse / Lever / Workday / LinkedIn pages
- [ ] Re-verify LinkedIn and Indeed while signed in, where the description is actually delivered
- [ ] Ashby and SmartRecruiters spot check

---

## Phase 3 — Tailoring engine

**Goal:** `Profile + JobSpec → TailoringPlan`, provider-agnostic, hallucination-proof.
**Success criteria:** the model never returns prose it invented; every rewritten bullet passes evidence validation or is rejected with a clear message.

- [x] `src/core/types/provider.ts` implemented by `src/providers/openai.ts`
- [x] `src/providers/openai-compatible.ts` — Ollama / LM Studio / OpenRouter, the zero-cost path
- [x] `src/providers/registry.ts` — pick provider from settings, no `switch` in call sites
- [x] `src/core/tailor.ts` — the pipeline: unknown ids → evidence → XYZ → fit → render
- [ ] `src/providers/anthropic.ts`, `src/providers/gemini.ts` — settings lists only implemented providers, so these unlock themselves
- [x] `src/core/prompt/profile-index.ts` — allowlist build of `ProfileIndex`; notes, employers, dates and contact details cannot reach a provider
- [x] `src/core/prompt/messages.ts` — line-oriented prompt in, JSON out; fixed system message so it caches
- [x] `src/core/prompt/parse.ts` — response → `TailoringPlan`, recovering fences and surrounding prose
- [x] Mutation-checked leak tests: deliberate leaks in the index and in the prompt builder both fail the suite
- [x] `src/core/validate/evidence.ts` — every number / proper noun in a rewritten bullet must exist in its source bullet
- [x] `src/core/validate/xyz.ts` — warn when a bullet misses the Google XYZ shape
- [x] Per-request deadlines (60s complete / 10s validate) composed with the caller's signal
- [ ] Retry-once-then-fail policy with a user-facing reason
- [ ] Tests: golden profile + golden JD → stable plan shape; hallucination fixture is rejected

---

## Phase 4 — Render & one page

**Goal:** a one-page PDF-ready `.tex` file out the other end.
**Success criteria:** output compiles on Overleaf unedited; a plan that would overflow one page is caught **before** the user sees a PDF.

- [x] `templates/faangpath-simple.tex` — font/size/margin knobs at the very top
- [x] `src/core/render/latex.ts` — plan + profile → `.tex`, escaping user text
- [ ] `src/core/render/fit.ts` — line-budget estimator, returns `over | tight | ok`
- [ ] Overflow UX: show what to cut, never silently truncate — `over` currently blocks export with a message only
- [x] `.tex` download + copy-to-clipboard
- [ ] "Open in Overleaf" link
- [ ] Tests: escaping (`&`, `%`, `_`, `#`), fit estimator against known-good resumes

---

## Phase 5 — Ship

- [ ] MV3 manifest, one source, per-browser build targets (Chrome / Firefox / Edge)
- [ ] Firefox: `browser.*` polyfill + background page fallback
- [x] Popup: capture → tailor → review → export, four states, no dead ends
- [x] Selection-first capture (select text, then capture) with an inline hint on failure
- [ ] Paste-a-description box in the popup, for pages the reader cannot see at all (D-045)
- [ ] Every `AppError` code has a written user-facing message
- [ ] Store listings, privacy policy ("your key and data never leave your browser except to your chosen provider")
- [ ] CI: typecheck + test + build all three targets
