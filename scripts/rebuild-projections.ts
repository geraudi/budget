import { sql } from 'drizzle-orm'

import { financialGoals, operations } from '#/db/schema'
import { createContext, withTransaction } from '#/infrastructure/context'
import { refreshRecurringFlags } from '#/lib/recurring-core'
import {
  allowProdFromArgs,
  backupDatabase,
  replayAll,
  resolveDatabaseUrl,
} from './db-utils'

const url = resolveDatabaseUrl({ allowProd: allowProdFromArgs() })
const ctx = createContext({ url })

const backup = backupDatabase(ctx, url, 'rebuild')
console.log(`Sauvegarde : ${backup}`)

// The pragma has no effect inside a transaction; disable it first so the
// immutable recommendation journal keeps its goal links (ids are stable).
ctx.sqlite.pragma('foreign_keys = OFF')
const replayed = withTransaction(ctx, () => {
  ctx.db.delete(operations).run()
  ctx.db.delete(financialGoals).run()
  const count = replayAll(ctx)
  refreshRecurringFlags(ctx.db)
  return count
})
ctx.sqlite.pragma('foreign_keys = ON')

const total =
  ctx.db
    .select({ total: sql<number>`coalesce(sum(${operations.montant}), 0)` })
    .from(operations)
    .get()?.total ?? 0
const rows = ctx.db
  .select({ count: sql<number>`count(*)` })
  .from(operations)
  .get()?.count ?? 0
const goalRows = ctx.db
  .select({ count: sql<number>`count(*)` })
  .from(financialGoals)
  .get()?.count ?? 0

console.log(
  `Reconstruction terminée : ${rows} opération(s), ${goalRows} objectif(s), ${replayed} événement(s), ` +
    `position ${ctx.events.getCheckpoint('operations')}, total ${total}.`,
)

ctx.sqlite.close()
