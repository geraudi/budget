import { describe, expect, it } from 'vitest'

import type { GoalEvent, StoredGoalEvent } from './events'
import type { GoalDetails, GoalState } from './types'
import {
  decideContribution,
  decideCreate,
  decideUpdate,
  evolve,
  foldGoal,
  goalIdFromStream,
  goalStreamId,
} from './goal'

const metadata = {
  commandId: 'cmd',
  correlationId: 'cmd',
  source: 'system' as const,
  schemaVersion: 1 as const,
}

let eventCounter = 0

function stored(
  event: GoalEvent,
  streamVersion: number,
  occurredAt = '2026-01-01T00:00:00.000Z',
): StoredGoalEvent {
  eventCounter += 1
  return {
    ...event,
    globalPosition: eventCounter,
    eventId: `event-${eventCounter}`,
    streamId: 'goal:1',
    streamType: 'goal',
    streamVersion,
    occurredAt,
    metadata,
  } as StoredGoalEvent
}

const details: GoalDetails = {
  label: 'Vacances',
  targetAmount: 1_200,
  targetMonth: '2026-12',
  startMonth: '2026-01',
  initialSavedAmount: 200,
}

function createdState(overrides: Partial<GoalDetails> = {}): GoalState {
  const state = foldGoal([
    stored({ type: 'GoalCreated', payload: { ...details, ...overrides } }, 1),
  ])
  if (!state) throw new Error('état attendu')
  return state
}

describe('goal stream ids', () => {
  it('round-trips a goal stream id', () => {
    expect(goalStreamId(42)).toBe('goal:42')
    expect(goalIdFromStream('goal:42')).toBe(42)
  })

  it('rejects an invalid stream id', () => {
    expect(() => goalIdFromStream('operation:1')).toThrow(/objectif/i)
    expect(() => goalIdFromStream('goal:abc')).toThrow(/objectif/i)
  })
})

describe('foldGoal', () => {
  it('creates the aggregate with the initial saved amount', () => {
    const state = createdState()

    expect(state).toEqual({
      id: 1,
      label: 'Vacances',
      targetAmount: 1_200,
      savedAmount: 200,
      targetMonth: '2026-12',
      startMonth: '2026-01',
      status: 'active',
      version: 1,
    })
  })

  it('marks a goal achieved when the initial amount already reaches it', () => {
    const state = createdState({ initialSavedAmount: 1_200 })
    expect(state.status).toBe('achieved')
  })

  it('applies a partial update without touching saved amount', () => {
    const state = createdState()
    const next = evolve(
      state,
      stored(
        {
          type: 'GoalUpdated',
          payload: { label: 'Vacances d’été', targetAmount: 1_500 },
        },
        2,
      ),
    )

    expect(next).toMatchObject({
      label: 'Vacances d’été',
      targetAmount: 1_500,
      savedAmount: 200,
      version: 2,
    })
  })

  it('rounds signed contributions', () => {
    const state = createdState()
    const afterPositive = evolve(
      state,
      stored(
        {
          type: 'GoalContributionRecorded',
          payload: { amount: 100.55, month: '2026-02' },
        },
        2,
      ),
    )
    const afterCorrection = evolve(
      afterPositive,
      stored(
        {
          type: 'GoalContributionRecorded',
          payload: { amount: -50.25, month: '2026-03' },
        },
        3,
      ),
    )

    expect(afterPositive.savedAmount).toBe(300.55)
    expect(afterCorrection.savedAmount).toBe(250.3)
  })

  it('folds a full stream in order', () => {
    const state = foldGoal([
      stored({ type: 'GoalCreated', payload: details }, 1),
      stored(
        {
          type: 'GoalContributionRecorded',
          payload: { amount: 100, month: '2026-02' },
        },
        2,
      ),
      stored({ type: 'GoalUpdated', payload: { status: 'paused' } }, 3),
    ])

    expect(state).toMatchObject({
      savedAmount: 300,
      status: 'paused',
      version: 3,
    })
  })
})

