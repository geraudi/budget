# Budget App

## Architecture

The operations domain is event-sourced and read through inline projections:

- `src/domain/operations/` — pure aggregate (`evolve`, `decide*`) and event types.
- `src/infrastructure/events/` — append-only event store with optimistic concurrency.
- `src/infrastructure/projections/` — synchronous projector updating the `operations` table in the same transaction.
- `src/application/commands/` — write side (import, update, pointage, delete).
- `src/application/queries/` — read side (operations, categories, history).
- `src/server/` — `createServerFn` transport only.

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

These scripts refuse to run against `.db/budget.prod.db`. Stop the dev server
before running backfill or rebuild.

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

### Tests

```bash
pnpm test:unit         # Vitest: aggregate, event store, projector, sample imports, coach
pnpm test:coach        # 10 offline coach scenarios + privacy audit (no Ollama, no DB file)
pnpm test:coach -- --live  # optional manual inspection with Ollama (qwen3:14b)
pnpm test:e2e          # Playwright
```

The anonymised fixtures in `samples/` are imported by the Vitest integration
tests (ISO-8859-1, `;`-separated).

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

## Anonymising the database

`scripts/anonymize-db.mjs` writes an anonymised copy of the SQLite database,
suitable for demos, screenshots or issue reports. The source database is never
modified unless `--in-place` is passed.

### Command

```bash
pnpm anonymize-db [options] [source] [destination]
```

Equivalent to:

```bash
node scripts/anonymize-db.mjs [options] [source] [destination]
```

Defaults:

- `source`: `$DATABASE_URL`, or `.db/budget.dev.db`
- `destination`: `.db/budget.anonymized.db`

### Options

| Option | Description |
| --- | --- |
| `--in-place` | Anonymise the source database directly (no copy). Takes no `destination`. |
| `--force` | Overwrite `destination` if it already exists. |
| `--seed <n>` | Seed for the random generator (default `1`). Same seed ⇒ same output. |
| `-h`, `--help` | Show usage. |

### Examples

```bash
# .db/budget.dev.db → .db/budget.anonymized.db
pnpm anonymize-db

# Reproducible run, overwriting a previous copy
pnpm anonymize-db --seed 42 --force

# Explicit source and destination
pnpm anonymize-db .db/budget.dev.db /tmp/budget.anon.db

# Deliberately anonymise the real database in place
pnpm anonymize-db --in-place
```

To run the app against the anonymised copy:

```bash
DATABASE_URL=.db/budget.anonymized.db pnpm dev
```

### What is anonymised

On `operations`:

- `libelle_simplifie`, `libelle_operation`, `infos_complementaires`: stable
  fake labels, so repeated values and groupings stay consistent.
- `reference`: random characters keeping the original length, character
  classes (digits/letters/case) and separators.
- `debit`, `credit`, `montant`: random ±10 %, with a single factor per
  operation and `montant = debit + credit` preserved.
- `fingerprint`: recomputed with the same algorithm as `src/lib/csv.ts`.

The recurrence tables (`recurring_operations` labels/amounts/match patterns and
`recurring_labels` patterns) are anonymised as well, since they also contain
merchant names. Recurrence matching is no longer meaningful afterwards, but the
existing `is_recurring` flags are left untouched.

The script also enables `secure_delete` and runs `VACUUM` so the original
values do not remain readable in free SQLite pages.
