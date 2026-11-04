import { sql } from 'drizzle-orm'

import {
  createDatabase,
  type AppDb,
  type SqliteHandle,
} from '#/db/create'
import { operations, financialGoals } from '#/db/schema'
import {
  createEventStore,
  type EventStore,
} from '#/infrastructure/events/event-store'
import {
  createGoalProjector,
  type GoalProjector,
} from '#/infrastructure/projections/goals'
import {
  createOperationProjector,
  type OperationProjector,
} from '#/infrastructure/projections/operations'
import { ensureDefaultRecurringPatterns } from '#/lib/recurring-core'
import { ensureDefaultClassificationRules } from '#/lib/classification-core'

export type AppContext = {
  db: AppDb
  sqlite: SqliteHandle
  events: EventStore
  projector: OperationProjector
  goalProjector: GoalProjector
}

export type CreateContextOptions = {
  url?: string
  db?: AppDb
  sqlite?: SqliteHandle
  /** Skip seeding defaults/sequences (read-only verification contexts). */
  initialize?: boolean
}

/**
 * Builds the application context around an explicit database.
 *
 * Scripts and tests use this to target a copy or an in-memory database;
 * server code uses `getContext()` from `app-context.ts`.
 */
export function createContext(options: CreateContextOptions = {}): AppContext {
  const { db, sqlite } =
    options.db && options.sqlite
      ? { db: options.db, sqlite: options.sqlite }
      : createDatabase(options.url)

  const events = createEventStore(db)

  if (options.initialize !== false) {
    ensureDefaultRecurringPatterns(db)
    ensureDefaultClassificationRules(db)

    // The sequence follows the read model so a database that predates the
    // event log can start allocating ids without an explicit backfill step.
    const maxOperationId =
      db
        .select({ max: sql<number | null>`max(${operations.id})` })
        .from(operations)
        .get()?.max ?? 0
    events.ensureSequence('operation', maxOperationId + 1)

    const maxGoalId =
      db
        .select({ max: sql<number | null>`max(${financialGoals.id})` })
        .from(financialGoals)
        .get()?.max ?? 0
    events.ensureSequence('goal', maxGoalId + 1)
  }

  return {
    db,
    sqlite,
    events,
    projector: createOperationProjector(db),
    goalProjector: createGoalProjector(db),
  }
}

/**
 * Runs a synchronous unit of work in a SQLite transaction.
 *
 * `better-sqlite3` transactions are connection-level, so the event store and
 * projector (which use `ctx.db`) participate in the same transaction.
 */
export function withTransaction<T>(ctx: AppContext, fn: () => T): T {
  return ctx.sqlite.transaction(fn)()
}
