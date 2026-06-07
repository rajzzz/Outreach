# Outreach Pipeline

**One domain in, personalized outreach out.** A NestJS command-line tool that takes a single seed domain, finds lookalike companies, identifies decision-makers, resolves verified work emails, pauses for human review, and sends personalized outreach — all in one command.

> Live integrations against Ocean.io, Prospeo (LinkedIn email finder), and Brevo. `DRY_RUN=true` (the default) lets you exercise the full pipeline without sending email.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Setup (60 seconds)](#setup-60-seconds)
- [Usage](#usage)
- [Architecture overview](#architecture-overview)
- [The pipeline stages](#the-pipeline-stages)
- [Edge case handling](#edge-case-handling)
- [Configuration](#configuration)
- [Email copy](#email-copy)
- [Project structure](#project-structure)
- [Logging & retry](#logging--retry)
- [Polish & robustness checklist](#polish--robustness-checklist)
- [Limitations & Roadmap](#limitations--roadmap)

---

## Prerequisites

- **Node.js 18+** (project targets ES2021 / Node 20 types)
- **npm**
- **API keys** for:
  - Ocean.io (`X-Api-Token`)
  - Prospeo (`X-KEY`)
  - Brevo (`api-key`) plus a verified sender email

---

## Setup (60 seconds)

```bash
# 1. clone
git clone <repo-url> outreach
cd outreach

# 2. configure
cp .env.example .env
# open .env and fill in OCEAN_API_KEY, PROSPEO_API_KEY,
# BREVO_API_KEY, BREVO_SENDER_EMAIL

# 3. install
npm install

# 4. run
npm start stripe.com
```

The pipeline fails fast at startup if any required key is missing, with a clear message telling you which ones. `DRY_RUN=true` is on by default, so the first run won't actually send email — flip it to `false` once you've reviewed a checkpoint.

---

## Usage

```bash
npm start <domain>
```

Example:

```bash
npm start stripe.com
```

The CLI validates the domain, validates env config, runs the four stages, prints a review table, and prompts before sending:

```
Send outreach to N contact(s)? [y/N]
```

Anything other than `y` / `yes` aborts without sending. With `DRY_RUN=true` the send stage is skipped even after you confirm. Press **Ctrl+C** at any time for a clean shutdown.

### Other scripts

| Script               | Purpose                                            |
|----------------------|----------------------------------------------------|
| `npm start`          | Run the pipeline via `ts-node`                     |
| `npm run start:dev`  | Run in watch mode (`nest start --watch`)           |
| `npm run build`      | Compile TypeScript to `dist/` (`nest build`)       |
| `npm run start:prod` | Run the compiled output (`node dist/main`)         |
| `npm run lint`       | ESLint with `--fix`                                |
| `npm run format`     | Prettier formatting                                |

---

## Architecture overview

The project uses a **flat, linear architecture** that mirrors the pipeline itself. Each stage is a NestJS service; `PipelineService` injects them by class and calls them in order. There are no port interfaces or DI tokens — every dependency is a typed class so the compiler verifies the wiring.

```
seed domain ─▶ Ocean.io ─▶ Prospeo search ─▶ Prospeo LinkedIn email finder
                                                              │
                              outreach sent ◀── Brevo ◀── human review ◀─┘
```

```
                        ┌──────────────────┐
                        │   main.ts (CLI)   │
                        │ + signal handlers │
                        │ + config validate │
                        └────────┬─────────┘
                                  │
                                  ▼
                        ┌──────────────────┐
                        │ PipelineService   │
                        │ (orchestrator)    │
                        └────────┬─────────┘
        injects ┌──────────────┼─────────────┬──────────────┬──────────────┐
                ▼              ▼              ▼              ▼              ▼
        OceanService   ProspeoService    BrevoService  CheckpointService  PipelineLogger
        (stage 1)      (stages 2 + 3)     (stage 4)    (human review)     (cross-cutting)
                │              │              │
                └──────────────┴──────────────┘
                         each uses
                   RetryUtil + axios + ConfigService
```

---

## The pipeline stages

`PipelineService.run()` executes four stages plus a checkpoint. Each stage consumes the output of the previous one.

| # | Stage             | Service / API                                         | Input            | Output         |
|---|-------------------|-------------------------------------------------------|------------------|----------------|
| 1 | Find lookalikes   | `OceanService` → `POST /v3/search/companies`          | seed domain      | `Company[]`    |
| 2 | Find contacts     | `ProspeoService` → `GET /domain-search`               | `Company[]`      | `Contact[]`    |
| 3 | Resolve emails    | `ProspeoService` → `POST /linkedin-email-finder`      | `Contact[]`      | `Contact[]`    |
| — | **Safety review** | `CheckpointService` (stdin prompt)                    | `Contact[]`      | `boolean`      |
| 4 | Send outreach     | `BrevoService` → `POST /smtp/email`                   | `Contact[]`      | count sent     |

### Stage details

- **Stage 1 — Ocean.io.** Cursor-based pagination via `searchAfter`, `OCEAN_PAGE_SIZE` results per page. Stops when the cursor runs out **or** `MAX_COMPANIES` is reached, then trims to the exact cap. Auth via `X-Api-Token`.
- **Stage 2 — Prospeo domain search.** Queries each company's domain with a configurable `PROSPEO_SENIORITY_FILTER` (defaults to `C_SUITE,VP`). Caps results to `MAX_CONTACTS_PER_COMPANY`. Per-domain `try/catch` — one failing domain is logged and skipped, never crashes the run. Auth via `X-KEY`.
- **Stage 3 — Prospeo LinkedIn email finder.** Resolves each contact's LinkedIn URL to a verified work email (`POST /linkedin-email-finder`). **Credit-conscious by design:**
  - **Sequential calls**, no parallelism — a flood of failures can't burn credits before the loop notices.
  - **Per-URL deduplication** within the batch — a LinkedIn URL shared across multiple contacts costs exactly one credit. Failures are cached too, so a bad URL isn't retried.
  - **Skips contacts that already have an email** — zero credits spent.
  - **Per-contact failure isolation** — a failed lookup marks `emailVerified: false` and keeps the contact (so the checkpoint can show the gap) instead of dropping it or aborting the batch.
  - **Best-effort credit balance log** at the start of the stage (silent if your plan doesn't expose it).
- **Stage 4 — Brevo.** Sends one personalized transactional email per verified contact, throttled to ~2 RPS (500ms between sends). Auth via `api-key`. Skipped entirely when `DRY_RUN=true`.
  - **Verified-only:** filters to `email && emailVerified`. Unverified contacts are visible at the checkpoint but never sent.
  - **Email deduplication:** if two contacts share an email (lowercased), the second is skipped.
  - **Per-send error isolation:** each send is wrapped in `try/catch`; a 4xx for one address gets logged and recorded into `PipelineResult.errors` while the rest of the batch continues.
  - **Personalized subject + body** using `firstName`, `title`, `company`, and the seed domain. Both `htmlContent` and `textContent` (plaintext alternative) are sent.

---

## Edge case handling

The pipeline is engineered to degrade gracefully rather than crash. Specific failure modes and how each is handled:

| Failure mode                                | Behavior                                                                                                  |
|---------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| Missing/invalid CLI domain                  | Validates with regex; exits with usage message before any API call.                                       |
| Missing required env var                    | `validateConfig` fails fast at startup with a list of missing keys — no API calls happen.                 |
| Ocean.io returns zero companies             | Run aborts after Stage 1, returns a zeroed result with the error logged.                                  |
| Ocean.io transient failure (429/5xx)        | `RetryUtil` retries with exponential backoff, honoring `Retry-After` on 429.                              |
| Prospeo search fails for one company        | Per-domain `try/catch` — that company is logged + skipped; other companies continue.                      |
| Prospeo returns zero contacts               | Run aborts after Stage 2, returns partial result.                                                          |
| Contact has no LinkedIn URL                 | Marked `emailVerified: false`, kept in the list, no API call (no credit spent).                           |
| Two contacts share a LinkedIn URL           | API called once; result reused for the other(s) from cache (no extra credit).                             |
| LinkedIn-email-finder fails for one contact | Per-contact `try/catch` — contact kept with `emailVerified: false`, failure cached, loop continues.       |
| API returns email but unverified            | Counted as resolved-but-unverified; shown in red `(unverified)` at checkpoint; **not sent**.              |
| User declines at checkpoint                 | Returns without sending. Counts in result reflect what was discovered.                                     |
| `DRY_RUN=true`                              | Send stage skipped after confirmation. Everything else runs and prints normally.                           |
| Two verified contacts share an email        | One send only — Brevo dedup by lowercased email.                                                          |
| Brevo rejects a single send (400)           | Logged with the API's message; recorded to `errors`; the rest of the batch continues.                     |
| Ctrl+C / SIGTERM at any point               | `SIGINT`/`SIGTERM` handler closes the Nest context cleanly and exits with code 130.                        |
| Unhandled rejection / uncaught exception    | Top-level listeners print a clean message and exit with code 1 — no Node stack-trace dump on the user.    |

The summary at the end always reports counts for companies found, decision-makers found, **verified** emails resolved, emails sent, errors, and total duration.

---

## Configuration

Copy `.env.example` to `.env` and fill in values. `validateConfig` checks the **required** keys at startup and exits with a clear message if any are missing.

| Variable                   | Required | Default                          | Purpose                                              |
|----------------------------|:--------:|----------------------------------|------------------------------------------------------|
| `OCEAN_API_KEY`            | ✅       | —                                | Ocean.io auth (`X-Api-Token`)                        |
| `OCEAN_BASE_URL`           |          | `https://api.ocean.io`           | Ocean.io base URL                                    |
| `OCEAN_PAGE_SIZE`          |          | `50`                             | Results per Ocean page                               |
| `PROSPEO_API_KEY`          | ✅       | —                                | Prospeo auth (`X-KEY`)                               |
| `PROSPEO_BASE_URL`         |          | `https://api.prospeo.io`         | Prospeo base URL                                     |
| `PROSPEO_SENIORITY_FILTER` |          | `C_SUITE,VP`                     | Seniority levels to target in domain-search          |
| `BREVO_API_KEY`            | ✅       | —                                | Brevo auth (`api-key`)                               |
| `BREVO_BASE_URL`           |          | `https://api.brevo.com/v3`       | Brevo base URL                                       |
| `BREVO_SENDER_NAME`        |          | `Raj`                            | From-name on outreach emails                         |
| `BREVO_SENDER_EMAIL`       | ✅       | —                                | From-address on outreach emails                      |
| `MAX_COMPANIES`            |          | `10`                             | Cap on lookalike companies (Stage 1)                 |
| `MAX_CONTACTS_PER_COMPANY` |          | `3`                              | Cap on contacts per company (Stage 2)                |
| `DRY_RUN`                  |          | `true`                           | When `true`, skips the Brevo send stage              |

> Required keys: `OCEAN_API_KEY`, `PROSPEO_API_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`.

---

## Email copy

`BrevoService` composes a personalized HTML + plaintext email per contact:

- **Subject:** `Quick intro for <firstName> — <title> at <company>`
- **Body:** opens with the contact's first name, references their role and company, and ties it to the seed domain. The signature uses `BREVO_SENDER_NAME`.
- Both `htmlContent` and `textContent` are included so non-HTML clients render correctly.

Adjust `buildEmailHtml` / `buildEmailText` in [`src/stages/brevo.service.ts`](src/stages/brevo.service.ts) to tune the template.

---

## Project structure

```
src/
├── main.ts                       # CLI entry, signal handlers, top-level error guards
├── app.module.ts                 # Single NestJS module wiring everything
├── config.validation.ts          # Fail-fast required-env-var check
├── pipeline.service.ts           # Orchestrator (+ DRY_RUN gate)
├── checkpoint.service.ts         # Interactive review prompt
├── models.ts                     # Company, Contact, EmailPayload, PipelineResult
├── stages/
│   ├── ocean.service.ts          # Stage 1: lookalike companies (Ocean.io)
│   ├── prospeo.service.ts        # Stages 2 + 3: contacts + LinkedIn email finder
│   └── brevo.service.ts          # Stage 4: personalized outreach (Brevo)
└── utils/
    ├── pipeline.logger.ts        # Color-coded per-stage console logger
    └── retry.util.ts             # Exponential-backoff retry helper (wired into all stages)
.env.example                      # Template for required configuration
```

---

## Logging & retry

### `PipelineLogger`

Per-stage, color-coded `info` / `success` / `warn` / `error` levels with `divider()` and `banner()` helpers. Stages: `ocean`, `prospeo`, `brevo`, `pipeline`, `checkpoint`.

### `RetryUtil`

`withRetry(fn, context, options)` wraps every outbound HTTP call:
- Exponential backoff (`initialDelayMs * 2^(attempt-1)`, capped at `maxDelayMs`; defaults 3 attempts, 1s→10s).
- Retries on `429` / `5xx` / network errors. Does **not** retry `4xx`.
- Honors `Retry-After` on `429`.
- Each call passes a descriptive `context` (e.g. `prospeo.linkedinEmailFinder[<url>]`, `brevo.send[<email>]`) so retry logs pinpoint the failing operation.

---

## Polish & robustness checklist

| Item                                          | Status | Where                                                                                       |
|-----------------------------------------------|:------:|---------------------------------------------------------------------------------------------|
| No unhandled promise rejections               | ✅     | `process.on('unhandledRejection' / 'uncaughtException')` + `bootstrap().catch(...)` in `main.ts` |
| Graceful exit on Ctrl+C / SIGTERM             | ✅     | `SIGINT` and `SIGTERM` handlers close the Nest context and exit 130                         |
| Fail-fast on missing config                   | ✅     | `config.validation.ts`                                                                      |
| Clean terminal output end to end              | ✅     | All output via `chalk` through `PipelineLogger`; structured tables in checkpoint            |
| No debug `console.log` in prod paths          | ✅     | Only intentional user-facing output (banners, prompts, summary) uses raw `console`           |
| `.env.example` complete and accurate          | ✅     | Mirrors every variable read by `OceanService`, `ProspeoService`, `BrevoService`             |
| End-to-end run from clone to send             | ✅     | `git clone → cp .env.example .env → npm install → npm start <domain>`                       |

---

## Limitations & Roadmap

Done in recent work: ✅ live Ocean.io / Prospeo / Brevo integrations with auth + pagination, ✅ `RetryUtil` wired into every HTTP call, ✅ `ConfigService` + fail-fast validation, ✅ personalized email composition (HTML + plaintext), ✅ `DRY_RUN` safety default, ✅ per-company and total caps, ✅ credit-conscious LinkedIn email resolution (URL dedup, sequential, per-contact isolation, balance log), ✅ Brevo per-send isolation + email dedup, ✅ end-to-end gating on `email && emailVerified`, ✅ Ctrl+C and unhandled-rejection handlers.

Still outstanding, in rough priority order:

**Resilience**
- [ ] **Concurrency for Stage 2.** Companies are searched sequentially; a bounded-concurrency map would cut wall-clock time on larger `MAX_COMPANIES`. Stage 3 stays sequential by design (credit safety).

**Operations & compliance**
- [ ] **Idempotency and a suppression list.** Re-running re-sends to everyone — an operational and CAN-SPAM/GDPR concern. No persistent record of who was already contacted.
- [ ] **`--yes` / non-interactive flag** so the stdin checkpoint doesn't block CI runs.
- [ ] **Route `printSummary` and checkpoint output through `PipelineLogger`** for a single, consistent output path.

**Quality & hygiene**
- [ ] **Add tests.** Unit-test `PipelineService` against faked stage services; mock `axios` for per-stage API tests.
- [ ] **Use the `EmailPayload` type** in `BrevoService` (the payload is currently built inline; the defined interface is unused).
- [ ] **Update `package.json` description** — it still says "with Domain-Driven Design" from the previous architecture.

---

## License

Internal
