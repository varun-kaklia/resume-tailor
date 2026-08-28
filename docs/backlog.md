# ResumeTailor — Backlog

Everything known, prioritised. Items graduate to [TODO.md](./TODO.md) when their phase opens.

Priority: **P0** ship-blocking · **P1** first release · **P2** next release · **P3** someday

---

## P0 — Ship-blocking

| ID | Task | Phase | Depends on |
|----|------|-------|------------|
| P-01 | Structured Profile TS model + runtime validation | 1 | — |
| P-02 | Stable short IDs on every profile item | 1 | P-01 |
| P-03 | `chrome.storage.local` typed wrapper, quota-aware | 1 | — |
| P-04 | Profile editor UI (options page) | 1 | P-01, P-03 |
| P-05 | User-authored role notes: field, validation, verbatim render | 1 | P-01 |
| P-06 | JD extraction from active tab | 2 | — |
| P-07 | JD → `JobSpec` compaction | 2 | P-06 |
| P-08 | `IAIProvider` + at least one implementation | 3 | — |
| P-09 | BYOK settings: provider, model, key, base URL | 3 | P-03 |
| P-10 | Tailoring prompt → `TailoringPlan` | 3 | P-01, P-07, P-08 |
| P-11 | Evidence validation (anti-hallucination) | 3 | P-10 |
| P-12 | FAANGPath LaTeX template with font controls | 4 | — |
| P-13 | Plan → `.tex` renderer with escaping | 4 | P-10, P-12 |
| P-14 | One-page fit estimator + overflow UX | 4 | P-13 |
| P-15 | `.tex` export (download + clipboard) | 4 | P-13 |
| P-16 | MV3 manifest, three build targets | 5 | — |
| P-17 | Popup flow: capture → tailor → review → export | 5 | P-10, P-15 |
| P-18 | Error catalogue: every code has a user message | 5 | — |

## P1 — First release

| ID | Task | Notes |
|----|------|-------|
| P-19 | ~~Import existing resume text → draft profile~~ **done** | One LLM call; user confirms every field before it is written. PDF input still open |
| P-20 | `JobSpec` cache keyed by URL hash | Re-tailoring the same posting costs zero tokens |
| P-21 | Profile export / import as JSON | Data ownership; also the bug-report format |
| P-22 | Diff view: original bullet vs tailored bullet | Trust — user sees exactly what changed |
| P-23 | Google XYZ linter with inline hints | Warn, never block |
| P-24 | Keyword coverage meter (JobSpec terms hit) | Local computation, no tokens |
| P-25 | Per-request token + cost estimate before sending | Shown pre-flight, not after |
| P-26 | Key validation on save ("test connection") | Fails fast with a real message |
| P-27 | Privacy policy + store listings | Required for review |
| P-28 | CI: typecheck, test, build ×3 | — |

## P2 — Next release

| ID | Task | Notes |
|----|------|-------|
| P-29 | In-browser PDF via WASM LaTeX (SwiftLaTeX) | ~10 MB asset — measure before committing (see R-02) |
| P-30 | Tailored cover letter from the same plan | Reuses `JobSpec`; separate render path |
| P-31 | Application history (JD, plan, date, outcome) | Local only |
| P-32 | Multiple profiles (e.g. backend vs data) | Profile becomes a keyed collection |
| P-33 | Alternate templates (Deedy, Jake's) | Renderer must already be template-agnostic |
| P-34 | Streaming tailoring for perceived speed | `IAIProvider.stream?` is optional by design |
| P-35 | Local model preset (Ollama one-click) | Zero-cost path |
| P-36 | i18n scaffolding | — |

## P3 — Someday

| ID | Task |
|----|------|
| P-37 | ATS score heuristic (honest one — no fake percentages) |
| P-38 | Bulk tailoring across saved postings |
| P-39 | Optional encrypted cloud sync of profile |
| P-40 | Recruiter-facing shareable one-pager |

---

## Risks

| ID | Risk | Impact | Mitigation |
|----|------|--------|------------|
| R-01 | One-page guarantee is unverifiable without a real LaTeX compiler | High — the core promise | Ship a conservative line-budget estimator; state it as an estimate; P-29 makes it exact |
| R-02 | WASM LaTeX bundle is huge and may breach store size limits | Medium | Measure first; lazy-load on demand or host the compile step opt-in |
| R-03 | API key stored in `storage.local` is readable by anyone with the browser profile | High | Say so plainly in the README and settings UI; never sync; offer local-model path |
| R-04 | Model invents achievements despite instructions | High — user credibility | Structural defence: model returns IDs + rewrites, evidence validator rejects unsupported numbers/nouns |
| R-05 | Job-board DOMs change constantly | Medium | No per-site selectors; generic extraction + manual selection fallback |
| R-06 | Firefox MV3 differs (background page, `browser.*`, no service worker) | Medium | Polyfill from day one; build matrix in CI |
| R-07 | Provider APIs drift (schemas, model names) | Medium | All provider quirks live behind `IAIProvider`; core never sees a vendor type |
| R-08 | Role notes are sensitive personal text | Medium | User-authored only — no defaults or examples ship. Never sent to a model, never paraphrased, never dropped. Nothing personal belongs in this repo |
| R-09 | Store review rejects "AI resume generator" as a policy risk | Medium | Position as a formatting/tailoring tool with user-supplied content and user-supplied key |
