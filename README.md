# Outreach Pipeline

A small NestJS-based command-line tool that automates outbound email outreach. Given a single seed company domain, it discovers lookalike companies, finds decision-makers at those companies, resolves their work emails, pauses for human review, and sends.

> **Status:** the three vendor integrations (Ocean.io, Prospeo, Brevo) are currently **simulated** with realistic mock data and latency. The pipeline shape is real; the network calls are not yet implemented. See [Limitations & Roadmap](#limitations--roadmap).

---

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [The pipeline stages](#the-pipeline-stages)
- [Core types](#core-types)
- [Logging & retry](#logging--retry)
- [Extending the pipeline](#extending-the-pipeline)
- [Configuration](#configuration)
- [Limitations & Roadmap](#limitations--roadmap)

---

## What it does

```
seed domain ─▶ find lookalike companies ─▶ find decision-makers ─▶ resolve emails
                                                                        │
                              outreach sent ◀── send ◀── human review ◀─┘
```

Starting from one domain (e.g. `stripe.com`), the pipeline produces a list of verified outreach contacts at similar companies and — after you approve them — sends emails. A safety checkpoint sits between resolution and sending so nothing goes out without a human in the loop.

---

## Quick start

### Prerequisites

- Node.js 18+ (the project targets ES2021 / Node 20 types)
- npm

### Install

```bash
npm install
```

### Run

```bash
npm start <domain>
```

Example:

```bash
npm start stripe.com
```

The CLI validates the domain format, runs the four stages, prints a review table, and prompts before sending:

```
Send outreach to N contact(s)? [y/N]
```

Anything other than `y` aborts without sending.

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
4. Resolves `PipelineService` from the DI container and calls `run(seedDomain)`.
5. Closes the context and exits, mapping fatal errors to a non-zero exit code.

`PipelineService` ([`src/pipeline.service.ts`](src/pipeline.service.ts)) is the **orchestrator**. It calls the four stage services in order, wraps each call in `.catch()` so a failure is recorded into `PipelineResult.errors` rather than crashing the run, and pauses for human approval before the send stage.

---

## Architecture

The project uses a **flat, linear architecture** that mirrors the pipeline itself. Each pipeline stage is a NestJS service; `PipelineService` injects them by class and calls them in order. There are no port interfaces, DI tokens, or separate domain/infrastructure layers — the previous hexagonal layout was simplified once it became clear the project would never have alternative implementations of each stage.

```
                        ┌──────────────────┐
                        │   main.ts (CLI)   │
                        │ composition root  │
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
```

**Why this shape:**
- The pipeline is a fixed, linear sequence with one provider per stage. Hexagonal abstractions added folders without buying optionality.
- All services live in one `AppModule`. NestJS's DI is still doing real work — it builds the dependency graph and constructs services in the right order — but every dependency is a typed class, so the compiler verifies the wiring.
- `PipelineLogger` is a plain `@Injectable()` (not a port). It's injected wherever needed.

---

## Project structure

```
src/
├── main.ts                       # CLI entry / composition root
├── app.module.ts                 # Single NestJS module wiring everything
├── pipeline.service.ts           # Orchestrator
├── checkpoint.service.ts         # Interactive review prompt
├── models.ts                     # Company, Contact, EmailPayload, PipelineResult
├── stages/
│   ├── ocean.service.ts          # Stage 1: lookalike companies
│   ├── prospeo.service.ts        # Stages 2 + 3: contacts + emails
│   └── brevo.service.ts          # Stage 4: send outreach
└── utils/
    ├── pipeline.logger.ts        # Color-coded per-stage console logger
    └── retry.util.ts             # Exponential-backoff retry helper (currently unused)
```

---

## The pipeline stages

`PipelineService.run()` executes four stages plus a checkpoint. Each stage consumes the output of the previous one.

| # | Stage             | Service             | Method                  | Input            | Output         |
|---|-------------------|---------------------|-------------------------|------------------|----------------|
| 1 | Find lookalikes   | `OceanService`      | `findLookalikes`        | seed domain      | `Company[]`    |
| 2 | Find contacts     | `ProspeoService`    | `findDecisionMakers`    | `Company[]`      | `Contact[]`    |
| 3 | Resolve emails    | `ProspeoService`    | `resolveEmails`         | `Contact[]`      | `Contact[]`    |
| — | **Safety review** | `CheckpointService` | `confirm`               | `Contact[]`      | `boolean`      |
| 4 | Send outreach     | `BrevoService`      | `sendOutreach`          | `Contact[]`      | count sent     |

> Stages 2 and 3 are both Prospeo because the real Prospeo product covers both contact discovery and email verification. Folding them into one service keeps the pipeline honest about the vendor relationship.

### Failure behavior

- **Stage 1 (companies) empty/failed** → run aborts, returns a zeroed result.
- **Stage 2 (contacts) empty/failed** → run aborts, returns partial result.
- **Stage 3 (emails) failed** → proceeds with unresolved contacts so the checkpoint can show the gap.
- **Checkpoint declined** → returns without sending.
- All caught errors are accumulated into `PipelineResult.errors` with the originating stage.

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
}

interface Contact {
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  company: string;
  domain: string;
  linkedinUrl: string;
  email?: string;          // populated in Stage 3
  emailVerified?: boolean;
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

`Contact` is the spine of the pipeline — created in Stage 2, enriched with an email in Stage 3, and consumed in Stage 4. `EmailPayload` is also defined for the future personalized-message step but isn't used yet.

---

## Logging & retry

### `PipelineLogger`

A simple `@Injectable()` console logger that renders per-stage, color-coded output via `chalk` with `info` / `success` / `warn` / `error` levels plus `divider()` and `banner()` helpers. Stages: `ocean`, `prospeo`, `brevo`, `pipeline`, `checkpoint`.

### `RetryUtil`

`withRetry(fn, context, options)` provides:
- Exponential backoff (`initialDelayMs * 2^(attempt-1)`, capped at `maxDelayMs`).
- A retry predicate that retries on `429` and `5xx` (and network errors) but not `4xx`.
- Honors a `Retry-After` header on `429` responses.

> **Note:** `RetryUtil` is registered in `AppModule` but is **not yet injected into the stage services**. Wiring it into the (future) HTTP calls is a roadmap item.

---

## Extending the pipeline

### Replace a stage's implementation

Edit the relevant service in `src/stages/`. For example, swapping out the mock company-discovery for a real HTTP call means changing the body of `OceanService.findLookalikes` — nothing else in the pipeline touches that method.

### Add a new stage

1. Create a new service under `src/stages/` with a single public method.
2. Register it in `app.module.ts` under `providers`.
3. Inject it into `PipelineService` and add a step in `run()`.

That's it — the simpler structure means you don't need to define an interface, a token, or a separate folder.

### Run the checkpoint headlessly

`CheckpointService.confirm` could accept a `--yes` flag (or check `process.stdin.isTTY`) to auto-confirm in non-interactive runs. Today it always prompts, which will hang in CI.

---

## Configuration

`ConfigModule.forRoot({ isGlobal: true })` is loaded in `app.module.ts`, so environment-based configuration is ready to use, but no settings are consumed yet (the stage services are mocks). When real integrations are added, API keys and base URLs should be read through `ConfigService` and validated with a schema.

TypeScript build settings live in [`tsconfig.json`](tsconfig.json) (`strictNullChecks`, `noImplicitAny`, ES2021 target, CommonJS modules).

---

## Limitations & Roadmap

The architecture is right-sized for the project, but several pieces are intentionally stubbed or not yet wired. In rough priority order:

**Functionality**
- [ ] **Implement real HTTP integrations** for Ocean.io, Prospeo, and Brevo (currently mocks with simulated latency).
- [ ] **Use `EmailPayload` + a message composer** to build personalized subject/body content. Today `BrevoService` only logs that it sent.
- [ ] **Read keys/URLs from `ConfigService`** with env-schema validation (e.g. via Joi or Zod).

**Resilience**
- [ ] **Wire `RetryUtil` into stage services** so vendor flakiness doesn't fail an entire run.
- [ ] **Isolate per-contact failures** in stages 3 and 4 so one bad record doesn't fail an entire batch.

**Operations & compliance**
- [ ] **Add idempotency and a suppression list** — re-running currently re-sends to everyone, which is both an operational and a CAN-SPAM/GDPR issue.
- [ ] **Add a `--yes` / non-interactive flag** so the stdin checkpoint doesn't block CI runs.
- [ ] **Route `printSummary` and the checkpoint output through `PipelineLogger`** for a single, consistent output path.

**Quality**
- [ ] **Add tests.** With direct class injection, unit-testing `PipelineService` against three fake stage services is now straightforward.
- [ ] **Clean stale `dist/` artifacts** from the previous layout (`rm -rf dist && npm run build`).
- [ ] **Update `package.json` description** — it still says "with Domain-Driven Design" from the previous architecture.

---

## License

Internal
