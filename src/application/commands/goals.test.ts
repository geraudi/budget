import { afterEach, describe, expect, it } from 'vitest'

import { coachRecommendations, financialGoals } from '#/db/schema'
import { ConcurrencyError } from '#/infrastructure/events/event-store'
import type { CoachRecommendationPayload } from '#/domain/goals/recommendation'
import { appendGoalAndProject, createMetadata } from './append'
import { createGoal } from './create-goal'
import { loadGoal } from './load-goal'
import { recordGoalContribution } from './record-goal-contribution'
import { recordRecommendation } from './record-recommendation'
import { updateGoal } from './update-goal'
import { goalStreamId } from '#/domain/goals/goal'
import { createTestContext } from '#/test/helpers'

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

const period = { from: '2026-01', to: '2026-12' }

const payload: CoachRecommendationPayload = {
  schemaVersion: 1,
  period,
  indicators: {
    income: { recurring: 0, other: 0, unqualified: 0, total: 0 },
    expenses: {
      essential: 0,
      discretionary: 0,
      exceptional: 0,
      unqualified: 0,
      total: 0,
    },
    savings: { observed: 0, rate: 0 },
    dataQuality: {
      monthsAvailable: 0,
      unqualifiedIncomeShare: 0,
      warnings: [],
    },
  },
  goals: [],
  recommendedMonthlyEffort: null,
  rationale: [],
}