describe('decideCreate', () => {
  it('returns a single creation event', () => {
    expect(decideCreate(details)).toEqual([
      { type: 'GoalCreated', payload: details },
    ])
  })

  it('rejects a non-positive target amount', () => {
    expect(() => decideCreate({ ...details, targetAmount: 0 })).toThrow(
      /Montant cible invalide/,
    )
  })

  it('rejects an invalid target month', () => {
    expect(() => decideCreate({ ...details, targetMonth: '2026-13' })).toThrow(
      /Mois cible invalide/,
    )
  })

  it('rejects a target month before the start month', () => {
    expect(() =>
      decideCreate({ ...details, targetMonth: '2025-12' }),
    ).toThrow(/postérieur ou égal/)
  })

  it('rejects an initial amount above the target', () => {
    expect(() =>
      decideCreate({ ...details, initialSavedAmount: 1_300 }),
    ).toThrow(/dépasser la cible/)
  })
})

describe('decideUpdate', () => {
  it('emits nothing when the patch changes nothing', () => {
    const state = createdState()
    expect(
      decideUpdate(state, { label: 'Vacances', targetAmount: 1_200 }),
    ).toEqual([])
  })

  it('emits only the changed fields', () => {
    const state = createdState()
    expect(decideUpdate(state, { label: 'Vélo' })).toEqual([
      { type: 'GoalUpdated', payload: { label: 'Vélo' } },
    ])
  })

  it('reopens an achieved goal when the target increases', () => {
    const achieved = createdState({ initialSavedAmount: 1_200 })
    expect(achieved.status).toBe('achieved')

    expect(decideUpdate(achieved, { targetAmount: 1_500 })).toEqual([
      {
        type: 'GoalUpdated',
        payload: { targetAmount: 1_500, status: 'active' },
      },
    ])
  })

  it('keeps an explicit manual status when the target increases', () => {
    const achieved = createdState({ initialSavedAmount: 1_200 })

    expect(
      decideUpdate(achieved, { targetAmount: 1_500, status: 'paused' }),
    ).toEqual([
      {
        type: 'GoalUpdated',
        payload: { targetAmount: 1_500, status: 'paused' },
      },
    ])
  })

  it('refuses a manually entered achieved status', () => {
    const state = createdState()
    expect(() => decideUpdate(state, { status: 'achieved' })).toThrow(
      /dérivé d’une contribution/,
    )
  })

  it('refuses a target month before the start month', () => {
    const state = createdState()
    expect(() => decideUpdate(state, { targetMonth: '2025-12' })).toThrow(
      /postérieur ou égal/,
    )
  })
})

describe('decideContribution', () => {
  it('refuses a zero contribution', () => {
    expect(() =>
      decideContribution(createdState(), { amount: 0, month: '2026-02' }),
    ).toThrow(/nulle/)
  })

  it.each(['paused', 'abandoned', 'achieved'] as const)(
    'refuses a contribution on a %s goal',
    (status) => {
      const state = { ...createdState(), status }
      expect(() =>
        decideContribution(state, { amount: 10, month: '2026-02' }),
      ).toThrow(/n’accepte plus de contribution/)
    },
  )

  it('refuses a correction that makes savings negative', () => {
    expect(() =>
      decideContribution(createdState(), { amount: -300, month: '2026-02' }),
    ).toThrow(/négative/)
  })

  it('marks the goal achieved when the target is reached', () => {
    const state = createdState()
    expect(
      decideContribution(state, { amount: 1_000, month: '2026-02' }),
    ).toEqual([
      {
        type: 'GoalContributionRecorded',
        payload: { amount: 1_000, month: '2026-02' },
      },
      { type: 'GoalUpdated', payload: { status: 'achieved' } },
    ])
  })

  it('keeps a goal active below the target', () => {
    expect(
      decideContribution(createdState(), { amount: 100, month: '2026-02' }),
    ).toEqual([
      {
        type: 'GoalContributionRecorded',
        payload: { amount: 100, month: '2026-02' },
      },
    ])
  })
})
