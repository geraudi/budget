import type { AnalyticsOperation } from './types'

export type TransferPair = {
  /** Id of the positive amount. */
  creditId: number
  /** Id of the negative amount. */
  debitId: number
  /** Matched amount, positive. */
  amount: number
  /** Absolute difference in days between the two accounting dates. */
  days: number
}

export type DetectTransferPairsOptions = {
  /** Maximum distance between the two operations, in days. */
  maxDays?: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const CENT_TOLERANCE = 0.015

function dayValue(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`)
}

function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < CENT_TOLERANCE
}

/**
 * Finds likely internal transfers: one operation of amount `x` and another
 * of amount `-x` within `maxDays` days.
 *
 * Pairing is greedy by closest date, and each operation is used at most once.
 * It is deliberately conservative: an amount mismatch (bank fees, currency)
 * leaves the operations unpaired instead of forcing a pair.
 */
export function detectTransferPairs(
  operations: ReadonlyArray<Pick<AnalyticsOperation, 'id' | 'date' | 'montant'>>,
  options: DetectTransferPairsOptions = {},
): TransferPair[] {
  const maxDays = options.maxDays ?? 3
  const sorted = operations
    .filter((operation) => Math.abs(operation.montant) > CENT_TOLERANCE)
    .slice()
    .sort((a, b) => {
      const byDate = dayValue(a.date) - dayValue(b.date)
      return byDate !== 0 ? byDate : a.id - b.id
    })

  const used = new Set<number>()
  const pairs: TransferPair[] = []

  for (let i = 0; i < sorted.length; i += 1) {
    const left = sorted[i]!
    if (used.has(left.id)) continue

    let best: { candidate: (typeof sorted)[number]; days: number } | null = null

    for (let j = i + 1; j < sorted.length; j += 1) {
      const right = sorted[j]!
      if (used.has(right.id)) continue
      if (right.montant * left.montant >= 0) continue
      if (!sameAmount(Math.abs(left.montant), Math.abs(right.montant))) {
        continue
      }

      const days = Math.abs(dayValue(left.date) - dayValue(right.date)) / DAY_MS
      if (days > maxDays) {
        // Operations are sorted by date: every later candidate is further.
        break
      }
      if (!best || days < best.days) best = { candidate: right, days }
    }

    if (!best) continue

    used.add(left.id)
    used.add(best.candidate.id)
    const positive = left.montant > 0 ? left : best.candidate
    const negative = left.montant > 0 ? best.candidate : left

    pairs.push({
      creditId: positive.id,
      debitId: negative.id,
      amount: Math.abs(left.montant),
      days: best.days,
    })
  }

  return pairs
}
