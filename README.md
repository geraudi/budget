# Budget App

Local-first personal budget app for French bank statements. Import a CSV
export, search and edit operations, manage recurring charges, track savings
goals and chat with an offline financial coach. Everything stays in a local
SQLite database.

Stack: **TanStack Start (Vite) + React 19 + SQLite** (`better-sqlite3` +
Drizzle ORM), with **Ollama** for the coach.

> **Personal project — not production-ready.** This is a learning project to
> explore CQRS, event-store architecture and AI agent integration. It is not
> intended to be deployed as a production budgeting or financial application.

## Features

- **Opérations** — CSV import (ISO-8859-1, `;`-separated), deduplication by
  fingerprint, search/filter/sort, inline edit, pointage, event history, delete,
  CSV export.
- **Opérations récurrentes** — detected from match patterns, with manual
  schedule management and monthly projection.
- **Dashboard** — period selector, reliable indicators, category and monthly
  breakdowns, top expenses.
- **Objectifs** — event-sourced savings goals, contributions and progress.
- **Coach financier** — Ollama-backed chat built from verified aggregates and a
  local financial knowledge base. The transcript stays in the browser.
- **Anonymisation** — shareable database copy with merchant labels, references
  and amounts obfuscated.

## Getting started

Requirements: Node.js and **pnpm** (the repo is a pnpm workspace).

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

The app runs on <http://localhost:3000>. The database defaults to
`.db/budget.dev.db` (gitignored). It is built from a bank CSV export by
`../make_db.py`, or populated through the import screen.

Environment variables (see `.env`):

| Variable | Default | Role |
| --- | --- | --- |
| `DATABASE_URL` | `.db/budget.dev.db` | SQLite database file |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server for the coach |
| `EMBEDDING_MODEL` | `bge-m3` | Model used by `pnpm knowledge:embed` |

