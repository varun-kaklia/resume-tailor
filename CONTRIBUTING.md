# Contributing to ResumeTailor

Thanks for looking. This is a small project with strong opinions — most of them written down, so you do not have to guess.

**Before your first change:** read [docs/architecture.md](docs/architecture.md) and [docs/memory.md](docs/memory.md). The second one explains why things are the way they are, and will save you proposing something already considered and rejected.

**If you are an AI agent:** [AI_RULES.md](AI_RULES.md) is mandatory.

---

## Setup

```bash
git clone https://github.com/<you>/resume-tailor
cd resume-tailor
npm install
npm run dev            # Chrome, watch mode
npm run typecheck      # must be clean
npm test               # must be green
```

Load `dist/chrome` at `chrome://extensions` with Developer mode on.

For manual testing you need an API key. Put it in `.env.local` (see [`.env.example`](.env.example)) — that file is dev-only tooling and never ships in the extension, which reads keys from browser storage.

---

## The seven invariants

Break one and the change will be rejected however good it looks:

1. `src/core/` is pure TypeScript — no `chrome.*`/`browser.*`, no `fetch`, no DOM, no imports from `providers/`, `ui/`, `background/`, `content/`
2. The AI never authors facts; it returns IDs plus rephrasings of text it was shown
3. Role notes are user-authored: never hardcode, default or suggest note content
4. Profile item IDs are permanent and never reused
5. One error type: `AppError`, every code with a hand-written `userMessage`
6. No backend, no telemetry
7. One page is mandatory; overflow is surfaced, never silently truncated

---

## Where things go

| You are adding | It goes in |
|---|---|
| A new AI provider | `src/providers/<name>.ts` + one registry entry. No core changes |
| Business logic | `src/core/` — pure, tested, no platform APIs |
| A UI screen | `src/ui/` |
| Anything touching `browser.*` | `src/background/`, `src/content/`, or `src/shared/` |
| A LaTeX template | `templates/`, with font/size/margin knobs at the very top |
| A test | `tests/`, mirroring the `src/` path |

Nothing new at the repo root.

---

## Adding a provider

The most useful contribution, and the easiest, because the seam already exists.

1. Implement [`IAIProvider`](src/core/types/provider.ts) in `src/providers/<name>.ts`
2. Map **every** vendor failure to an `AppError` code — 401 → `AUTH_FAILED`, 429 → `RATE_LIMITED`, and so on. A vendor error object must never escape your file
3. Implement `validateConfig` as the cheapest round-trip that proves the key and model work. It returns an outcome; it does not throw
4. Add the entry to `src/providers/registry.ts` and the `ProviderId` union
5. Add a test with a recorded response fixture — no live network in tests

If you find yourself wanting to change a `core/` file to make your provider fit, stop and open an issue instead. That means the seam is wrong, and that is worth discussing before it is worked around.

---

## Style

- TypeScript `strict`. No `any` — `unknown` at boundaries, then narrow
- Prefer deleting code to adding it. The shortest change that genuinely fixes the problem wins
- No abstraction until there are two real implementations. `IAIProvider` earns its keep because there are four providers; a `ResumeRendererFactory` for one template does not
- Files under 500 lines, functions that fit on a screen
- Comments explain **why**. If a comment restates the code, delete it
- No new dependency for what twenty lines can do. A new dependency needs a line in `docs/memory.md` justifying it

---

## Tests

Vitest. Every non-trivial function gets one test — the smallest thing that fails if the logic breaks.

Priorities, in order: evidence validation (this is the product's core promise), LaTeX escaping, the fit estimator, role notes surviving an omitting plan, ID stability, provider error mapping.

No mocking of code you own. No live network — record fixtures.

---

## Pull requests

- One concern per PR
- `npm run typecheck && npm test` clean before you open it
- Say what you changed and **why**; if you made an architectural decision, add it to `docs/memory.md` in the same PR
- Tick the item in `docs/TODO.md` if you finished one
- Adding a model call? Answer in the description: *could this be computed locally?* Almost always the answer is yes, and then it should be

---

## Things that will be declined

Not because they are bad ideas — because they are against the shape of this project:

- **Auto-apply or form filling.** Fastest route to store removal
- **Any hosted service, account system or sync.** The absence of a backend is the feature
- **Analytics, "anonymous" telemetry included**
- **Letting the model produce final resume text directly.** It is the one thing the whole architecture exists to prevent
- **Shipping default or example note content**, or making notes model-visible
- **A React migration.** See `docs/memory.md` D-010

---

## Reporting bugs

Include: browser and version, provider and model, what you expected, what happened, and the exact error message shown.

If it is a tailoring bug, export your profile as JSON and **redact it** before attaching — that file contains your contact details. Never paste an API key into an issue; if you have, revoke it now.
