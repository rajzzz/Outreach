# Outreach Pipeline

**One domain in, personalized outreach out.** A NestJS CLI tool that takes a seed domain, finds lookalike companies via Ocean.io, identifies decision-makers via Prospeo, resolves verified work emails, pauses for human review, and sends personalized outreach via Brevo — all in one command.

> `DRY_RUN=true` (default) exercises the full pipeline without sending email.

---

## Prerequisites

- **Node.js 18+** (tested on 20/22)
- **npm**
- API keys for **Ocean.io**, **Prospeo**, and **Brevo** (+ a verified Brevo sender email)

---

## Setup

```bash
git clone <repo-url> outreach && cd outreach
cp .env.example .env        # fill in API keys
npm install
npm start stripe.com        # run it
```

Fails fast at startup if any required key is missing.

---

## Usage

```bash
npm start <domain>
```

The CLI validates the domain format, checks env vars, runs four stages sequentially, prints a review table with contacts/emails/LinkedIn URLs, and prompts:

```
Send outreach to N contact(s)? [y/N]
```

Press **Ctrl+C** at any time for a clean shutdown.

---

## Architecture Overview

```
seed domain
    │
    ▼
┌─────────────────────┐
│  Stage 1: Ocean.io  │  POST /v3/search/companies (lookalike search)
│  → Company[]        │  Cursor-paginated, capped at MAX_COMPANIES
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Stage 2: Prospeo   │  POST /search-person (filter by company domain + seniority)
│  → Contact[]        │  Per-domain isolation, capped at MAX_CONTACTS_PER_COMPANY
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Stage 3: Prospeo   │  POST /enrich-person (person_id or linkedin_url → verified email)
│  → Contact[] + email│  Sequential, deduplicated, credit-conscious
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Safety Checkpoint  │  Interactive table review + y/N prompt
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Stage 4: Brevo     │  POST /smtp/email (personalized HTML + plaintext)
│  → emails sent      │  Verified-only, deduplicated, throttled ~2 RPS
└─────────────────────┘
```

**Internal structure:**

```
src/
├── main.ts                 CLI entry, signal handlers, top-level error guards
├── app.module.ts           NestJS module wiring
├── config.validation.ts    Fail-fast env var check
├── pipeline.service.ts     Orchestrator (stages in sequence + DRY_RUN gate)
├── checkpoint.service.ts   Interactive review table + stdin prompt
├── models.ts               Company, Contact, PipelineResult types
├── stages/
│   ├── ocean.service.ts    Stage 1: lookalike companies
│   ├── prospeo.service.ts  Stages 2+3: contacts + email enrichment
│   └── brevo.service.ts    Stage 4: send outreach
└── utils/
    ├── pipeline.logger.ts  Color-coded per-stage console output
    └── retry.util.ts       Exponential backoff (429/5xx), Retry-After aware
```

---

## Edge Case Handling

| Failure mode | Behavior |
|---|---|
| Invalid/missing CLI domain | Regex validation → usage message, exits before any API call |
| Missing env var | Fail-fast at startup with list of missing keys |
| Ocean.io returns 0 companies | Aborts after Stage 1 with zeroed result |
| Transient API failure (429/5xx) | Retries with exponential backoff, honors `Retry-After` |
| Prospeo search fails for one domain | Logged + skipped, other domains continue |
| Prospeo returns 0 contacts total | Aborts after Stage 2 with partial result |
| Contact has no person_id or LinkedIn URL | Marked unverified, kept in list, no credit spent |
| Enrich returns NO_MATCH | Contact kept with `emailVerified: false`, loop continues |
| Email found but unverified | Shown in red at checkpoint, **never sent** |
| User declines at checkpoint | No emails sent, result shows what was discovered |
| `DRY_RUN=true` | Send stage skipped entirely |
| Duplicate emails across contacts | Deduplicated — one send per unique email |
| Brevo rejects a single send | Logged, added to errors array, other sends continue |
| Ctrl+C / SIGTERM | Nest context closed cleanly, exits 130 |
| Unhandled rejection / uncaught exception | Clean one-line message, exits 1 (no stack trace dump) |

---

## Configuration

| Variable | Required | Default | Purpose |
|---|:---:|---|---|
| `OCEAN_API_KEY` | ✅ | — | Ocean.io auth |
| `OCEAN_BASE_URL` | | `https://api.ocean.io` | Ocean.io base URL |
| `OCEAN_PAGE_SIZE` | | `50` | Results per Ocean page |
| `PROSPEO_API_KEY` | ✅ | — | Prospeo auth |
| `PROSPEO_BASE_URL` | | `https://api.prospeo.io` | Prospeo base URL |
| `PROSPEO_SENIORITY_FILTER` | | `C-Suite,Vice President,Founder/Owner` | Seniority levels to target |
| `BREVO_API_KEY` | ✅ | — | Brevo auth |
| `BREVO_BASE_URL` | | `https://api.brevo.com/v3` | Brevo base URL |
| `BREVO_SENDER_NAME` | | `Raj` | From-name on outreach |
| `BREVO_SENDER_EMAIL` | ✅ | — | From-address (must be verified in Brevo) |
| `MAX_COMPANIES` | | `10` | Cap on lookalike companies |
| `MAX_CONTACTS_PER_COMPANY` | | `3` | Cap on contacts per company |
| `DRY_RUN` | | `true` | Skip Brevo send stage when true |

---

## License

Internal
