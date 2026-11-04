import { QUALIFIED_CLASSIFICATION_CONFIDENCE } from '#/domain/operations/classification'
import { computeDataQuality } from './data-quality'
import { detectTransferPairs } from './transfers'
import type {
  AnalyticsIndicators,
  AnalyticsOperation,
  AnalyticsPeriod,
  ExpenseIndicators,
  IncomeIndicators,
  RecurringIndicators,
  SavingsIndicators,
  TransferIndicators,
  TrendIndicators,
} from './types'

export const SAVINGS_DEFINITION = 'excédent net / revenus qualifiés'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function monthOf(date: string): string {
  return date.slice(0, 7)
}

function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

/** Expands an inclusive `YYYY-MM` range into its months, oldest first. */
export function listMonths(period: AnalyticsPeriod): string[] {
  if (!isMonth(period.from) || !isMonth(period.to)) {
    throw new Error(
      `Période invalide : ${period.from} → ${period.to} (format YYYY-MM attendu)`,
    )
  }

  const [fromYear, fromMonth] = period.from.split('-').map(Number) as [
    number,
    number,
  ]
  const [toYear, toMonth] = period.to.split('-').map(Number) as [
    number,
    number,
  ]

  if (fromYear > toYear || (fromYear === toYear && fromMonth > toMonth)) {
    throw new Error(`Période inversée : ${period.from} → ${period.to}`)
  }

  const months: string[] = []
  let year = fromYear
  let month = fromMonth

  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return months
}

function isQualified(operation: AnalyticsOperation): boolean {
  return (
    (operation.classificationConfidence ?? 0) >=
    QUALIFIED_CLASSIFICATION_CONFIDENCE
  )
}

function incomeIndicators(
  operations: ReadonlyArray<AnalyticsOperation>,
): IncomeIndicators {
  let recurring = 0
  let other = 0
  let unqualified = 0

  for (const operation of operations) {
    if (operation.kind !== 'income') continue

    if (!isQualified(operation)) {
      unqualified += operation.montant
    } else if (operation.isRecurring) {
      recurring += operation.montant
    } else {
      other += operation.montant
    }
  }

  return {
    recurring: round2(recurring),
    other: round2(other),
    unqualified: round2(unqualified),
    total: round2(recurring + other + unqualified),
  }
}

function expenseIndicators(
  operations: ReadonlyArray<AnalyticsOperation>,
): ExpenseIndicators {
  let essential = 0
  let discretionary = 0
  let exceptional = 0
  let unqualified = 0

  for (const operation of operations) {
    if (operation.kind !== 'expense') continue
    const amount = Math.abs(operation.montant)

    switch (operation.nature) {
      case 'essential':
        essential += amount
        break
      case 'discretionary':
        discretionary += amount
        break
      case 'exceptional':
        exceptional += amount
        break
      default:
        unqualified += amount
    }
  }

  return {
    essential: round2(essential),
    discretionary: round2(discretionary),
    exceptional: round2(exceptional),
    unqualified: round2(unqualified),
    total: round2(essential + discretionary + exceptional + unqualified),
  }
}

type KindTotal = { total: number; count: number }

function kindTotal(
  operations: ReadonlyArray<AnalyticsOperation>,
  kind: AnalyticsOperation['kind'],
): KindTotal {
  let total = 0
  let count = 0

  for (const operation of operations) {
    if (operation.kind !== kind) continue
    total += Math.abs(operation.montant)
    count += 1
  }

  return { total: round2(total), count }
}

function transferIndicators(
  operations: ReadonlyArray<AnalyticsOperation>,
): TransferIndicators {
  const pairs = detectTransferPairs(operations)
  const byId = new Map(operations.map((operation) => [operation.id, operation]))
  const transferOps = operations.filter(
    (operation) => operation.kind === 'transfer',
  )

  const pairIds = new Set<number>()
  let unclassifiedPairs = 0

  for (const pair of pairs) {
    pairIds.add(pair.creditId)
    pairIds.add(pair.debitId)
    const credit = byId.get(pair.creditId)
    const debit = byId.get(pair.debitId)
    if (credit?.kind !== 'transfer' || debit?.kind !== 'transfer') {
      unclassifiedPairs += 1
    }
  }

  const ids = new Set<number>([
    ...transferOps.map((operation) => operation.id),
    ...pairIds,
  ])

  let internalTotal = 0
  for (const id of ids) {
    const operation = byId.get(id)
    if (operation) internalTotal += Math.abs(operation.montant)
  }

  const pairedTransferOps = transferOps.filter((operation) =>
    pairIds.has(operation.id),
  ).length

  return {
    internalTotal: round2(internalTotal),
    pairingConfidence:
      transferOps.length === 0
        ? 0
        : round4(pairedTransferOps / transferOps.length),
    detectedPairs: pairs.length,
    unclassifiedPairs,
  }
}

