import { describe, expect, it } from 'vitest'

import { computeIndicators, listMonths } from './indicators'
import type { AnalyticsOperation } from './types'

function op(
  values: Partial<AnalyticsOperation> & {
    id: number
    date: string
    montant: number
  },
): AnalyticsOperation {
  return {
    kind: 'expense',
    nature: 'essential',
    categoryId: 1,
    subCategoryId: null,
    categoryLabel: 'Alimentation',
    libelleSimplifie: `libellé-${values.id}`,
    isRecurring: false,
    classificationSource: 'rule',
    classificationConfidence: 0.9,
    ...values,
  }
}

const operations: AnalyticsOperation[] = [
  op({
    id: 1,
    date: '2026-01-05',
    montant: 3000,
    kind: 'income',
    nature: null,
    categoryLabel: 'Revenus',
    libelleSimplifie: 'SALAIRE',
    isRecurring: true,
    classificationConfidence: 1,
  }),
  op({
    id: 2,
    date: '2026-02-05',
    montant: 500,
    kind: 'income',
    nature: null,
    categoryLabel: 'Revenus',
    classificationConfidence: 1,
  }),
  op({
    id: 3,
    date: '2026-02-10',
    montant: 2000,
    kind: 'income',
    nature: null,
    categoryLabel: 'À catégoriser',
    classificationConfidence: 0.2,
  }),
  op({
    id: 4,
    date: '2026-03-01',
    montant: -1000,
    nature: 'essential',
    libelleSimplifie: 'LOYER',
    isRecurring: true,
  }),
  op({
    id: 5,
    date: '2026-03-02',
    montant: -300,
    nature: 'discretionary',
    categoryId: 2,
    categoryLabel: 'Loisirs',
  }),
  op({ id: 6, date: '2026-03-03', montant: -50, nature: 'exceptional' }),
  op({ id: 7, date: '2026-03-04', montant: -20, nature: null }),
  op({
    id: 8,
    date: '2026-03-05',
    montant: -200,
    kind: 'debt_payment',
    nature: null,
    categoryLabel: 'Crédit',
  }),
  op({
    id: 9,
    date: '2026-03-06',
    montant: 40,
    kind: 'refund',
    nature: null,
    categoryLabel: 'Santé',
  }),
  op({
    id: 10,
    date: '2026-03-10',
    montant: -150,
    kind: 'transfer',
    nature: null,
    categoryLabel: 'Virement interne',
  }),
  op({
    id: 11,
    date: '2026-03-11',
    montant: 150,
    kind: 'transfer',
    nature: null,
    categoryLabel: 'Virement interne',
  }),
  op({
    id: 12,
    date: '2026-04-01',
    montant: 9999,
    kind: 'income',
    nature: null,
    classificationConfidence: 1,
  }),
]

const period = { from: '2026-01', to: '2026-03' }

