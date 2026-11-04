import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from './schema'

/**
 * Creates a SQLite connection and its Drizzle wrapper.
 *
 * Kept separate from `src/db/index.ts` so scripts and tests can open a
 * specific database without triggering the application singleton.
 */
export function createDatabase(
  url = process.env.DATABASE_URL ?? '.db/budget.dev.db',
) {
  const sqlite = new Database(url)
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

export type AppDb = ReturnType<typeof createDatabase>['db']
export type SqliteHandle = ReturnType<typeof createDatabase>['sqlite']
