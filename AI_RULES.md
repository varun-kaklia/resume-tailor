# AI_RULES.md

Rules for any AI agent contributing to ResumeTailor. Read this and `docs/memory.md` before writing a line.

If a rule here conflicts with a request, **say so and stop**. Do not silently pick one.

---

## The seven invariants

Breaking any of these is a defect regardless of how well it is written.

1. **`src/core/` is pure.** No `chrome.*` / `browser.*`, no `fetch`, no DOM, no imports from `providers/`, `ui/`, `background/`, `content/`. Dependencies point inward only.
2. **The AI never authors facts.** It returns item IDs and rephrasings of text it was shown. Dates, employers, titles, contact details and role notes are joined locally at render.
3. **Role notes are the user's words.** Never author, default, suggest or hardcode note content — not in code, tests, fixtures, prompts, examples or comments. A note the user wrote is rendered verbatim, never sent to a model, never rewritten, never dropped.
4. **Item IDs are permanent.** Assigned on creation, never reused after deletion.
5. **One error type.** Everything throws `AppError` with a code and a hand-written `userMessage`. No bare `throw new Error()` outside `core/types/errors.ts`. No empty `catch`.
6. **No backend, no telemetry.** The only outbound request goes to the provider the user configured.
7. **One page is mandatory.** Overflow is surfaced with actionable cuts, never silently truncated.

---

## Content rules

- **Never invent resume content.** Not a metric, not a technology, not a scaled-up number. If the profile says "improved load time", the resume may not say "improved load time by 40%".
- **Rewrites are validated, not trusted.** Every number, percentage, currency amount and proper noun in a rewritten bullet must appear in the source bullet's `text` or `evidence`.
- **Google XYZ shape:** "Accomplished [X] as measured by [Y] by doing [Z]". Enforce as a *warning* — a user's honest bullet without a metric still ships.
- **A rejected rewrite is visible.** Show the user the original and the rejected version. Never quietly substitute.
- **Never put a real person's details in this repo.** No names, employers, dates or personal circumstances in fixtures, defaults, examples or docs. Test fixtures use obviously-fictional companies. This is a public repo; anything committed here is published.

---

## Token rules

Every token is the user's money.

- Send **IDs, not prose**. Anything already on disk is joined locally.
- Truncate the profile index to `INDEX_BULLET_CHARS` (90).
- Request rewrites **only for selected bullets**.
- Run heuristics **before** any model call — keyword matching, coverage scoring and fit estimation are local arithmetic.
- **Cache by content hash.** Same profile + same JD = no call.
- No streaming, no multi-turn refinement loops. One call, one plan.

Before adding any model call, answer in the PR: *can this be computed locally?* If yes, do that.

---

## Code rules

- TypeScript `strict`. No `any`. `unknown` at boundaries, then narrow.
- **SOLID / DRY / KISS**, in that order of leverage — but no abstraction with one implementation. `IAIProvider` earns its interface because there are four providers; nothing else does yet.
- Files under 500 lines. Functions that fit on a screen.
- Prefer pure functions. Side effects live at the edges (`background/`, `content/`, `shared/storage.ts`).
- No dependency for what twenty lines can do. Adding one needs a line in `docs/memory.md` explaining why.
- Comments explain **why**, never what. If a comment restates the code, delete the comment.
- Every non-trivial function gets one test. No fixture frameworks, no mocks of things you own.

---

## Process rules

- **Read before writing.** Read the file you are editing and `docs/memory.md`. Do not guess at an existing API.
- **Edit over create.** New files need a reason.
- **No documentation files unless asked.** This repo already has the docs it needs.
- **Nothing at repo root** except conventional files (README, CONTRIBUTING, AI_RULES, `.cursorrules`, `.env.example`, `.gitignore`, config). Everything else: `src/`, `tests/`, `docs/`, `templates/`, `scripts/`.
- **No secrets, ever.** Not in code, not in tests, not in a commit, not in a log line.
- **Record architectural decisions** in `docs/memory.md` as you make them, with the reason. A decision without a reason will be reversed by the next agent.
- **Update `docs/TODO.md`** when you finish a task. A stale TODO is worse than none.

---

## When you are unsure

Ask, or pick the option that removes code. Do not build a configurable, extensible, future-proof version of something nobody has asked for twice. The reversal cost of too little abstraction is an afternoon; the cost of too much is the life of the project.