describe('listMonths', () => {
  it('expands an inclusive range across years', () => {
    expect(listMonths({ from: '2025-11', to: '2026-02' })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })

  it('rejects invalid or inverted periods', () => {
    expect(() => listMonths({ from: '2026-3', to: '2026-04' })).toThrow()
    expect(() => listMonths({ from: '2026-05', to: '2026-04' })).toThrow()
  })
})

describe('computeIndicators', () => {
  const indicators = computeIndicators(operations, period)

  it('separates qualified from unqualified income', () => {
    expect(indicators.income).toEqual({
      recurring: 3000,
      other: 500,
      unqualified: 2000,
      total: 5500,
    })
  })

  it('buckets expenses by nature and reports the rest as unqualified', () => {
    expect(indicators.expenses).toEqual({
      essential: 1000,
      discretionary: 300,
      exceptional: 50,
      unqualified: 20,
      total: 1370,
    })
  })

  it('never counts transfers as income or expenses', () => {
    expect(indicators.transfers).toEqual({
      internalTotal: 300,
      pairingConfidence: 1,
      detectedPairs: 1,
      unclassifiedPairs: 0,
    })
    expect(indicators.income.total).toBe(5500)
    expect(indicators.expenses.total).toBe(1370)
  })

  it('computes debt payments and refunds outside consumption', () => {
    expect(indicators.debtPayments).toEqual({ total: 200, count: 1 })
    expect(indicators.refunds).toEqual({ total: 40, count: 1 })
  })

  it('computes net surplus on qualified income only', () => {
    expect(indicators.savings.observed).toBe(1970)
    expect(indicators.savings.rate).toBe(0.5629)
    expect(indicators.savings.definition).toBe(
      'excédent net / revenus qualifiés',
    )
  })

  it('ignores operations outside the period', () => {
    expect(indicators.period).toEqual(period)
    expect(indicators.dataQuality.monthsAvailable).toBe(3)
    expect(indicators.income.total).toBeLessThan(9999)
  })

  it('averages recurring outflows over the available months', () => {
    expect(indicators.recurring).toEqual({
      count: 1,
      monthlyTotal: 333.33,
      byCategory: [
        { categoryId: 1, label: 'Alimentation', monthlyTotal: 333.33 },
      ],
    })
  })

  it('compares the last month to the three-month average', () => {
    expect(indicators.trends.threeMonthAverage).toEqual({
      income: 1166.67,
      expenses: 456.67,
      savings: 656.67,
    })
    expect(indicators.trends.deltas).toEqual({
      income: -1,
      expenses: 2,
    })
  })

  it('warns about a short history and unqualified income', () => {
    expect(indicators.dataQuality.classificationConfidence).toBe(0.8545)
    expect(indicators.dataQuality.uncategorizedShare).toBe(0.0909)
    expect(indicators.dataQuality.unqualifiedIncomeShare).toBe(0.3636)
    expect(indicators.dataQuality.warnings).toEqual([
      'Historique de 3 mois : les tendances restent fragiles.',
      '36 % des revenus probables ne sont pas qualifiés : les ratios (taux d’épargne, 50/30/20) ne sont pas fiables.',
    ])
  })
})

describe('data quality warnings', () => {
  it('flags pairs that are not classified as transfers', () => {
    const indicators = computeIndicators(
      [
        op({ id: 1, date: '2026-01-10', montant: -100, kind: 'expense' }),
        op({ id: 2, date: '2026-01-11', montant: 100, kind: 'income' }),
      ],
      { from: '2026-01', to: '2026-01' },
    )

    expect(indicators.transfers.unclassifiedPairs).toBe(1)
    expect(indicators.dataQuality.warnings).toContain(
      '1 paire(s) de montants opposés ne sont pas classées en transfert : ' +
        'le solde net peut être faussé.',
    )
  })

  it('warns when no transfer pair can be confirmed', () => {
    const indicators = computeIndicators(
      [
        op({
          id: 1,
          date: '2026-01-10',
          montant: -100,
          kind: 'transfer',
          nature: null,
        }),
        op({
          id: 2,
          date: '2026-01-11',
          montant: 90,
          kind: 'transfer',
          nature: null,
        }),
      ],
      { from: '2026-01', to: '2026-01' },
    )

    expect(indicators.transfers.detectedPairs).toBe(0)
    expect(indicators.dataQuality.warnings).toContain(
      'Aucun transfert interne confirmé par appariement : vérifier les ' +
        'virements non qualifiés.',
    )
  })

  it('flags a period without qualified income', () => {
    const indicators = computeIndicators(
      [op({ id: 1, date: '2026-01-10', montant: -100 })],
      { from: '2026-01', to: '2026-01' },
    )

    expect(indicators.savings.rate).toBe(0)
    expect(indicators.dataQuality.warnings).toContain(
      'Aucun revenu qualifié sur la période : le taux d’épargne n’est pas interprétable.',
    )
  })

  it('flags a negative net surplus', () => {
    const indicators = computeIndicators(
      [
        op({
          id: 1,
          date: '2026-01-01',
          montant: 1000,
          kind: 'income',
          nature: null,
          classificationConfidence: 1,
        }),
        op({ id: 2, date: '2026-01-02', montant: -1500 }),
      ],
      { from: '2026-01', to: '2026-01' },
    )

    expect(indicators.savings.rate).toBeLessThan(0)
    expect(indicators.dataQuality.warnings).toContain(
      'Le solde net est négatif sur la période.',
    )
  })
})
