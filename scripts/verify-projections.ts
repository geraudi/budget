import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'

import { financialGoals, operations } from '#/db/schema'
import { createContext } from '#/infrastructure/context'
import { fingerprintFromOperationRow } from '#/lib/csv'
import { createRecurringMatcher } from '#/lib/recurring-core'
import {
  allowProdFromArgs,
  replayAll,
  resolveDatabaseUrl,
} from './db-utils'

const url = resolveDatabaseUrl({ allowProd: allowProdFromArgs() })
const source = createContext({ url, initialize: false })

const sourceRows = source.db.select().from(operations).all()
const sourceGoalRows = source.db.select().from(financialGoals).all()
const sourceTotal =
  source.db
    .select({ total: sql<number>`coalesce(sum(${operations.montant}), 0)` })
    .from(operations)
    .get()?.total ?? 0

mkdirSync('.db', { recursive: true })
const copyPath = join(
  '.db',
  `verify-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
)
source.sqlite.exec(`VACUUM INTO '${copyPath.replace(/'/g, "''")}'`)

const copy = createContext({ url: copyPath })
copy.db.delete(operations).run()
copy.db.delete(financialGoals).run()
const replayed = replayAll(copy)

const rebuiltRows = copy.db.select().from(operations).all()
const rebuiltById = new Map(rebuiltRows.map((row) => [row.id, row]))
const matcher = createRecurringMatcher(copy.db)

const scalarFields = [
  'dateComptabilisation',
  'libelleSimplifie',
  'libelleOperation',
  'reference',
  'infosComplementaires',
  'typeOperation',
  'categoryId',
  'subCategoryId',
  'debit',
  'credit',
  'montant',
  'dateOperation',
  'dateValeur',
  'pointage',
  'kind',
  'nature',
  'classificationSource',
  'classificationConfidence',
] as const

const diffs: string[] = []

for (const expected of sourceRows) {
  const actual = rebuiltById.get(expected.id)
  if (!actual) {
    diffs.push(`opération ${expected.id} : absente de la projection reconstruite`)
    continue
  }

  for (const field of scalarFields) {
    if (actual[field] !== expected[field]) {
      diffs.push(
        `opération ${expected.id}.${field} : attendu ${JSON.stringify(
          expected[field],
        )}, obtenu ${JSON.stringify(actual[field])}`,
      )
    }
  }

  const expectedFingerprint = fingerprintFromOperationRow(expected)
  if (actual.fingerprint !== expectedFingerprint) {
    diffs.push(
      `opération ${expected.id}.fingerprint : attendu ${expectedFingerprint}, obtenu ${actual.fingerprint}`,
    )
  }

  const expectedRecurring = matcher.matches(expected.libelleOperation)
  if (actual.isRecurring !== expectedRecurring) {
    diffs.push(
      `opération ${expected.id}.isRecurring : attendu ${expectedRecurring}, obtenu ${actual.isRecurring}`,
    )
  }
}

for (const actual of rebuiltRows) {
  if (!sourceRows.some((row) => row.id === actual.id)) {
    diffs.push(`opération ${actual.id} : présente uniquement dans la reconstruction`)
  }
}

const rebuiltGoalRows = copy.db.select().from(financialGoals).all()
const rebuiltGoalsById = new Map(
  rebuiltGoalRows.map((row) => [row.id, row]),
)
const goalFields = [
  'id',
  'label',
  'targetAmount',
  'savedAmount',
  'targetMonth',
  'startMonth',
  'status',
  'createdAt',
  'updatedAt',
] as const

for (const expected of sourceGoalRows) {
  const actual = rebuiltGoalsById.get(expected.id)
  if (!actual) {
    diffs.push(`objectif ${expected.id} : absent de la projection reconstruite`)
    continue
  }
  for (const field of goalFields) {
    if (actual[field] !== expected[field]) {
      diffs.push(
        `objectif ${expected.id}.${field} : attendu ${JSON.stringify(
          expected[field],
        )}, obtenu ${JSON.stringify(actual[field])}`,
      )
    }
  }
}

for (const actual of rebuiltGoalRows) {
  if (!sourceGoalRows.some((row) => row.id === actual.id)) {
    diffs.push(`objectif ${actual.id} : présent uniquement dans la reconstruction`)
  }
}

const rebuiltTotal =
  copy.db
    .select({ total: sql<number>`coalesce(sum(${operations.montant}), 0)` })
    .from(operations)
    .get()?.total ?? 0

if (rebuiltTotal !== sourceTotal) {
  diffs.push(
    `total montant : attendu ${sourceTotal}, obtenu ${rebuiltTotal}`,
  )
}

copy.sqlite.close()
source.sqlite.close()
rmSync(copyPath, { force: true })

console.log(
  `Vérification : ${sourceRows.length} opération(s), ${sourceGoalRows.length} objectif(s), ${replayed} événement(s) rejoué(s).`,
)
console.log(`Total montant : ${sourceTotal}`)

if (diffs.length > 0) {
  console.error(`\n${diffs.length} différence(s) détectée(s) :`)
  for (const diff of diffs.slice(0, 50)) console.error(`- ${diff}`)
  if (diffs.length > 50) console.error(`… et ${diffs.length - 50} autre(s)`)
  process.exitCode = 1
} else {
  console.log('Projection identique : 0 différence.')
}
