<!-- intent-skills:start -->
## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:
- Run `pnpm exec intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm exec intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# Budget App

TanStack Start (Vite) + React 19 SSR app over a local SQLite bank-transaction DB.

## Tooling

- Package manager is **pnpm** (README says npm — trust the pnpm lockfile/workspace config instead).
- No lint script exists. Verification = `pnpm exec tsc --noEmit` (strict, with `noUnusedLocals`/`noUnusedParameters` — unused imports break typecheck).
- `pnpm dev` (port 3000) regenerates `src/routeTree.gen.ts` on route changes; standalone: `pnpm generate-routes` (`tsr generate`). Never edit `routeTree.gen.ts` by hand.
- Routes are file-based in `src/routes` (`__root.tsx` is the layout). Server-side data flows through `createServerFn` handlers in `src/server/*`, which validate input and delegate to `src/application/commands/*` or `src/application/queries/*`.
- `src/domain/*` is pure (no SQL); `src/infrastructure/*` owns the database, event store, and projectors.

## Stack quirks

- TanStack **Table v9** pre-release API (`tableFeatures`, `useTable`, `helper.columns`) — differs from v8 docs/examples; follow `src/routes/index.tsx` as the in-repo pattern.
- shadcn/ui with style `base-maia` and **hugeicons** (components in `src/components/ui`); shadcn CLI expects `@/*` aliases.
- Two path aliases point to the same place: `#/*` and `@/*` both → `./src/*`. Server/db code uses `#/*` (Node subpath imports); shadcn uses `@/*`.

## Database

- SQLite via better-sqlite3 + drizzle-orm. DB files live in the repo's `.db/` folder, overridable with `DATABASE_URL`.
- **Always use `.db/budget.dev.db`** — never read from or write to `.db/budget.prod.db` (production data). This is the code default (`src/db/index.ts`, `drizzle.config.ts`, `scripts/`); override only with `DATABASE_URL`.
- The DB is built by `../make_db.py` from a bank CSV export (French, dd/mm dates → `yyyy-mm-dd` TEXT); `montant` is signed, `debit`/`credit` are separate columns.
- Schema: `src/db/schema.ts`; migrations in `drizzle/`. Generate with `pnpm db:generate`, apply with `pnpm db:migrate` (custom runner tracked in `app_migrations`; `drizzle-kit migrate` fails on this journal).
- Operations are **event-sourced**: `events` is append-only, `streams` tracks aggregate versions, and the `operations` table is an inline projection. Commands must append through `src/application/commands/append.ts`; never write to `operations` directly outside the projector, `refreshRecurringFlags`, and the rebuild/backfill scripts.
- Event-store scripts: `pnpm events:backfill` (existing rows → `OperationImported` events), `pnpm events:verify` (replay on a copy and diff), `pnpm events:rebuild` (backup + replay into the live projection). They refuse `.db/budget.prod.db`.
- Classification: `kind`/`nature` are derived by the projector from `category_classification_rules` (seeded from code, editable in DB); `pnpm classification:backfill` re-derives existing rows and keeps manual overrides. An `OperationClassified` event pins a manual value.
- Sample imports live in `samples/` (anonymised ISO-8859-1 CSV) and are used by the Vitest integration tests.
- `better-sqlite3` is `ssr.external` in `vite.config.ts` (native module); pnpm `allowBuilds` in `pnpm-workspace.yaml` covers its native build (plus esbuild, lightningcss).

## Objectifs & recommandations

- Migration `0009` adds `financial_goals` (projection) and `coach_recommendations` (append-only journal). There is no server-side chat transcript: the coach thread stays in `localStorage` per period (`budget-coach:<periodKey>`).
- Goals are event-sourced on `goal:<id>` streams (`GoalCreated`, `GoalUpdated`, `GoalContributionRecorded`), with an inline projector and replay by `streamType`. Commands: `createGoal`, `updateGoal`, `recordGoalContribution`, `recordRecommendation`, `loadGoal`; server fns in `src/server/goals.ts`.
- `recordRecommendation` only appends to `coach_recommendations`, which is never updated or deleted. Its payload is rebuilt server-side from the verified indicators and goals (`buildRecommendationPayload`), never from model output.
- Privacy rule: the coach payload and journal contain aggregates only, plus the user-entered goal id/label. Never send merchant labels, operation references, operation ids or `topExpenses`. `src/eval/coach/privacy.test.ts` is the blocking guard.
- `pnpm test:coach` runs the 10 deterministic §8 scenarios offline (no Ollama, no DB file) plus the privacy gate; `pnpm test:coach -- --live` is manual inspection only.

## Conventions

- UI and data are French: `fr-FR` locale, EUR via `Intl.NumberFormat`, French labels (`Opérations`, `Solde`, …).
- TanStack React packages are exact-pinned and excluded from `minimumReleaseAge` in `pnpm-workspace.yaml` — don't bump them casually.

## Unit tests

- Vitest (`vitest.config.ts`) with tests next to the code (`src/**/*.test.ts`); currently **197 tests / 19 files**.
- `pnpm test:unit` (run once), `pnpm test:unit:watch`.
- `pnpm test:coach` runs the offline coach scenarios and the privacy gate (the CLI itself is not chained into `test:unit`; its Vitest tests are already included). `-- --live` is optional and needs Ollama.
- Test helpers in `src/test/helpers.ts` create an in-memory SQLite database and apply every migration in journal order.

## E2E tests

- Playwright (`@playwright/test`) with specs in `e2e/`; config in `playwright.config.ts`.
- `pnpm test:e2e` (auto-starts `pnpm dev` on port 3000, or reuses a running server), `pnpm test:e2e:ui`, `pnpm test:e2e:report`.
- Set `PLAYWRIGHT_BASE_URL` to test against an already-running instance (skips the managed dev server).
- Only Chromium is installed by default: `pnpm test:e2e:install` (adds OS deps, use on CI).
- Artifacts (`test-results/`, `playwright-report/`) are gitignored.

