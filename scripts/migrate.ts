import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'

import { allowProdFromArgs, resolveDatabaseUrl } from './db-utils'

const DRIZZLE_DIR = fileURLToPath(new URL('../drizzle/', import.meta.url))

/**
 * Migrations that predate the `app_migrations` ledger. They are marked as
 * applied when the ledger is created on a database that already has the
 * operations table, so only new migrations run.
 */
const BASELINE_TAGS = [
  '0000_init',
  '0001_add_recurring',
  '0003_add_fingerprint',
  '0004_add_recurring_operations',
  '0004_add_recurring_match',
  '0005_add_categories',
  '0006_drop_operation_category_text',
]

const url = resolveDatabaseUrl({ allowProd: allowProdFromArgs() })
const sqlite = new Database(url)
sqlite.pragma('foreign_keys = ON')

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS app_migrations (
    tag TEXT PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  )
`)

const journal = JSON.parse(
  readFileSync(join(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8'),
) as { entries: Array<{ tag: string }> }

const applied = new Set(
  (
    sqlite
      .prepare('SELECT tag FROM app_migrations')
      .all() as Array<{ tag: string }>
  ).map((row) => row.tag),
)

const hasOperations = Boolean(
  sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operations'",
    )
    .get(),
)

if (hasOperations && applied.size === 0) {
  const insert = sqlite.prepare(
    'INSERT INTO app_migrations (tag, applied_at) VALUES (?, ?)',
  )
  const now = new Date().toISOString()
  for (const tag of BASELINE_TAGS) {
    insert.run(tag, now)
    applied.add(tag)
  }
}

const pending = journal.entries.filter((entry) => !applied.has(entry.tag))

if (pending.length === 0) {
  console.log('Aucune migration à appliquer.')
  sqlite.close()
  process.exit(0)
}

for (const entry of pending) {
  const sql = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
  const statements = sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)

  sqlite.transaction(() => {
    for (const statement of statements) sqlite.exec(statement)
    sqlite
      .prepare('INSERT INTO app_migrations (tag, applied_at) VALUES (?, ?)')
      .run(entry.tag, new Date().toISOString())
  })()

  console.log(`Migration appliquée : ${entry.tag}`)
}

sqlite.close()