> **Production data:** never read from or write to `.db/budget.prod.db` during
> development. Event-store and backup scripts refuse this file unless
> `--allow-prod` (or `ALLOW_PROD=1`) is passed explicitly.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Dev server on port 3000 (regenerates routes) |
| `pnpm build` / `pnpm preview` | Production build / preview |
| `pnpm generate-routes` | Regenerate `src/routeTree.gen.ts` |
| `pnpm db:generate` | Generate a Drizzle migration |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:backup` | `VACUUM INTO .db/backups/` |
| `pnpm events:backfill` | Existing operations → `OperationImported` events |
| `pnpm events:verify` | Replay on a copy and diff the projection |
| `pnpm events:rebuild` | Backup, then rebuild projections from events |
| `pnpm classification:backfill` | Re-derive `kind` / `nature` from rules |
| `pnpm seed-categories` | Seed categories and classification rules |
| `pnpm seed-recurring` | Seed recurring operations |
| `pnpm anonymize-db` | Write an anonymised copy of the database |
| `pnpm test:unit` | Vitest unit and integration tests |
| `pnpm test:coach` | Offline coach scenarios + privacy audit |
| `pnpm knowledge:eval` | Recall@1/3/5 of the knowledge retrieval |
| `pnpm knowledge:embed` | Compute knowledge-card embeddings |
| `pnpm test:e2e` | Playwright end-to-end tests |

## Architecture

The operations domain is event-sourced and read through inline projections:

- `src/domain/operations/` — pure aggregate (`evolve`, `decide*`) and event types.
- `src/domain/goals/` — goal aggregate, money helpers and recommendation payload.
- `src/domain/analytics/` — indicators, transfers and data-quality rules.
- `src/domain/knowledge/` — knowledge parsing, BM25, embeddings and eval set.
- `src/infrastructure/events/` — append-only event store with optimistic concurrency.
- `src/infrastructure/projections/` — synchronous projectors updating the
  `operations` and `financial_goals` projections in the same transaction.
- `src/application/commands/` — write side (import, update, pointage, delete,
  goals, recommendations).
- `src/application/queries/` — read side (operations, categories, history,
  coach context, goals).
- `src/server/` — `createServerFn` transport only.
- `src/routes/` — file-based routes: Opérations, Opérations récurrentes,
  Dashboard.
- `src/db/` — Drizzle schema and connection helpers.

The `operations` table is a projection. Never write to it directly outside the
projector, `refreshRecurringFlags`, `refreshClassifications`, and the
rebuild/backfill scripts. `kind` / `nature` are derived from
`category_classification_rules` by the projector; only an `OperationClassified`
event (manual override) pins them. Categories, sub-categories, classification
rules, recurring rules and recurring patterns remain reference data (not
event-sourced).

### Event-store commands

```bash
pnpm db:migrate              # apply pending migrations
pnpm db:backup               # VACUUM INTO .db/backups/
pnpm events:backfill         # existing operations → OperationImported events
pnpm events:verify           # replay on a copy and diff the projection
pnpm events:rebuild          # backup, then rebuild the projection from events
pnpm classification:backfill # derive kind/nature from rules (manual overrides kept)
```

Stop the dev server before running backfill or rebuild.

### Objectifs & recommandations

Goals are event-sourced on `goal:<id>` streams and projected into
`financial_goals`. Saved recommendations are appended to the immutable
`coach_recommendations` journal (never updated or deleted). The coach prompt is
rebuilt on every request from the verified indicators and the user's goals, and
the journal payload is built server-side (`buildRecommendationPayload`), never
from the model output.

The chat transcript stays local: `localStorage` under
`budget-coach:<periodKey>`, one thread per displayed period. There is no
server-side conversation memory.

Data minimisation: the model receives aggregates plus user-entered goal
labels. Merchant labels, operation references, operation ids and `topExpenses`
are never sent to the model nor written to the journal.

### Knowledge base (coach)

The coach's knowledge cards live in `src/content/knowledge/` (Markdown with
front-matter: source, date, tags, and mandatory `limitations`). Retrieval is
lexical (BM25 over title/tags/body) by default and needs no model.

```bash
pnpm knowledge:eval                 # recall@1/3/5 of the lexical retrieval
pnpm knowledge:embed                # compute card vectors (Ollama, bge-m3)
pnpm knowledge:eval --compare       # lexical vs embeddings vs hybrid
```

`src/content/knowledge/embeddings.json` is a generated artifact and is
gitignored: rebuild it with `pnpm knowledge:embed` after changing a card.
See [docs/evaluation-rag.md](docs/evaluation-rag.md) for the evaluation protocol.

## Tests

```bash
pnpm test:unit          # Vitest: 20 files / 203 tests
pnpm test:coach         # offline coach scenarios + privacy audit (no Ollama, no DB file)
pnpm test:coach -- --live  # optional manual inspection with Ollama (qwen3:14b)
pnpm test:e2e           # Playwright
```

Coverage includes the aggregates, event store, projectors, sample imports,
analytics, goals, coach scenarios and knowledge retrieval. The anonymised
fixtures in `samples/` are imported by the Vitest integration tests
(ISO-8859-1, `;`-separated).

## Anonymising the database

`scripts/anonymize-db.mjs` writes an anonymised copy of the SQLite database,
suitable for demos, screenshots or issue reports. The source database is never
modified unless `--in-place` is passed.

```bash
pnpm anonymize-db [options] [source] [destination]
```

Defaults: `$DATABASE_URL` (or `.db/budget.dev.db`) as source and
`.db/budget.anonymized.db` as destination.

Full options, transformed columns, recurrence tables, limitations and
internals: **[docs/anonymisation.md](docs/anonymisation.md)**.

## Documentation

- [Anonymisation de la base](docs/anonymisation.md)
- [Event sourcing appliqué au Budget App](docs/event-sourcing-fr.md)
- [Coach financier IA](docs/coach-financier-ia.md)
- [Évaluation du retrieval RAG](docs/evaluation-rag.md)
