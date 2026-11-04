import { inArray } from 'drizzle-orm'

import type { AppDb } from '#/db/create'
import { operations, recurringLabels } from '#/db/schema'

export const defaultRecurringPatterns = [
  'PRLV Free Telecom',
  'PRLV SideCare',
  'PRLV EDF clients particuliers',
  'PRLV SOGEDO',
  'ECH PRET *',
  'PRLV GROUPAMA LOIRE-BRETAGNE',
  'FORMULE FAMILLE CONFORT',
  'PRLV FREE MOBILE',
] as const

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'iu')
  } catch {
    return null
  }
}

export type RecurringMatcher = {
  patternFor(libelleOperation: string): string | null
  matches(libelleOperation: string): boolean
}

/** Seeds the default patterns on an empty table. */
export function ensureDefaultRecurringPatterns(db: AppDb): void {
  const existing = db
    .select({ pattern: recurringLabels.pattern })
    .from(recurringLabels)
    .all()
  if (existing.length > 0) return

  db.insert(recurringLabels)
    .values([...defaultRecurringPatterns].map((pattern) => ({ pattern })))
    .onConflictDoNothing()
    .run()
}

/** Compiles the stored patterns once, for batch projection/rebuild work. */
export function createRecurringMatcher(db: AppDb): RecurringMatcher {
  const labels = db
    .select({ pattern: recurringLabels.pattern })
    .from(recurringLabels)
    .all()

  const regexes: Array<[string, RegExp]> = []
  for (const label of labels) {
    const regex = compilePattern(label.pattern)
    if (regex) regexes.push([label.pattern, regex])
  }

  function patternFor(libelleOperation: string): string | null {
    for (const [pattern, regex] of regexes) {
      if (regex.test(libelleOperation)) return pattern
    }
    return null
  }

  return {
    patternFor,
    matches: (libelleOperation) => patternFor(libelleOperation) !== null,
  }
}

/**
 * Re-aligns the `is_recurring` projection flag with the stored patterns.
 * Returns the matching pattern for each operation, keyed by operation id.
 */
export function refreshRecurringFlags(
  db: AppDb,
  operationIds?: ReadonlyArray<number>,
): Map<number, string> {
  if (operationIds !== undefined && operationIds.length === 0) {
    return new Map()
  }

  const matcher = createRecurringMatcher(db)
  const rows =
    operationIds === undefined
      ? db
          .select({
            id: operations.id,
            libelleOperation: operations.libelleOperation,
            isRecurring: operations.isRecurring,
          })
          .from(operations)
          .all()
      : db
          .select({
            id: operations.id,
            libelleOperation: operations.libelleOperation,
            isRecurring: operations.isRecurring,
          })
          .from(operations)
          .where(inArray(operations.id, [...operationIds]))
          .all()

  const matchByOperation = new Map<number, string>()
  const toRecur: number[] = []
  const toReset: number[] = []

  for (const row of rows) {
    const pattern = matcher.patternFor(row.libelleOperation)
    if (pattern) {
      matchByOperation.set(row.id, pattern)
      if (!row.isRecurring) toRecur.push(row.id)
    } else if (row.isRecurring) {
      toReset.push(row.id)
    }
  }

  if (toRecur.length > 0) {
    db.update(operations)
      .set({ isRecurring: true })
      .where(inArray(operations.id, toRecur))
      .run()
  }
  if (toReset.length > 0) {
    db.update(operations)
      .set({ isRecurring: false })
      .where(inArray(operations.id, toReset))
      .run()
  }

  return matchByOperation
}
