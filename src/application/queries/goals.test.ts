import { afterEach, describe, expect, it } from 'vitest'

import { createGoal } from '#/application/commands/create-goal'
import { recordGoalContribution } from '#/application/commands/record-goal-contribution'
import { computeIndicators } from '#/domain/analytics'
import type {
  AnalyticsOperation,
  AnalyticsPeriod,
} from '#/domain/analytics/types'
import { createTestContext } from '#/test/helpers'
import {
  buildRecommendationPayload,
  computeGoalProgress,
  listGoalProgress,
  loadGoalRecords,
  monthsBetween,
  observedMonthlyCapacity,
  toGoalCoachView,
} from './goals'

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
})

function setup() {
  const ctx = createTestContext()
  close = ctx.close
  return ctx
}

const P1: AnalyticsPeriod = { from: '2026-01', to: '2026-06' }
const P2: AnalyticsPeriod = { from: '2026-07', to: '2026-12' }

type Fixture = {
  income?: number
  expense?: number
  incomeConfidence?: number
  months?: number
}

function makeOperations(options: Fixture = {}): AnalyticsOperation[] {
  const income = options.income ?? 1_500
  const expense = options.expense ?? 1_380
  const confidence = options.incomeConfidence ?? 1
  const months = options.months ?? 12
  const operations: AnalyticsOperation[] = []

  for (let index = 0; index < months; index += 1) {
    const month = String((index % 12) + 1).padStart(2, '0')
    const year = 2026 + Math.floor(index / 12)

    operations.push({
      id: index * 10 + 1,
      date: `${year}-${month}-05`,
      montant: income,
      kind: 'income',
      nature: null,
      categoryId: null,
      subCategoryId: null,
      categoryLabel: null,
      libelleSimplifie: 'REVENU TEST',
      isRecurring: false,
      classificationSource: 'manual',
      classificationConfidence: confidence,
    })
    operations.push({
      id: index * 10 + 2,
      date: `${year}-${month}-10`,
      montant: -expense,
      kind: 'expense',
      nature: 'essential',
      categoryId: null,
      subCategoryId: null,
      categoryLabel: null,
      libelleSimplifie: 'DEPENSE TEST',
      isRecurring: false,
      classificationSource: 'manual',
      classificationConfidence: 1,
    })
  }

  return operations
}

function indicatorsFor(
  period: AnalyticsPeriod,
  options: Fixture = {},
) {
  return computeIndicators(makeOperations(options), period)
}

function createVacances(
  ctx: ReturnType<typeof setup>,
  input: {
    targetAmount: number
    targetMonth: string
    initialSavedAmount?: number
  },
) {
  return createGoal(ctx, {
    label: 'Vacances',
    targetAmount: input.targetAmount,
    targetMonth: input.targetMonth,
    startMonth: '2026-01',
    initialSavedAmount: input.initialSavedAmount,
  })
}

describe('monthsBetween', () => {
  it('counts whole months across years', () => {
    expect(monthsBetween('2026-06', '2026-06')).toBe(0)
    expect(monthsBetween('2026-12', '2027-01')).toBe(1)
    expect(monthsBetween('2026-01', '2026-12')).toBe(11)
    expect(monthsBetween('2027-01', '2026-12')).toBe(-1)
  })
})

