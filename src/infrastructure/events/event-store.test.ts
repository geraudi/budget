import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '#/test/helpers'
import type { GoalEvent } from '#/domain/goals/events'
import {
  ConcurrencyError,
  createEventStore,
} from './event-store'

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
})

function setup() {
  const ctx = createTestContext()
  close = ctx.close
  return { ctx, store: createEventStore(ctx.db) }
}

const metadata = {
  commandId: 'cmd',
  correlationId: 'cmd',
  source: 'system' as const,
  schemaVersion: 1 as const,
}

describe('event store', () => {
  it('appends and reads a stream in order', () => {
    const { store } = setup()

    store.append('operation:1', 'operation', 0, [
      {
        type: 'OperationImported',
        payload: {
          dateComptabilisation: '2026-01-02',
          libelleSimplifie: 'A',
          libelleOperation: 'A',
          reference: null,
          infosComplementaires: null,
          typeOperation: null,
          categoryId: null,
          subCategoryId: null,
          debit: -1,
          credit: null,
          montant: -1,
          dateOperation: null,
          dateValeur: null,
          pointage: 0,
        },
        metadata,
      },
    ])
    store.append('operation:1', 'operation', 1, [
      {
        type: 'OperationPointageChanged',
        payload: { pointage: 1 },
        metadata,
      },
    ])

    const events = store.readStream('operation:1')
    expect(events.map((event) => event.type)).toEqual([
      'OperationImported',
      'OperationPointageChanged',
    ])
    expect(events.map((event) => event.streamVersion)).toEqual([1, 2])
    expect(store.streamVersion('operation:1')).toBe(2)
  })

  it('rejects a stale expected version', () => {
    const { store } = setup()
    store.append('operation:1', 'operation', 0, [
      {
        type: 'OperationDeleted',
        payload: {},
        metadata,
      },
    ])

    expect(() =>
      store.append('operation:1', 'operation', 0, [
        { type: 'OperationDeleted', payload: {}, metadata },
      ]),
    ).toThrow(ConcurrencyError)
  })

  it('appends to independent streams', () => {
    const { store } = setup()
    store.append('operation:1', 'operation', 0, [
      { type: 'OperationDeleted', payload: {}, metadata },
    ])
    store.append('operation:2', 'operation', 0, [
      { type: 'OperationDeleted', payload: {}, metadata },
    ])

    expect(store.readStream('operation:1')).toHaveLength(1)
    expect(store.readStream('operation:2')).toHaveLength(1)
    expect(store.readAll()).toHaveLength(2)
  })

  it('round-trips JSON payloads and metadata', () => {
    const { store } = setup()
    store.append('operation:7', 'operation', 0, [
      {
        type: 'OperationCategorized',
        payload: { categoryId: 3, subCategoryId: null },
        metadata: { ...metadata, fingerprint: 'abc', fileName: 'test.csv' },
      },
    ])

    const [event] = store.readStream('operation:7')
    expect(event!.payload).toEqual({ categoryId: 3, subCategoryId: null })
    expect(event!.metadata.fingerprint).toBe('abc')
    expect(event!.metadata.fileName).toBe('test.csv')
  })

  it('round-trips an OperationClassified payload', () => {
    const { store } = setup()
    const payload = {
      kind: 'expense' as const,
      nature: 'essential' as const,
      classificationSource: 'manual' as const,
      classificationConfidence: 1,
    }

    store.append('operation:8', 'operation', 0, [
      { type: 'OperationClassified', payload, metadata },
    ])

    const [event] = store.readStream('operation:8')
    expect(event!.type).toBe('OperationClassified')
    expect(event!.payload).toEqual(payload)
  })

  it('allocates sequence values', () => {
    const { store } = setup()
    expect(store.nextId('operation')).toBe(1)
    expect(store.nextId('operation')).toBe(2)
  })

  it('appends and reads a goal stream', () => {
    const { store } = setup()
    store.append<GoalEvent>('goal:1', 'goal', 0, [
      {
        type: 'GoalCreated',
        payload: {
          label: 'Vacances',
          targetAmount: 1_200,
          targetMonth: '2026-12',
          startMonth: '2026-01',
          initialSavedAmount: 0,
        },
        metadata,
      },
    ])
    store.append<GoalEvent>('goal:1', 'goal', 1, [
      {
        type: 'GoalContributionRecorded',
        payload: { amount: 100, month: '2026-02' },
        metadata,
      },
    ])

    const events = store.readStream<GoalEvent>('goal:1')
    expect(events.map((event) => event.type)).toEqual([
      'GoalCreated',
      'GoalContributionRecorded',
    ])
    expect(events.map((event) => event.streamVersion)).toEqual([1, 2])
    expect(store.streamVersion('goal:1')).toBe(2)
  })

  it('keeps mixed streams independent', () => {
    const { store } = setup()
    store.append('operation:1', 'operation', 0, [
      { type: 'OperationDeleted', payload: {}, metadata },
    ])
    store.append<GoalEvent>('goal:1', 'goal', 0, [
      {
        type: 'GoalCreated',
        payload: {
          label: 'Vacances',
          targetAmount: 100,
          targetMonth: '2026-12',
          startMonth: '2026-01',
          initialSavedAmount: 0,
        },
        metadata,
      },
    ])
    store.append<GoalEvent>('goal:1', 'goal', 1, [
      {
        type: 'GoalContributionRecorded',
        payload: { amount: 10, month: '2026-02' },
        metadata,
      },
    ])

    expect(store.readAll()).toHaveLength(3)
    expect(store.readStream('goal:1')).toHaveLength(2)
    expect(store.readStream('operation:1')).toHaveLength(1)
    expect(store.streamVersion('goal:1')).toBe(2)
    expect(store.streamVersion('operation:1')).toBe(1)
  })
})
