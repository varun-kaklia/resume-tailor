# resume-tailor

Tailor your resume to a job posting in one click — without letting an AI make things up about you.

ResumeTailor keeps one **Structured Profile** of your real experience. For each job posting, it selects and rephrases *only what is already in that profile* into a one-page LaTeX resume. You bring your own API key and pick your own model. Nothing leaves your browser except the request you chose to make.

> **Status: early.** The extension builds and installs, and can capture a job posting from a page. There is no user interface yet — no profile editor, no tailoring flow. See [docs/TODO.md](docs/TODO.md).

---

## Why another resume tool

Most AI resume tools have one of three problems. ResumeTailor is built around avoiding all three.

| The usual problem | What ResumeTailor does |
|---|---|
| The AI invents achievements you never had | The model only ever sees a truncated index of your bullets and can only return *IDs plus rewordings*. Every number and proper noun in a rewrite is checked against your original text — unsupported claims are rejected and shown to you |
| Locked to one vendor, priced monthly | Bring your own key: OpenAI, Anthropic, Gemini, or anything OpenAI-compatible including local Ollama. No account, no subscription, no backend |
| Output that merely looks like a resume | Real LaTeX (FAANGPath Simple), typeset, one page, compiles unedited on Overleaf |

---

## How it works

```
Your profile ──┐
               ├──► compact index ──► your AI ──► plan (IDs + rewrites)
Job posting ───┘                                       │
                                                       ▼
                                     validate ──► render ──► one-page .tex
```

The model never receives your dates, employer names, contact details, or your full resume text — it does not need them to judge relevance, and they are joined in locally at render time. That is also why a tailoring costs roughly a tenth of a cent: the wire carries an index and a plan, not two copies of your resume.

---

## Features

- **Structured Profile** — enter your history once: contact, education, experience, projects, skills
- **Role notes** — add your own one-line context to any role (a contract arrangement, a short tenure, a leave). Your words, rendered verbatim, never sent to the AI
- **One-click capture** from LinkedIn, Indeed, Greenhouse, Lever, Workday, or any page (with manual selection as a fallback)
- **Evidence validation** — a rewritten bullet claiming "40% faster" is rejected unless your profile says 40%
- **Google XYZ coaching** — bullets are nudged toward "accomplished [X] as measured by [Y] by doing [Z]"
- **One page, enforced** — overflow is caught before export, with the cheapest cuts suggested
- **Font controls** at the top of the LaTeX template, where you can actually find them
- **Chrome, Firefox and Edge** — Manifest V3, one codebase
- **Your data stays yours** — `storage.local` only, never synced, no telemetry, no server

---

## Bring your own key

| Provider | Notes |
|---|---|
| OpenAI | GPT-class models |
| Anthropic | Claude models |
| Google | Gemini models |
| OpenAI-compatible | Ollama, LM Studio, OpenRouter, or your own proxy — set a base URL |

A local model through Ollama costs nothing per tailoring.

### About your API key

Your key is stored in the browser's extension storage on this machine. It is **not synced** and never sent anywhere except the provider you configured — but browser extension storage is not encrypted. Anyone with access to your browser profile can read it. Use a key with a spending limit, and rotate it if you share the machine. If you would rather not store a key at all, point ResumeTailor at a local Ollama instance.

---

## Install

Not yet published to the extension stores. Build it yourself:

```bash
git clone https://github.com/varun-kaklia/resume-tailor.git
cd resume-tailor
npm install
npm run build            # outputs dist/chrome
npm run check            # typecheck + tests
```

Load it at `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `dist/chrome`.

Clicking the toolbar icon on a job posting captures it: the page is parsed into a
`JobSpec` locally, at no token cost, and cached. Open the service worker console
from `chrome://extensions` to see what was read. The tailoring flow that consumes
it is not built yet — progress is tracked in [docs/TODO.md](docs/TODO.md).

---

## Use

1. **Set up** — options page: pick a provider, paste your key, test the connection
2. **Build your profile** — type it in, or paste an existing resume and confirm each field
3. **Capture a job** — open a posting, click the ResumeTailor icon, hit capture
4. **Tailor** — one click; review the diff of what changed and why
5. **Export** — download the `.tex`, or open it straight in Overleaf

---

## Privacy

- There is no backend. There is no account. There is nothing to sign up for.
- Your profile and API key live in `storage.local` on this device only.
- The **only** outbound request goes to the AI provider you configured, and it contains a truncated index of your bullets plus the job description — not your contact details, dates, or employers.
- No analytics, no crash reporting, no usage tracking.

---

## Documentation

| Document | What is in it |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Stack, folder layout, data model, token strategy, error handling |
| [docs/PDP.md](docs/PDP.md) | Product definition, users, scope, success criteria |
| [docs/TODO.md](docs/TODO.md) | Current and next phase |
| [docs/backlog.md](docs/backlog.md) | Everything else, prioritised, plus the risk register |
| [docs/memory.md](docs/memory.md) | Why things are the way they are — read before changing them |
| [AI_RULES.md](AI_RULES.md) | Rules for AI contributors |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). If you are an AI agent, [AI_RULES.md](AI_RULES.md) is not optional.

## Licence

MIT — see [LICENSE](LICENSE).

The FAANGPath Simple Template is used under its own licence; see `templates/`.
