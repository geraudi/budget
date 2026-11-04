import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from '#/db/schema'
import {
  createContext,
  type AppContext,
} from '#/infrastructure/context'

const DRIZZLE_DIR = fileURLToPath(new URL('../../drizzle/', import.meta.url))

/** Applies every migration file, in journal order, to a SQLite handle. */
export function migrate(sqlite: Database.Database): void {
  const journal = JSON.parse(
    readFileSync(join(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string }> }

  for (const entry of journal.entries) {
    const sql = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (trimmed) sqlite.exec(trimmed)
    }
  }
}

/** Creates an in-memory database with the full schema and a fresh context. */
export function createTestContext(): AppContext & {
  close: () => void
} {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)
  const db = drizzle(sqlite, { schema })
  const ctx = createContext({ db, sqlite })
  return { ...ctx, close: () => sqlite.close() }
}
