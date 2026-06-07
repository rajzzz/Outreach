# VocalLabs Outreach Pipeline

A command-line outreach automation pipeline built with **NestJS** and a **hexagonal (ports-and-adapters)** architecture. Given a single seed company domain, it discovers lookalike companies, finds decision-makers at those companies, resolves their work emails, pauses for human review, and sends outreach.

> **Status:** The four vendor integrations (Ocean.io, Prospeo, Eazyreach, Brevo) are currently **simulated** with realistic mock data and latency. The architecture is production-shaped; the network calls are not yet implemented. See [Limitations & Roadmap](#limitations--roadmap).

---

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [The pipeline stages](#the-pipeline-stages)
- [Core domain model](#core-domain-model)
- [Cross-cutting concerns](#cross-cutting-concerns)
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

Answering anything other than `y` aborts without sending.

### Other scripts

| Script              | Purpose                                            |
|---------------------|----------------------------------------------------|
| `npm start`         | Run the pipeline via `ts-node`                     |
| `npm run start:dev` | Run in watch mode (`nest start --watch`)           |
| `npm run build`     | Compile TypeScript to `dist/` (`nest build`)       |
| `npm run start:prod`| Run the compiled output (`node dist/main`)         |
| `npm run lint`      | ESLint with `--fix`                                |
| `npm run format`    | Prettier formatting                                |

---

## How it works

The entry point is [`src/main.ts`](src/main.ts). It is a thin **composition root**:

1. Reads the seed domain from `process.argv`.
2. Validates the argument looks like a domain.
3. Boots a NestJS **application context** (no HTTP server — this is a CLI) via `NestFactory.createApplicationContext`.
4. Resolves `OutreachPipelineService` from the DI container and calls `run(seedDomain)`.
5. Closes the context and exits, mapping fatal errors to a non-zero exit code.

`OutreachPipelineService` ([`application/outreach-pipeline.service.ts`](src/outreach/application/outreach-pipeline.service.ts)) is the **orchestrator**. It depends only on **port interfaces**, never on concrete adapters. Each stage is wrapped so a failure is recorded into the result and the run degrades gracefully instead of crashing.

---

## Architecture

The project follows **hexagonal architecture** (ports and adapters) with DDD-style layering. The dependency rule points inward: infrastructure depends on the domain, never the reverse.

```
┌──────────────────────────────────────────────────────────────┐
│                        main.ts (CLI)                           │
│                     composition root                           │
└───────────────────────────────┬────────────────────────────────┘
                                 │ resolves
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│  APPLICATION                                                   │
│  OutreachPipelineService  ── orchestrates the stages           │
│     depends on ▼ (port interfaces only)                        │
└───────────────────────────────┬────────────────────────────────┘
                                 │
┌────────────────────────────────────────────────────────────────┐
│  DOMAIN (the hexagon's core — no framework, no vendors)          │
│                                                                  │
│  Models:  Company · Contact · EmailPayload · PipelineResult      │
│                                                                  │
│  Ports (interfaces):                                             │
│    CompanyDirectory   findLookalikes(domain)   → Company[]       │
│    ContactFinder      findDecisionMakers(cos)  → Contact[]       │
│    EmailResolver      resolveEmails(contacts)  → Contact[]       │
│    OutreachSender     sendOutreach(contacts)   → number          │
│    Checkpoint         confirm(contacts)        → boolean         │
└───────────────────────────────┬────────────────────────────────┘
                                 │ implemented by ▲
┌────────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE (adapters — the swappable outer ring)            │
│    OceanAdapter            → CompanyDirectory                    │
│    ProspeoAdapter          → ContactFinder                       │
│    EazyreachAdapter        → EmailResolver                       │
│    BrevoAdapter            → OutreachSender                       │
│    ConsoleCheckpointAdapter→ Checkpoint                          │
└──────────────────────────────────────────────────────────────────┘
```

### Why ports and adapters

Each port is a TypeScript `interface` bound to a concrete class through a **`Symbol` DI token** (see [`tokens.ts`](src/outreach/tokens.ts)). Because TypeScript interfaces don't exist at runtime, NestJS can't inject them by type — the Symbol tokens are how the wiring is declared in [`outreach.module.ts`](src/outreach/outreach.module.ts):

```ts
{ provide: COMPANY_DIRECTORY_PORT, useClass: OceanAdapter }
```

To swap Ocean.io for another provider you change one line in the module — the orchestrator and domain are untouched.

---

## Project structure

```
src/
├── main.ts                                  # CLI entry / composition root
├── outreach/
│   ├── outreach.module.ts                   # DI wiring (ports → adapters)
│   ├── tokens.ts                            # Symbol DI tokens for ports
│   ├── application/
│   │   └── outreach-pipeline.service.ts     # Orchestrator
│   ├── domain/
│   │   ├── models/
│   │   │   └── outreach.models.ts           # Company, Contact, EmailPayload, PipelineResult
│   │   └── ports/
│   │       ├── company-directory.port.ts
│   │       ├── contact-finder.port.ts
│   │       ├── email-resolver.port.ts
│   │       ├── outreach-sender.port.ts
│   │       └── checkpoint.port.ts
│   └── infrastructure/
│       └── adapters/
│           ├── ocean.adapter.ts             # CompanyDirectory impl (mock)
│           ├── prospeo.adapter.ts           # ContactFinder impl (mock)
│           ├── eazyreach.adapter.ts         # EmailResolver impl (mock)
│           ├── brevo.adapter.ts             # OutreachSender impl (mock)
│           └── console-checkpoint.adapter.ts# Checkpoint impl (stdin prompt)
└── shared/
    ├── logger/
    │   ├── logger.port.ts                   # LoggerPort interface + token
    │   ├── logger.module.ts                 # @Global() logger module
    │   └── pipeline-logger.adapter.ts       # chalk-based console logger
    └── retry/
        └── retry.util.ts                    # exponential-backoff retry helper
```

---

## The pipeline stages

`OutreachPipelineService.run()` executes four stages plus a checkpoint. Each stage consumes the output of the previous one.

| # | Stage             | Port               | Adapter                | Input            | Output         |
|---|-------------------|--------------------|------------------------|------------------|----------------|
| 1 | Find lookalikes   | `CompanyDirectory` | `OceanAdapter`         | seed domain      | `Company[]`    |
| 2 | Find contacts     | `ContactFinder`    | `ProspeoAdapter`       | `Company[]`      | `Contact[]`    |
| 3 | Resolve emails    | `EmailResolver`    | `EazyreachAdapter`     | `Contact[]`      | `Contact[]`    |
| — | **Safety review** | `Checkpoint`       | `ConsoleCheckpointAdapter` | `Contact[]`  | `boolean`      |
| 4 | Send outreach     | `OutreachSender`   | `BrevoAdapter`         | `Contact[]`      | count sent     |

### Failure behavior

- **Stage 1 (companies) empty/failed** → run aborts, returns a zeroed result.
- **Stage 2 (contacts) empty/failed** → run aborts, returns partial result.
- **Stage 3 (emails) failed** → proceeds with unresolved contacts so the checkpoint can show the gap.
- **Checkpoint declined** → returns without sending.
- All caught errors are accumulated in `PipelineResult.errors` with the originating stage.

At the end, a summary prints counts for companies found, contacts found, emails resolved, emails sent, errors, and total duration.

---

## Core domain model

Defined in [`outreach.models.ts`](src/outreach/domain/models/outreach.models.ts):

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

`Contact` is the spine of the pipeline — it's created in Stage 2, enriched with an email in Stage 3, and consumed in Stage 4.

---

## Cross-cutting concerns

### Logging

`LoggerModule` is `@Global()`, so the `LoggerPort` is injectable everywhere without re-importing. `PipelineLoggerAdapter` renders per-stage, color-coded console output via `chalk` with `info` / `success` / `warn` / `error` levels plus `divider()` and `banner()` helpers.

### Retry

`RetryUtil` provides `withRetry(fn, context, options)` with:
- Exponential backoff (`initialDelayMs * 2^(attempt-1)`, capped at `maxDelayMs`).
- A retry predicate that retries on `429` and `5xx` (and network errors) but not `4xx`.
- Honors a `Retry-After` header on `429` responses.

> **Note:** `RetryUtil` is registered in the module but is **not yet injected into the adapters**. Wiring it into the (future) HTTP calls is a roadmap item.

---

## Extending the pipeline

### Swap a provider

1. Implement the relevant port, e.g. a new `CompanyDirectory`:

   ```ts
   @Injectable()
   export class ClearbitAdapter implements CompanyDirectory {
     async findLookalikes(seedDomain: string): Promise<Company[]> { /* ... */ }
   }
   ```

2. Change the binding in `outreach.module.ts`:

   ```ts
   { provide: COMPANY_DIRECTORY_PORT, useClass: ClearbitAdapter }
   ```

Nothing in the domain or application layer changes.

### Add a new stage

1. Define a port interface under `domain/ports/`.
2. Add a `Symbol` token in `tokens.ts`.
3. Implement an adapter under `infrastructure/adapters/`.
4. Register it in `outreach.module.ts` and inject it into the orchestrator.

### Run the checkpoint headlessly

Provide an alternative `Checkpoint` implementation (e.g. one that auto-confirms or reads a flag) and bind it to `CHECKPOINT_PORT`.

---

## Configuration

`ConfigModule.forRoot({ isGlobal: true })` is loaded in `outreach.module.ts`, so environment-based configuration is ready to use, but no settings are consumed yet (the adapters are mocks). When real integrations are added, API keys and base URLs should be read through `ConfigService` and validated with a schema.

TypeScript build settings live in [`tsconfig.json`](tsconfig.json) (`strictNullChecks`, `noImplicitAny`, ES2021 target, CommonJS modules).

---

## Limitations & Roadmap

The architecture is production-shaped, but several pieces are intentionally stubbed or not yet wired. In rough priority order:

**Correctness / coupling**
- [ ] **Decouple the application layer from vendor names.** Rename injected dependencies and `PipelineError.stage` / `LogStage` from vendor names (`ocean`, `prospeo`…) to role-based names (`companyDirectory`, `contactFinder`…). Today the core knows who fulfills each port, which defeats the abstraction.

**Resilience**
- [ ] **Wire `RetryUtil` into adapters** (or wrap calls in a resilience decorator so adapters stay clean).
- [ ] **Isolate per-contact failures** and add a concurrency limiter so one bad record doesn't fail an entire batch.

**Functionality**
- [ ] **Implement real HTTP integrations** for Ocean.io, Prospeo, Eazyreach, and Brevo.
- [ ] **Use `EmailPayload` + a `MessageComposer` port** to actually build personalized subject/body content (currently unused; `BrevoAdapter` only logs).
- [ ] **Read keys/URLs from `ConfigService`** with env-schema validation.

**Operations & compliance**
- [ ] **Add a persistence/audit layer** (`AuditLog` + `SuppressionList` ports) for idempotency and opt-out handling — re-running currently re-sends to everyone.
- [ ] **Add a `--yes` / non-interactive flag** so the stdin checkpoint doesn't block CI.

**Quality**
- [ ] **Add tests** — contract tests per port and property-based tests on pipeline invariants (e.g. "no email is ever sent to a contact without a verified address", "emailsSent ≤ emailsResolved").
- [ ] **Use the `LoggerPort` consistently** — the summary printout and checkpoint currently use raw `console.log`.

---

## License

Internal — VocalLabs.