describe('goal commands', () => {
  it('allocates sequential ids and writes the projection', () => {
    const ctx = setup()

    expect(
      createGoal(ctx, {
        label: 'Vacances',
        targetAmount: 1_200,
        targetMonth: '2026-12',
        startMonth: '2026-01',
      }),
    ).toEqual({ id: 1 })

    expect(
      createGoal(ctx, {
        label: 'Vélo',
        targetAmount: 600,
        targetMonth: '2026-10',
        startMonth: '2026-01',
      }),
    ).toEqual({ id: 2 })

    expect(
      ctx.db
        .select()
        .from(financialGoals)
        .all()
        .map((goal) => goal.id),
    ).toEqual([1, 2])
  })

  it('creates an achieved goal when the initial amount reaches the target', () => {
    const ctx = setup()
    const { id } = createGoal(ctx, {
      label: 'Matelas',
      targetAmount: 500,
      targetMonth: '2026-12',
      startMonth: '2026-01',
      initialSavedAmount: 500,
    })

    expect(loadGoal(ctx, id).status).toBe('achieved')
    expect(
      ctx.db
        .select()
        .from(financialGoals)
        .get()?.status,
    ).toBe('achieved')
  })

  it('updates the projection and its updated timestamp', () => {
    const ctx = setup()
    const { id } = createGoal(ctx, {
      label: 'Vacances',
      targetAmount: 1_200,
      targetMonth: '2026-12',
      startMonth: '2026-01',
    })
    const before = ctx.db.select().from(financialGoals).get()!

    const state = updateGoal(ctx, {
      id,
      label: 'Vacances d’été',
      targetAmount: 1_500,
    })
    const after = ctx.db.select().from(financialGoals).get()!

    expect(state).toMatchObject({ label: 'Vacances d’été', targetAmount: 1_500 })
    expect(after.label).toBe('Vacances d’été')
    expect(after.updatedAt >= before.updatedAt).toBe(true)
  })

  it('writes no event when an update changes nothing', () => {
    const ctx = setup()
    const { id } = createGoal(ctx, {
      label: 'Vacances',
      targetAmount: 1_200,
      targetMonth: '2026-12',
      startMonth: '2026-01',
    })
    const before = loadGoal(ctx, id)

    const state = updateGoal(ctx, { id, label: 'Vacances' })

    expect(state.version).toBe(before.version)
    expect(ctx.events.readStream(goalStreamId(id))).toHaveLength(1)
  })

  it('records a contribution and derives saved amount from events', () => {
    const ctx = setup()
    const { id } = createGoal(ctx, {
      label: 'Vacances',
      targetAmount: 100,
      targetMonth: '2026-12',
      startMonth: '2026-01',
    })

    const state = recordGoalContribution(ctx, {
      id,
      amount: 40,
      month: '2026-02',
    })

    expect(state.savedAmount).toBe(40)
    expect(
      ctx.db.select().from(financialGoals).get()?.savedAmount,
    ).toBe(40)
    expect(
      ctx.events
        .readStream(goalStreamId(id))
        .map((event) => event.type),
    ).toEqual(['GoalCreated', 'GoalContributionRecorded'])
  })

  it('marks the goal achieved when the target is reached', () => {
    const ctx = setup()
    const { id } = createGoal(ctx, {
      label: 'Vacances',
      targetAmount: 100,
      targetMonth: '2026-12',
      startMonth: '2026-01',
    })

    const state = recordGoalContribution(ctx, {
      id,
      amount: 100,
      month: '2026-02',
    })

    expect(state.status).toBe('achieved')
    expect(
      ctx.db.select().from(financialGoals).get()?.status,
    ).toBe('achieved')
  })

  it.each(['paused', 'abandoned'] as const)(
    'refuses a contribution on a %s goal',
    (status) => {
      const ctx = setup()
      const { id } = createGoal(ctx, {
        label: 'Vacances',
        targetAmount: 100,
        targetMonth: '2026-12',
        startMonth: '2026-01',
      })
      updateGoal(ctx, { id, status })

      expect(() =>
        recordGoalContribution(ctx, { id, amount: 10, month: '2026-02' }),
      ).toThrow(/n’accepte plus de contribution/)
    },
  )

  it('refuses a correction below zero and keeps the projection', () => {
    const ctx = setup()
    const { id } = createGoal(ctx, {
      label: 'Vacances',
      targetAmount: 100,
      targetMonth: '2026-12',
      startMonth: '2026-01',
      initialSavedAmount: 20,
    })

    expect(() =>
      recordGoalContribution(ctx, { id, amount: -30, month: '2026-02' }),
    ).toThrow(/négative/)
    expect(
      ctx.db.select().from(financialGoals).get()?.savedAmount,
    ).toBe(20)
  })

  it('rejects a concurrent append with a stale version', () => {
    const ctx = setup()
    const { id } = createGoal(ctx, {
      label: 'Vacances',
      targetAmount: 100,
      targetMonth: '2026-12',
      startMonth: '2026-01',
    })
    const state = loadGoal(ctx, id)

    appendGoalAndProject(ctx, {
      streamId: goalStreamId(id),
      expectedVersion: state.version,
      events: [
        {
          type: 'GoalUpdated',
          payload: { label: 'Premier' },
          metadata: createMetadata('ui'),
        },
      ],
    })

    expect(() =>
      appendGoalAndProject(ctx, {
        streamId: goalStreamId(id),
        expectedVersion: state.version,
        events: [
          {
            type: 'GoalUpdated',
            payload: { label: 'Second' },
            metadata: createMetadata('ui'),
          },
        ],
      }),
    ).toThrow(ConcurrencyError)
  })

  it('journals every recommendation and checks the goal exists', () => {
    const ctx = setup()
    const { id } = createGoal(ctx, {
      label: 'Vacances',
      targetAmount: 100,
      targetMonth: '2026-12',
      startMonth: '2026-01',
    })

    const first = recordRecommendation(ctx, {
      period,
      goalId: id,
      kind: 'goal_plan',
      payload,
    })
    const second = recordRecommendation(ctx, {
      period,
      goalId: null,
      kind: 'assessment',
      payload,
    })

    expect(first.id).not.toBe(second.id)
    expect(ctx.db.select().from(coachRecommendations).all()).toHaveLength(2)

    expect(() =>
      recordRecommendation(ctx, {
        period,
        goalId: 999,
        kind: 'follow_up',
        payload,
      }),
    ).toThrow(/introuvable/)
  })
})
