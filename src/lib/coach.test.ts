import { describe, expect, it } from 'vitest'

import type { AnalyticsIndicators } from '#/domain/analytics'
import type { GoalCoachView } from '#/application/queries/goals'
import {
  buildCoachPayload,
  buildCoachSystemPrompt,
  buildGoalPayload,
} from './coach-prompt'

const base: AnalyticsIndicators = {
  schemaVersion: 1,
  period: { from: '2026-01', to: '2026-10' },
  income: {
    recurring: 0,
    other: 3_385.05,
    unqualified: 29_624.19,
    total: 33_009.24,
  },
  expenses: {
    essential: 13_483.47,
    discretionary: 10_439.27,
    exceptional: 4_631.57,
    unqualified: 562.85,
    total: 29_117.16,
  },
  transfers: {
    internalTotal: 5_863.69,
    pairingConfidence: 0,
    detectedPairs: 0,
    unclassifiedPairs: 0,
  },
  savings: {
    observed: -34_117.71,
    rate: -10.0789,
    definition: 'excédent net / revenus qualifiés',
  },
  debtPayments: { total: 8_818.56, count: 1 },
  refunds: { total: 432.96, count: 1 },
  recurring: { count: 0, monthlyTotal: 0, byCategory: [] },
  trends: {
    threeMonthAverage: { income: 0, expenses: 0, savings: 0 },
    deltas: { income: null, expenses: null },
  },
  dataQuality: {
    monthsAvailable: 10,
    uncategorizedShare: 0,
    unqualifiedIncomeShare: 0.8974,
    classificationConfidence: 0.7,
    warnings: [
      '90 % des revenus probables ne sont pas qualifiés.',
      'Aucun transfert interne confirmé par appariement.',
      'Le solde net est négatif sur la période.',
    ],
  },
}

function makeIndicators(
  overrides: Partial<AnalyticsIndicators> = {},
): AnalyticsIndicators {
  return {
    ...base,
    ...overrides,
    dataQuality: {
      ...base.dataQuality,
      ...overrides.dataQuality,
    },
  }
}

const realisticGoal: GoalCoachView = {
  id: 1,
  label: 'Vacances',
  status: 'active',
  targetAmount: 1_440,
  savedAmount: 0,
  remaining: 1_440,
  targetMonth: '2027-06',
  monthsRemaining: 12,
  monthlyEffort: 120,
  observedMonthlyCapacity: 120,
  alternativeMonthlyEffort: 120,
  realistic: true,
  reasons: [],
  savedInPeriod: 0,
}

const unrealisticGoal: GoalCoachView = {
  ...realisticGoal,
  targetAmount: 1_000,
  remaining: 1_000,
  targetMonth: '2026-12',
  monthsRemaining: 6,
  monthlyEffort: 166.67,
  realistic: false,
  reasons: ['effort-above-capacity'],
}

describe('buildCoachSystemPrompt', () => {
  it('repeats every data-quality warning', () => {
    const indicators = makeIndicators()
    const prompt = buildCoachSystemPrompt(indicators)

    for (const warning of indicators.dataQuality.warnings) {
      expect(prompt).toContain(warning)
    }
  })

  it('forbids recalculation and 50/30/20 when income is not qualified', () => {
    const prompt = buildCoachSystemPrompt(makeIndicators())

    expect(prompt).toContain('Tu ne calcules rien')
    expect(prompt).toContain(
      'interdit d’appliquer ou de citer la règle 50/30/20',
    )
    expect(prompt).toContain('interdit de conclure sur le taux d’épargne')
  })

  it('forbids trend conclusions with fewer than six months', () => {
    const prompt = buildCoachSystemPrompt(
      makeIndicators({
        dataQuality: { ...base.dataQuality, monthsAvailable: 3 },
      }),
    )

    expect(prompt).toContain('interdit de tirer une conclusion de tendance')
  })

  it('warns about unconfirmed internal transfers', () => {
    const prompt = buildCoachSystemPrompt(
      makeIndicators({
        transfers: {
          internalTotal: 5_863.69,
          pairingConfidence: 0,
          detectedPairs: 0,
          unclassifiedPairs: 0,
        },
      }),
    )

    expect(prompt).toContain('virements internes')
    expect(prompt).toContain('fausser le solde net')
  })

  it('prioritises stabilisation when the net balance is negative', () => {
    const prompt = buildCoachSystemPrompt(makeIndicators())

    expect(prompt).toContain('stabilisation du budget')
  })

  it('acknowledges essential expense pressure before suggesting cuts', () => {
    const prompt = buildCoachSystemPrompt(makeIndicators())

    expect(prompt).toContain('reconnais les contraintes')
  })

  it('embeds the exact indicator payload', () => {
    const indicators = makeIndicators()
    const payload = buildCoachPayload(indicators)

    expect(JSON.parse(payload)).toEqual(indicators)
    expect(buildCoachSystemPrompt(indicators)).toContain(payload)
  })

  it('adds rule 10 without removing rules 1–9', () => {
    const prompt = buildCoachSystemPrompt(makeIndicators(), [])
    expect(prompt).toContain('Règles impératives')
    expect(prompt).toContain('Tu ne calcules rien')
    expect(prompt).toContain('Les objectifs suivis sont fournis')
    for (let rule = 1; rule <= 10; rule += 1) {
      expect(prompt).toContain(`${rule}. `)
    }
  })

  it('injects the goal payload after the indicators', () => {
    const prompt = buildCoachSystemPrompt(makeIndicators(), [realisticGoal])
    const indicatorIndex = prompt.indexOf('Données budgétaires vérifiées')
    const goalIndex = prompt.indexOf('Objectifs suivis')

    expect(indicatorIndex).toBeGreaterThan(-1)
    expect(goalIndex).toBeGreaterThan(indicatorIndex)
    expect(prompt).toContain(buildGoalPayload([realisticGoal]))
  })

  it('tells the model to refuse an effort above capacity', () => {
    const prompt = buildCoachSystemPrompt(makeIndicators(), [unrealisticGoal])

    expect(prompt).toContain('au-dessus de la capacité observée')
    expect(prompt).toContain('166,67')
    expect(prompt).toContain('120')
    expect(prompt).toContain('refuse-le')
  })

  it('tells the model not to invent a goal when none is stored', () => {
    const prompt = buildCoachSystemPrompt(makeIndicators(), [])
    expect(prompt).toContain('Aucun objectif n’est enregistré')
    expect(prompt).not.toContain('Objectifs suivis (JSON')
  })
})
