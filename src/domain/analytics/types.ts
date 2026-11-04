import type {
  ClassificationSource,
  OperationKind,
  OperationNature,
} from '#/domain/operations/classification'

/** Inclusive month range, formatted as `YYYY-MM`. */
export type AnalyticsPeriod = {
  from: string
  to: string
}

/**
 * Minimal projection of an operation needed by the indicators.
 *
 * Merchant labels are used internally for recurring detection but never
 * copied into the result: the coach payload must stay category-level.
 */
export type AnalyticsOperation = {
  id: number
  date: string
  montant: number
  kind: OperationKind | null
  nature: OperationNature | null
  categoryId: number | null
  subCategoryId: number | null
  categoryLabel: string | null
  libelleSimplifie: string
  isRecurring: boolean
  classificationSource: ClassificationSource | null
  classificationConfidence: number | null
}

export type IncomeIndicators = {
  /** Qualified recurring income. */
  recurring: number
  /** Qualified one-off income. */
  other: number
  /** Probable income with a confidence below the qualification threshold. */
  unqualified: number
  total: number
}

export type ExpenseIndicators = {
  essential: number
  discretionary: number
  exceptional: number
  /** Expenses without a nature (typically "à catégoriser" buckets). */
  unqualified: number
  total: number
}

export type TransferIndicators = {
  /** Volume of operations classified as transfers, including detected pairs. */
  internalTotal: number
  /** Share of rule-based transfers confirmed by an amount/date pair. */
  pairingConfidence: number
  detectedPairs: number
  /** Detected pairs where at least one side is not classified as a transfer. */
  unclassifiedPairs: number
}

export type SavingsIndicators = {
  /** Signed net surplus: qualified income + refunds - expenses - debt payments. */
  observed: number
  /** `observed / qualified income`, 0 when there is no qualified income. */
  rate: number
  definition: string
}

export type RecurringIndicators = {
  /** Number of distinct recurring labels (not operations). */
  count: number
  /** Average monthly outflow of recurring expenses and debt payments. */
  monthlyTotal: number
  byCategory: Array<{
    categoryId: number | null
    label: string
    monthlyTotal: number
  }>
}

export type TrendIndicators = {
  threeMonthAverage: {
    income: number
    expenses: number
    savings: number
  }
  /** Relative delta between the last month and the three-month average. */
  deltas: {
    income: number | null
    expenses: number | null
  }
}

export type DataQualityIndicators = {
  monthsAvailable: number
  /** Share of operations without category or with low confidence. */
  uncategorizedShare: number
  /** Share of probable income that is below the qualification threshold. */
  unqualifiedIncomeShare: number
  classificationConfidence: number
  warnings: string[]
}

export type AnalyticsIndicators = {
  schemaVersion: 1
  period: AnalyticsPeriod
  income: IncomeIndicators
  expenses: ExpenseIndicators
  transfers: TransferIndicators
  savings: SavingsIndicators
  debtPayments: { total: number; count: number }
  refunds: { total: number; count: number }
  recurring: RecurringIndicators
  trends: TrendIndicators
  dataQuality: DataQualityIndicators
}