describe('goal progress', () => {
  it('computes a realistic effort of 120 €/month', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1)
    expect(indicators.savings.observed).toBe(720)
    expect(indicators.dataQuality.monthsAvailable).toBe(6)
    expect(observedMonthlyCapacity(indicators)).toBe(120)

    createVacances(ctx, { targetAmount: 1_440, targetMonth: '2027-06' })

    const [goal] = listGoalProgress(ctx, { period: P1, indicators })
    expect(goal).toMatchObject({
      monthsRemaining: 12,
      monthlyEffort: 120,
      observedMonthlyCapacity: 120,
      alternativeMonthlyEffort: 120,
      realistic: true,
      reasons: [],
    })
  })

  it('flags an effort above the observed capacity', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1)
    createVacances(ctx, { targetAmount: 1_000, targetMonth: '2026-12' })

    const [goal] = listGoalProgress(ctx, { period: P1, indicators })
    expect(goal).toMatchObject({
      monthlyEffort: 166.67,
      alternativeMonthlyEffort: 120,
      realistic: false,
    })
    expect(goal!.reasons).toContain('effort-above-capacity')
  })

  it('follows 24 € saved on a 30 € goal over two periods', () => {
    const ctx = setup()
    const { id } = createVacances(ctx, {
      targetAmount: 30,
      targetMonth: '2026-12',
    })
    recordGoalContribution(ctx, { id, amount: 24, month: '2026-07' })

    const p1 = indicatorsFor(P1)
    const p2 = indicatorsFor(P2)
    const [firstPeriod] = listGoalProgress(ctx, {
      period: P1,
      indicators: p1,
    })
    const [secondPeriod] = listGoalProgress(ctx, {
      period: P2,
      indicators: p2,
    })

    expect(firstPeriod).toMatchObject({
      savedAmount: 24,
      remaining: 6,
      progress: 0.8,
      savedInPeriod: 0,
    })
    expect(secondPeriod).toMatchObject({
      savedAmount: 24,
      remaining: 6,
      progress: 0.8,
      savedInPeriod: 24,
    })
  })

  it('reports no qualified income and never proposes a negative effort', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1, { incomeConfidence: 0.2 })
    createVacances(ctx, { targetAmount: 600, targetMonth: '2026-12' })

    const [goal] = listGoalProgress(ctx, { period: P1, indicators })
    expect(goal!.reasons).toContain('no-qualified-income')
    expect(goal!.reasons).toContain('negative-capacity')
    expect(goal!.alternativeMonthlyEffort).toBe(0)
    expect(goal!.realistic).toBe(false)
  })

  it('reports a negative capacity', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1, { expense: 1_800 })
    createVacances(ctx, { targetAmount: 600, targetMonth: '2026-12' })

    const [goal] = listGoalProgress(ctx, { period: P1, indicators })
    expect(goal!.observedMonthlyCapacity).toBeLessThan(0)
    expect(goal!.reasons).toContain('negative-capacity')
    expect(goal!.alternativeMonthlyEffort).toBe(0)
  })

  it('warns when the history is too short', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1, { months: 1 })
    createVacances(ctx, { targetAmount: 600, targetMonth: '2026-12' })

    const [goal] = listGoalProgress(ctx, { period: P1, indicators })
    expect(indicators.dataQuality.monthsAvailable).toBe(1)
    expect(goal!.reasons).toContain('insufficient-history')
    expect(goal!.realistic).toBe(false)
  })

  it('handles an overdue deadline without dividing by zero', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1)
    createVacances(ctx, { targetAmount: 600, targetMonth: '2026-05' })

    const [goal] = listGoalProgress(ctx, { period: P1, indicators })
    expect(goal).toMatchObject({
      overdue: true,
      monthsRemaining: 0,
      monthlyEffort: 600,
    })
    expect(goal!.reasons).toContain('overdue')
  })

  it('marks an achieved goal and stops the effort', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1)
    createVacances(ctx, {
      targetAmount: 30,
      targetMonth: '2026-12',
      initialSavedAmount: 30,
    })

    const [goal] = listGoalProgress(ctx, { period: P1, indicators })
    expect(goal).toMatchObject({
      monthlyEffort: 0,
      remaining: 0,
      progress: 1,
      reasons: ['achieved'],
    })
  })

  it('exposes no merchant label in the coach view', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1)
    createVacances(ctx, { targetAmount: 1_440, targetMonth: '2027-06' })

    const views = listGoalProgress(ctx, { period: P1, indicators }).map(
      toGoalCoachView,
    )
    const serialized = JSON.stringify({ indicators, goals: views })

    expect(views[0]!.label).toBe('Vacances')
    expect(serialized).not.toContain('libelleSimplifie')
    expect(serialized).not.toContain('libelleOperation')
    expect(serialized).not.toContain('topExpenses')
    expect(serialized).not.toContain('REVENU TEST')
    expect(serialized).not.toContain('DEPENSE TEST')
  })
})

describe('computeGoalProgress', () => {
  it('handles a goal without target amount defensively', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1)
    createVacances(ctx, { targetAmount: 0.01, targetMonth: '2026-12' })
    const record = loadGoalRecords(ctx)[0]!

    const progress = computeGoalProgress(
      { ...record, targetAmount: 0 },
      [],
      { asOfMonth: P1.to, period: P1, indicators },
    )

    expect(progress.progress).toBe(0)
  })
})

describe('buildRecommendationPayload', () => {
  it('recommends the alternative effort and explains why in French', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1)
    createVacances(ctx, { targetAmount: 1_000, targetMonth: '2026-12' })
    const progress = listGoalProgress(ctx, { period: P1, indicators })
    const goal = progress[0]!

    const payload = buildRecommendationPayload({
      period: P1,
      indicators,
      progress,
      goal,
    })
    const serialized = JSON.stringify(payload)

    expect(payload.recommendedMonthlyEffort).toBe(120)
    expect(payload.rationale.join(' ')).toContain('au-dessus de la capacité')
    expect(payload.indicators.income.other).toBe(9_000)
    expect(payload.indicators.dataQuality.monthsAvailable).toBe(6)
    expect(serialized).not.toContain('libelleSimplifie')
    expect(serialized).not.toContain('libelleOperation')
    expect(serialized).not.toContain('reference')
    expect(serialized).not.toContain('topExpenses')
  })

  it('falls back to the non-negative monthly capacity without a goal', () => {
    const ctx = setup()
    const indicators = indicatorsFor(P1, { expense: 1_800 })
    const progress = listGoalProgress(ctx, { period: P1, indicators })

    const payload = buildRecommendationPayload({
      period: P1,
      indicators,
      progress,
      goal: null,
    })

    expect(payload.recommendedMonthlyEffort).toBe(0)
  })
})