function recurringIndicators(
  operations: ReadonlyArray<AnalyticsOperation>,
  monthsAvailable: number,
): RecurringIndicators {
  const divisor = Math.max(monthsAvailable, 1)
  const recurring = operations.filter(
    (operation) =>
      operation.isRecurring &&
      (operation.kind === 'expense' || operation.kind === 'debt_payment'),
  )

  const groups = new Map<
    string,
    { categoryId: number | null; label: string; total: number }
  >()

  for (const operation of recurring) {
    const categoryId = operation.categoryId
    const label = operation.categoryLabel ?? 'Non catégorisé'
    const key = `${categoryId ?? 'none'}\u001f${label}`
    const group = groups.get(key) ?? { categoryId, label, total: 0 }
    group.total += Math.abs(operation.montant)
    groups.set(key, group)
  }

  const labels = new Set(
    recurring.map((operation) => operation.libelleSimplifie),
  )
  const monthlyTotal = [...groups.values()].reduce(
    (sum, group) => sum + group.total,
    0,
  )

  return {
    count: labels.size,
    monthlyTotal: round2(monthlyTotal / divisor),
    byCategory: [...groups.values()]
      .map((group) => ({
        categoryId: group.categoryId,
        label: group.label,
        monthlyTotal: round2(group.total / divisor),
      }))
      .sort((a, b) => b.monthlyTotal - a.monthlyTotal),
  }
}

function qualifiedIncomeOf(
  operations: ReadonlyArray<AnalyticsOperation>,
): number {
  return operations.reduce(
    (sum, operation) =>
      operation.kind === 'income' && isQualified(operation)
        ? sum + operation.montant
        : sum,
    0,
  )
}

function savingsOf(operations: ReadonlyArray<AnalyticsOperation>): number {
  return (
    qualifiedIncomeOf(operations) +
    kindTotal(operations, 'refund').total -
    expenseIndicators(operations).total -
    kindTotal(operations, 'debt_payment').total
  )
}

function trendIndicators(
  operations: ReadonlyArray<AnalyticsOperation>,
  months: ReadonlyArray<string>,
): TrendIndicators {
  const byMonth = new Map<string, AnalyticsOperation[]>()
  for (const operation of operations) {
    const month = monthOf(operation.date)
    const bucket = byMonth.get(month) ?? []
    bucket.push(operation)
    byMonth.set(month, bucket)
  }

  const lastMonths = months.slice(-3)
  const snapshots = lastMonths.map((month) => {
    const bucket = byMonth.get(month) ?? []
    return {
      income: qualifiedIncomeOf(bucket),
      expenses: expenseIndicators(bucket).total,
      savings: savingsOf(bucket),
    }
  })

  const divisor = snapshots.length || 1
  const average = snapshots.reduce(
    (sum, snapshot) => ({
      income: sum.income + snapshot.income,
      expenses: sum.expenses + snapshot.expenses,
      savings: sum.savings + snapshot.savings,
    }),
    { income: 0, expenses: 0, savings: 0 },
  )

  const threeMonthAverage = {
    income: round2(average.income / divisor),
    expenses: round2(average.expenses / divisor),
    savings: round2(average.savings / divisor),
  }

  const last = snapshots.at(-1)
  const delta = (value: number, reference: number): number | null =>
    reference === 0 ? null : round4((value - reference) / Math.abs(reference))

  return {
    threeMonthAverage,
    deltas: {
      income: last ? delta(last.income, threeMonthAverage.income) : null,
      expenses: last ? delta(last.expenses, threeMonthAverage.expenses) : null,
    },
  }
}

/**
 * Computes the versioned indicator set consumed by the coach.
 *
 * Definitions:
 * - `income.recurring` / `income.other`: qualified income (confidence
 *   ≥ 0.5), split on the recurring flag.
 * - `income.unqualified`: probable income below the confidence threshold
 *   (typically "virement reçu - à catégoriser"). It is reported, never
 *   counted as qualified income.
 * - `expenses.*`: absolute amounts of `kind = expense`, bucketed by nature.
 * - `savings.observed`: qualified income + refunds - expenses - debt payments.
 *
 * Transfers are never counted as income or expenses. Pair detection feeds the
 * `transfers` block and `dataQuality`, so an unclassified pair is visible to
 * the coach instead of being silently promoted.
 */
export function computeIndicators(
  operations: ReadonlyArray<AnalyticsOperation>,
  period: AnalyticsPeriod,
): AnalyticsIndicators {
  const months = listMonths(period)
  const inPeriod = operations.filter((operation) => {
    const month = monthOf(operation.date)
    return month >= period.from && month <= period.to
  })

  const monthsAvailable = months.filter((month) =>
    inPeriod.some((operation) => monthOf(operation.date) === month),
  ).length

  const income = incomeIndicators(inPeriod)
  const expenses = expenseIndicators(inPeriod)
  const transfers = transferIndicators(inPeriod)
  const debtPayments = kindTotal(inPeriod, 'debt_payment')
  const refunds = kindTotal(inPeriod, 'refund')

  const qualifiedIncome = income.recurring + income.other
  const observed = round2(
    qualifiedIncome + refunds.total - expenses.total - debtPayments.total,
  )
  const savings: SavingsIndicators = {
    observed,
    rate:
      qualifiedIncome === 0 ? 0 : round4(observed / qualifiedIncome),
    definition: SAVINGS_DEFINITION,
  }

  return {
    schemaVersion: 1,
    period: { from: period.from, to: period.to },
    income,
    expenses,
    transfers,
    savings,
    debtPayments,
    refunds,
    recurring: recurringIndicators(inPeriod, monthsAvailable),
    trends: trendIndicators(inPeriod, months),
    dataQuality: computeDataQuality({
      operations: inPeriod,
      monthsAvailable,
      pairingConfidence: transfers.pairingConfidence,
      unclassifiedPairs: transfers.unclassifiedPairs,
      detectedPairs: transfers.detectedPairs,
      transferCount: inPeriod.filter(
        (operation) => operation.kind === 'transfer',
      ).length,
      qualifiedIncome,
      unqualifiedIncome: income.unqualified,
      totalIncome: income.total,
      savingsRate: savings.rate,
    }),
  }
}
