import { sql } from 'drizzle-orm'

import { operations } from '#/db/schema'
import { createContext, withTransaction } from '#/infrastructure/context'
import { refreshClassifications } from '#/lib/classification-core'
import { allowProdFromArgs, resolveDatabaseUrl } from './db-utils'

const url = resolveDatabaseUrl({ allowProd: allowProdFromArgs() })
const ctx = createContext({ url })

const result = withTransaction(ctx, () => refreshClassifications(ctx.db))

const rows = ctx.db
  .select({
    kind: operations.kind,
    nature: operations.nature,
    source: operations.classificationSource,
    count: sql<number>`count(*)`,
    total: sql<number>`coalesce(sum(${operations.montant}), 0)`,
  })
  .from(operations)
  .groupBy(
    operations.kind,
    operations.nature,
    operations.classificationSource,
  )
  .all()
  .sort(
    (a, b) =>
      (a.kind ?? '').localeCompare(b.kind ?? '') ||
      (a.nature ?? '').localeCompare(b.nature ?? ''),
  )

const qualifiedIncome =
  ctx.db
    .select({
      total: sql<number>`coalesce(sum(${operations.montant}), 0)`,
    })
    .from(operations)
    .where(
      sql`${operations.kind} = 'income' and ${operations.classificationConfidence} >= 0.5`,
    )
    .get()?.total ?? 0

const unqualifiedIncome =
  ctx.db
    .select({
      total: sql<number>`coalesce(sum(${operations.montant}), 0)`,
    })
    .from(operations)
    .where(
      sql`${operations.kind} = 'income' and ${operations.classificationConfidence} < 0.5`,
    )
    .get()?.total ?? 0

const grossInflows =
  ctx.db
    .select({
      total: sql<number>`coalesce(sum(${operations.montant}), 0)`,
    })
    .from(operations)
    .where(sql`${operations.montant} > 0`)
    .get()?.total ?? 0

console.log(
  `Classification : ${result.updated} opération(s) mise(s) à jour, ` +
    `${result.skippedManual} override(s) manuel(s) conservé(s).`,
)

console.log('\nRépartition (montants signés) :')
for (const row of rows) {
  const nature = row.nature ? ` / ${row.nature}` : ''
  console.log(
    `- ${row.kind ?? 'non classé'}${nature} [${row.source ?? '—'}] : ` +
      `${row.count} opération(s), ${row.total.toFixed(2)} €`,
  )
}

console.log(
  `\nRevenus qualifiés : ${qualifiedIncome.toFixed(2)} € ` +
    `(revenus non qualifiés : ${unqualifiedIncome.toFixed(2)} €, ` +
    `entrées brutes : ${grossInflows.toFixed(2)} €).`,
)

ctx.sqlite.close()
