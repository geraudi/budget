import { afterEach, describe, expect, it } from 'vitest'

import { financialGoals, operations } from '#/db/schema'
import type { StoredEvent } from '#/domain/events/envelope'
import type { GoalEvent } from '#/domain/goals/events'
import type { StoredOperationEvent } from '#/domain/operations/events'
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

const metadata = {
  commandId: 'cmd',
  correlationId: 'cmd',
  source: 'system' as const,
  schemaVersion: 1 as const,
}

const created: GoalEvent = {
  type: 'GoalCreated',
  payload: {
    label: 'Vacances',
    targetAmount: 1_200,
    targetMonth: '2026-12',
    startMonth: '2026-01',
    initialSavedAmount: 200,
  },
}

function row(ctx: ReturnType<typeof setup>) {
  return ctx.db.select().from(financialGoals).get()
}

describe('goal projector', () => {
  it('projects a creation event with deterministic timestamps', () => {
    const ctx = setup()
    const stored = ctx.events.append<GoalEvent>('goal:1', 'goal', 0, [
      {
        ...created,
        occurredAt: '2026-01-10T12:00:00.000Z',
        metadata,
      },
    ])
    ctx.goalProjector.apply(stored)

    expect(row(ctx)).toEqual({
      id: 1,
      label: 'Vacances',
      targetAmount: 1_200,
      savedAmount: 200,
      targetMonth: '2026-12',
      startMonth: '2026-01',
      status: 'active',
      createdAt: '2026-01-10T12:00:00.000Z',
      updatedAt: '2026-01-10T12:00:00.000Z',
    })
  })

  it('marks the projection achieved when the target is already reached', () => {
    const ctx = setup()
    const stored = ctx.events.append<GoalEvent>('goal:1', 'goal', 0, [
      {
        type: 'GoalCreated',
        payload: { ...created.payload, initialSavedAmount: 1_200 },
        metadata,
      },
    ])
    ctx.goalProjector.apply(stored)

    expect(row(ctx)?.status).toBe('achieved')
  })

  it('applies a partial update', () => {
    const ctx = setup()
    ctx.goalProjector.apply(
      ctx.events.append<GoalEvent>('goal:1', 'goal', 0, [
        { ...created, metadata },
      ]),
    )
    ctx.goalProjector.apply(
      ctx.events.append<GoalEvent>('goal:1', 'goal', 1, [
        {
          type: 'GoalUpdated',
          payload: { label: 'Vélo', targetAmount: 900 },
          occurredAt: '2026-02-01T00:00:00.000Z',
          metadata,
        },
      ]),
    )

    expect(row(ctx)).toMatchObject({
      label: 'Vélo',
      targetAmount: 900,
      savedAmount: 200,
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
  })

  it('recomputes saved amount from contributions', () => {
    const ctx = setup()
    ctx.goalProjector.apply(
      ctx.events.append<GoalEvent>('goal:1', 'goal', 0, [
        { ...created, metadata },
      ]),
    )
    ctx.goalProjector.apply(
      ctx.events.append<GoalEvent>('goal:1', 'goal', 1, [
        {
          type: 'GoalContributionRecorded',
          payload: { amount: 100.55, month: '2026-02' },
          metadata,
        },
      ]),
    )

    expect(row(ctx)?.savedAmount).toBe(300.55)
  })

  it('replays to the same projection', () => {
    const ctx = setup()
    ctx.goalProjector.apply(
      ctx.events.append<GoalEvent>('goal:1', 'goal', 0, [
        { ...created, metadata },
      ]),
    )
    ctx.goalProjector.apply(
      ctx.events.append<GoalEvent>('goal:1', 'goal', 1, [
        {
          type: 'GoalContributionRecorded',
          payload: { amount: 50, month: '2026-02' },
          metadata,
        },
      ]),
    )
    const before = row(ctx)

    ctx.db.delete(financialGoals).run()
    const goalEvents = ctx.events
      .readAll()
      .filter(
        (event): event is StoredEvent<GoalEvent> =>
          event.streamType === 'goal',
      )
    ctx.goalProjector.apply(goalEvents)

    expect(row(ctx)).toEqual(before)
  })

  it('is ignored by the operation projector', () => {
    const ctx = setup()
    const goalEvents = ctx.events.append<GoalEvent>('goal:1', 'goal', 0, [
      { ...created, metadata },
    ])

    expect(() =>
      ctx.projector.apply(
        goalEvents as unknown as StoredOperationEvent[],
      ),
    ).not.toThrow()
    expect(ctx.db.select().from(operations).all()).toEqual([])
  })
})
