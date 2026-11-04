import type { GoalCoachView } from '#/application/queries/goals'
import {
  SAVINGS_DEFINITION,
  type AnalyticsIndicators,
} from '#/domain/analytics'

/**
 * Deterministic fixtures for the ten scenarios of the coach design document
 * (`docs/coach-financier-ia.md` §9).
 *
 * A scenario only describes inputs and textual expectations: no database, no
 * model call and no filesystem access. The runner (`run.ts`) checks the prompt,
 * the retrieved cards and the exact figures.
 */
export type CoachScenario = {
  id: string
  title: string
  question: string
  indicators: AnalyticsIndicators
  goals?: GoalCoachView[]
  /** Substrings expected in the system prompt plus the knowledge block. */
  expect: string[]
  /** Substrings that must not appear (leak or forbidden conclusion). */
  forbid?: string[]
  /** Card expected in the top 4 of the lexical retrieval. */
  expectSourceId?: string
}

const BASE_INDICATORS: AnalyticsIndicators = {
  schemaVersion: 1,
  period: { from: '2026-01', to: '2026-12' },
  income: {
    recurring: 3_000,
    other: 0,
    unqualified: 0,
    total: 3_000,
  },
  expenses: {
    essential: 1_200,
    discretionary: 900,
    exceptional: 0,
    unqualified: 0,
    total: 2_100,
  },
  transfers: {
    internalTotal: 0,
    pairingConfidence: 0,
    detectedPairs: 0,
    unclassifiedPairs: 0,
  },
  savings: {
    observed: 900,
    rate: 0.3,
    definition: SAVINGS_DEFINITION,
  },
  debtPayments: { total: 0, count: 0 },
  refunds: { total: 0, count: 0 },
  recurring: { count: 0, monthlyTotal: 0, byCategory: [] },
  trends: {
    threeMonthAverage: { income: 3_000, expenses: 2_100, savings: 900 },
    deltas: { income: 0, expenses: 0 },
  },
  dataQuality: {
    monthsAvailable: 12,
    uncategorizedShare: 0,
    unqualifiedIncomeShare: 0,
    classificationConfidence: 1,
    warnings: [],
  },
}

type IndicatorsOverrides = Partial<Omit<AnalyticsIndicators, 'dataQuality'>> & {
  dataQuality?: Partial<AnalyticsIndicators['dataQuality']>
}

/** Base fixture with top-level and `dataQuality` overrides merged. */
export function makeIndicators(
  overrides: IndicatorsOverrides = {},
): AnalyticsIndicators {
  const { dataQuality, ...rest } = overrides

  return {
    ...BASE_INDICATORS,
    ...rest,
    dataQuality: {
      ...BASE_INDICATORS.dataQuality,
      ...dataQuality,
    },
  }
}

const VACANCES_GOAL: GoalCoachView = {
  id: 1,
  label: 'Vacances',
  status: 'active',
  targetAmount: 1_440,
  savedAmount: 0,
  remaining: 1_440,
  targetMonth: '2027-12',
  monthsRemaining: 12,
  monthlyEffort: 120,
  observedMonthlyCapacity: 120,
  alternativeMonthlyEffort: 120,
  realistic: true,
  reasons: [],
  savedInPeriod: 0,
}

