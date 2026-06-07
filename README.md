# Outreach Pipeline

A small NestJS-based command-line tool that automates outbound email outreach. Given a single seed company domain, it discovers lookalike companies via Ocean.io, finds decision-makers and resolves their verified work emails via Prospeo, pauses for human review, and sends personalized outreach via Brevo.

> **Status:** the three vendor integrations are now **live** — real HTTP calls to Ocean.io, Prospeo, and Brevo with auth, pagination, retry/backoff, and config validation. A `DRY_RUN` flag (default **on**) lets you run the full pipeline without actually sending email. See [Configuration](#configuration).

---

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [The pipeline stages](#the-pipeline-stages)
- [Core types](#core-types)
- [Configuration](#configuration)
- [Logging & retry](#logging--retry)
- [Email copy](#email-copy)
- [Extending the pipeline](#extending-the-pipeline)
- [Limitations & Roadmap](#limitations--roadmap)

---

## What it does

```
seed domain ─▶ find lookalike companies ─▶ find decision-makers ─▶ resolve emails
   (Ocean.io)                              (Prospeo search)        (Prospeo enrich)
                                                                        │
                              outreach sent ◀── send ◀── human review ◀─┘
                                 (Brevo)                  (checkpoint)
```

Starting from one domain (e.g. `stripe.com`), the pipeline produces a list of verified outreach contacts at similar companies and — after you approve them — sends emails. A safety checkpoint sits between resolution and sending so nothing goes out without a human in the loop, and `DRY_RUN` skips the send entirely until you're ready.

---

## Quick start

### Prerequisites

- Node.js 18+ (the project targets ES2021 / Node 20 types)
- npm
- API keys for Ocean.io, Prospeo, and Brevo

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
# then fill in your API keys
```

The pipeline fails fast at startup if any required key is missing (see [Configuration](#configuration)).

### Run

```bash
npm start <domain>
```

Example:

```bash
npm start stripe.com
```

The CLI validates the domain format, validates env config, runs the four stages, prints a review table, and prompts before sending:

```
Send outreach to N contact(s)? [y/N]
```

Anything other than `y` aborts without sending. With `DRY_RUN=true` (the default), the send stage is skipped even after you confirm.

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

## How it works

The entry point is [`src/main.ts`](src/main.ts). It is a thin **composition root**:

1. Reads the seed domain from `process.argv`.
2. Validates the argument looks like a domain.
3. Boots a NestJS **application context** (no HTTP server — this is a CLI) via `NestFactory.createApplicationContext`.
4. **Validates required environment variables** through `validateConfig` — fails fast before any API call if keys are missing.
5. Resolves `PipelineService` from the DI container and calls `run(seedDomain)`.
6. Closes the context and exits, mapping fatal errors to a non-zero exit code.

`PipelineService` ([`src/pipeline.service.ts`](src/pipeline.service.ts)) is the **orchestrator**. It calls the four stage services in order, wraps each call in `.catch()` so a failure is recorded into `PipelineResult.errors` rather than crashing the run, pauses for human approval before the send stage, and honors `DRY_RUN`.

---

## Architecture

The project uses a **flat, linear architecture** that mirrors the pipeline itself. Each pipeline stage is a NestJS service; `PipelineService` injects them by class and calls them in order. There are no port interfaces, DI tokens, or separate domain/infrastructure layers.

```
                        ┌──────────────────┐
                        │   main.ts (CLI)   │
                        │ composition root  │
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

**Why this shape:**
- The pipeline is a fixed, linear sequence with one provider per stage.
- All services live in one `AppModule`. Every dependency is a typed class, so the compiler verifies the wiring.
- Each stage service reads its own config in the constructor (`getOrThrow` for required keys, `get` with defaults for optional ones) and shares `RetryUtil` and `PipelineLogger`.

---

## Project structure

```
src/
├── main.ts                       # CLI entry / composition root + config validation
├── app.module.ts                 # Single NestJS module wiring everything
├── config.validation.ts          # Fail-fast required-env-var check
├── pipeline.service.ts           # Orchestrator (+ DRY_RUN gate)
├── checkpoint.service.ts         # Interactive review prompt
├── models.ts                     # Company, Contact, EmailPayload, PipelineResult
├── stages/
│   ├── ocean.service.ts          # Stage 1: lookalike companies (Ocean.io)
│   ├── prospeo.service.ts        # Stages 2 + 3: contacts + email enrichment (Prospeo)
│   └── brevo.service.ts          # Stage 4: send outreach (Brevo)
└── utils/
    ├── pipeline.logger.ts        # Color-coded per-stage console logger
    └── retry.util.ts             # Exponential-backoff retry helper (wired into all stages)
.env.example                      # Template for required configuration
```

---

## The pipeline stages

`PipelineService.run()` executes four stages plus a checkpoint. Each stage consumes the output of the previous one.

| # | Stage             | Service / API                        | Input            | Output         |
|---|-------------------|--------------------------------------|------------------|----------------|
| 1 | Find lookalikes   | `OceanService` → `POST /v3/search/companies` | seed domain | `Company[]`    |
| 2 | Find contacts     | `ProspeoService` → `POST /search-person`     | `Company[]` | `Contact[]`    |
| 3 | Resolve emails    | `ProspeoService` → `POST /bulk-enrich-person`| `Contact[]` | `Contact[]`    |
| — | **Safety review** | `CheckpointService` (stdin prompt)   | `Contact[]`      | `boolean`      |
| 4 | Send outreach     | `BrevoService` → `POST /smtp/email`  | `Contact[]`      | count sent     |

### Stage details

- **Stage 1 — Ocean.io.** Cursor-based pagination via `searchAfter`, `OCEAN_PAGE_SIZE` results per page. Stops when the cursor runs out **or** `MAX_COMPANIES` is reached, then trims to the exact cap. Auth via `X-Api-Token`.
- **Stage 2 — Prospeo search.** Iterates each company domain with page-based pagination, filtering by a configurable `PROSPEO_SENIORITY_FILTER` (defaults to C-suite + VP titles). Caps results to `MAX_CONTACTS_PER_COMPANY` per company. Auth via `X-KEY`.
- **Stage 3 — Prospeo enrich.** Bulk-enriches contacts in chunks of 50 (`bulk-enrich-person`), requesting verified emails only (`only_verified_email: true`). Contacts without a resolvable email are kept (so the checkpoint can show the gap) but left without an `email`.
- **Stage 4 — Brevo.** Sends one personalized transactional email per contact with a verified address, throttled to ~2 RPS (500ms between sends) to respect rate limits. Auth via `api-key`. Skipped entirely when `DRY_RUN=true`.

### Failure behavior

- **Stage 1 (companies) empty/failed** → run aborts, returns a zeroed result.
- **Stage 2 (contacts) empty/failed** → run aborts, returns partial result.
- **Stage 3 (emails) failed** → proceeds with unresolved contacts so the checkpoint can show the gap.
- **Checkpoint declined** → returns without sending.
- **`DRY_RUN=true`** → send stage skipped; everything up to and including the checkpoint still runs.
- Transient HTTP failures (429 / 5xx / network) are retried with backoff before a stage is considered failed. All caught errors are accumulated into `PipelineResult.errors` with the originating stage.

At the end, a summary prints counts for companies found, contacts found, emails resolved, emails sent, errors, and total duration.

---

## Core types

Defined in [`src/models.ts`](src/models.ts):

```ts
interface Company {
  domain: string;
  name?: string;
  industry?: string;
  employeeCount?: string;
  location?: string;
  oceanId?: string;        // Ocean.io internal ID
  description?: string;    // company description from Ocean
}

interface Contact {
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  company: string;
  domain: string;
  linkedinUrl: string;
  email?: string;            // populated in Stage 3
  emailVerified?: boolean;
  prospeoPersonId?: string;  // used to enrich in Stage 3
  mobile?: string;           // optional, from enrichment
}

interface PipelineResult {
  seedDomain: string;
  companiesFound: number;
  contactsFound: number;
  emailsResolved: number;
  emailsSent: number;
  errors: PipelineError[];
  durationMs: number;
}
```

`Contact` is the spine of the pipeline — created in Stage 2 (carrying `prospeoPersonId`), enriched with a verified `email` in Stage 3, and consumed in Stage 4.

---

## Configuration

Copy `.env.example` to `.env` and fill in values. `validateConfig` ([`src/config.validation.ts`](src/config.validation.ts)) checks the **required** keys at startup and exits with a clear message if any are missing.

| Variable                   | Required | Default                          | Purpose                                              |
|----------------------------|:--------:|----------------------------------|------------------------------------------------------|
| `OCEAN_API_KEY`            | ✅       | —                                | Ocean.io auth (`X-Api-Token`)                        |
| `OCEAN_BASE_URL`           |          | `https://api.ocean.io`           | Ocean.io base URL                                    |
| `OCEAN_PAGE_SIZE`          |          | `50`                             | Results per Ocean page                               |
| `PROSPEO_API_KEY`          | ✅       | —                                | Prospeo auth (`X-KEY`)                               |
| `PROSPEO_BASE_URL`         |          | `https://api.prospeo.io`         | Prospeo base URL                                     |
| `PROSPEO_SENIORITY_FILTER` |          | `CEO,CTO,COO,CFO,VP …`           | Comma-separated seniority titles to target           |
| `BREVO_API_KEY`            | ✅       | —                                | Brevo auth (`api-key`)                               |
| `BREVO_BASE_URL`           |          | `https://api.brevo.com/v3`       | Brevo base URL                                       |
| `BREVO_SENDER_NAME`        |          | `Raj`                            | From-name on outreach emails                         |
| `BREVO_SENDER_EMAIL`       | ✅       | —                                | From-address on outreach emails                      |
| `MAX_COMPANIES`            |          | `10`                             | Cap on lookalike companies (Stage 1)                 |
| `MAX_CONTACTS_PER_COMPANY` |          | `3`                              | Cap on contacts per company (Stage 2)                |
| `DRY_RUN`                  |          | `true`                           | When `true`, skips the Brevo send stage              |

> Required keys: `OCEAN_API_KEY`, `PROSPEO_API_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`.

TypeScript build settings live in [`tsconfig.json`](tsconfig.json) (`strictNullChecks`, `noImplicitAny`, ES2021 target, CommonJS modules).

---

## Logging & retry

### `PipelineLogger`

A simple `@Injectable()` console logger that renders per-stage, color-coded output via `chalk` with `info` / `success` / `warn` / `error` levels plus `divider()` and `banner()` helpers. Stages: `ocean`, `prospeo`, `brevo`, `pipeline`, `checkpoint`.

### `RetryUtil`

`withRetry(fn, context, options)` wraps every outbound HTTP call in all three stage services. It provides:
- Exponential backoff (`initialDelayMs * 2^(attempt-1)`, capped at `maxDelayMs`; defaults 3 attempts, 1s→10s).
- A retry predicate that retries on `429` and `5xx` (and network errors) but not `4xx`.
- Honors a `Retry-After` header on `429` responses.

Each call passes a descriptive `context` string (e.g. `prospeo.bulkEnrich[batch2]`, `brevo.send[<email>]`) so retry logs pinpoint the failing operation.

---

## Email copy

`BrevoService.buildEmailHtml` composes a short, personalized HTML email per contact using the data gathered upstream — first name, title, and company — referencing the seed domain. The subject is `Quick intro — <seedDomain>` and the signature uses `BREVO_SENDER_NAME`. Adjust the template in [`src/stages/brevo.service.ts`](src/stages/brevo.service.ts) to tune tone and content.

---

## Extending the pipeline

### Replace a stage's implementation

Edit the relevant service in `src/stages/`. Each stage owns its own API client, config, and pagination, so changes stay localized to one file.

### Add a new stage

1. Create a new service under `src/stages/` with a single public method.
2. Register it in `app.module.ts` under `providers`.
3. Inject it into `PipelineService` and add a step in `run()`.

### Run the checkpoint headlessly

`CheckpointService.confirm` could accept a `--yes` flag (or check `process.stdin.isTTY`) to auto-confirm in non-interactive runs. Today it always prompts, which will hang in CI.

---

## Limitations & Roadmap

Done in recent work: ✅ live Ocean.io / Prospeo / Brevo integrations with auth + pagination, ✅ `RetryUtil` wired into every HTTP call, ✅ `ConfigService` + fail-fast validation, ✅ personalized email composition, ✅ `DRY_RUN` safety default, ✅ per-company and total caps.

Still outstanding, in rough priority order:

**Resilience**
- [ ] **Per-contact failure isolation in Stage 3/4.** A thrown error on a bulk-enrich chunk or a single send still fails that chunk/loop; individual bad records could be caught and skipped instead of bubbling up.
- [ ] **Concurrency for Stage 2.** Companies are searched sequentially; a bounded-concurrency map would cut wall-clock time on larger `MAX_COMPANIES`.

**Operations & compliance**
- [ ] **Idempotency and a suppression list.** Re-running re-sends to everyone — an operational and CAN-SPAM/GDPR concern. No record of who was already contacted.
- [ ] **`--yes` / non-interactive flag** so the stdin checkpoint doesn't block CI runs.
- [ ] **Route `printSummary` and checkpoint output through `PipelineLogger`** for a single, consistent output path.

**Quality & hygiene**
- [ ] **Add tests.** Unit-test `PipelineService` against faked stage services; mock `axios` for per-stage API tests.
- [ ] **Use the `EmailPayload` type** in `BrevoService` (the payload is currently built inline; the defined interface is unused).
- [ ] **Update `package.json` description** — it still says "with Domain-Driven Design" from the previous architecture.
- [ ] **Clean stale `dist/` artifacts** from the previous layout (`rm -rf dist && npm run build`).

---

## License

Internal