export const SCENARIOS: CoachScenario[] = [
  {
    id: 'budget-equilibre',
    title: 'Budget équilibré, épargne faible',
    question: 'Comment améliorer mon épargne ?',
    indicators: makeIndicators(),
    expect: [
      '"recurring": 3000',
      '"observed": 900',
      '"monthsAvailable": 12',
      'Tu ne calcules rien',
    ],
    forbid: ['interdit d’appliquer ou de citer la règle 50/30/20'],
    expectSourceId: 'epargne_automatisation',
  },
  {
    id: 'charges-essentielles',
    title: 'Charges essentielles élevées',
    question: 'Où réduire mes dépenses ?',
    indicators: makeIndicators({
      expenses: {
        essential: 1_800,
        discretionary: 600,
        exceptional: 0,
        unqualified: 0,
        total: 2_400,
      },
      savings: { observed: 600, rate: 0.2, definition: SAVINGS_DEFINITION },
    }),
    expect: ['reconnais les contraintes', '"essential": 1800'],
  },
  {
    id: 'depense-exceptionnelle',
    title: 'Hausse ponctuelle des dépenses',
    question: 'Mes dépenses ont augmenté ce mois-ci.',
    indicators: makeIndicators({
      expenses: {
        essential: 1_200,
        discretionary: 900,
        exceptional: 800,
        unqualified: 0,
        total: 2_900,
      },
      savings: { observed: 100, rate: 0.0333, definition: SAVINGS_DEFINITION },
    }),
    expect: ['"exceptional": 800'],
    forbid: ['interdit de tirer une conclusion de tendance'],
  },
  {
    id: 'depenses-recurrentes',
    title: 'Dépenses récurrentes importantes',
    question: 'Comment auditer mes abonnements ?',
    indicators: makeIndicators({
      recurring: {
        count: 5,
        monthlyTotal: 450,
        byCategory: [
          { categoryId: 1, label: 'Abonnements', monthlyTotal: 450 },
        ],
      },
    }),
    expect: ['"monthlyTotal": 450', '"count": 5', 'Abonnements'],
    expectSourceId: 'depenses_abonnements_audit',
  },
  {
    id: 'historique-incomplet',
    title: 'Historique incomplet',
    question: 'Puis-je dégager une tendance ?',
    indicators: makeIndicators({
      dataQuality: {
        monthsAvailable: 3,
        warnings: ['Historique de 3 mois : les tendances restent fragiles.'],
      },
    }),
    expect: [
      'interdit de tirer une conclusion de tendance',
      'Historique de 3 mois : les tendances restent fragiles.',
    ],
  },
  {
    id: 'objectif-precis',
    title: 'Objectif d’épargne précis',
    question: 'Je veux mettre 120 €/mois pour des vacances.',
    indicators: makeIndicators({
      expenses: {
        essential: 1_200,
        discretionary: 360,
        exceptional: 0,
        unqualified: 0,
        total: 1_560,
      },
      savings: { observed: 1_440, rate: 0.48, definition: SAVINGS_DEFINITION },
    }),
    goals: [VACANCES_GOAL],
    expect: [
      'Objectifs suivis',
      '"monthlyEffort": 120',
      '"realistic": true',
    ],
    expectSourceId: 'objectif_effort_mensuel',
  },
  {
    id: 'solde-negatif',
    title: 'Solde négatif',
    question: 'Comment épargner alors que je suis à découvert ?',
    indicators: makeIndicators({
      expenses: {
        essential: 1_800,
        discretionary: 1_400,
        exceptional: 0,
        unqualified: 0,
        total: 3_200,
      },
      savings: { observed: -200, rate: -0.0667, definition: SAVINGS_DEFINITION },
      dataQuality: {
        warnings: ['Le solde net est négatif sur la période.'],
      },
    }),
    expect: ['stabilisation du budget', 'solde net est négatif'],
  },
  {
    id: 'question-50-30-20',
    title: 'Question générale sur la règle 50/30/20',
    question: 'Explique-moi la règle 50/30/20.',
    indicators: makeIndicators({
      income: {
        recurring: 300,
        other: 0,
        unqualified: 2_700,
        total: 3_000,
      },
      expenses: {
        essential: 1_200,
        discretionary: 900,
        exceptional: 0,
        unqualified: 0,
        total: 2_100,
      },
      savings: { observed: -1_800, rate: -6, definition: SAVINGS_DEFINITION },
      dataQuality: {
        unqualifiedIncomeShare: 0.9,
        warnings: [
          '90 % des revenus probables ne sont pas qualifiés : les ratios ' +
            '(taux d’épargne, 50/30/20) ne sont pas fiables.',
        ],
      },
    }),
    expect: [
      'interdit d’appliquer ou de citer la règle 50/30/20',
      'interdit de conclure sur le taux d’épargne',
    ],
    expectSourceId: 'budget_50_30_20',
  },
  {
    id: 'hors-perimetre',
    title: 'Question hors périmètre',
    question: 'Quel ETF acheter ?',
    indicators: makeIndicators(),
    expect: ['aucun conseil en investissement', 'limites de ton rôle'],
  },
  {
    id: 'virements-internes',
    title: 'Virements internes',
    question: 'Mes virements faussent-ils mon budget ?',
    indicators: makeIndicators({
      transfers: {
        internalTotal: 1_200,
        pairingConfidence: 0,
        detectedPairs: 0,
        unclassifiedPairs: 0,
      },
    }),
    expect: ['virements internes', 'fausser le solde net'],
  },
]
