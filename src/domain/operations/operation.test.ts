import { describe, expect, it } from 'vitest'

import type { StoredOperationEvent } from './events'
import {
  decideCategorize,
  decideClassify,
  decideDelete,
  decidePointage,
  decideUpdate,
  evolve,
  foldOperation,
  operationIdFromStream,
  operationStreamId,
} from './operation'

const baseDetails = {
  dateComptabilisation: '2026-01-02',
  libelleSimplifie: 'LIBELLÉ ANONYMISÉ 187',
  libelleOperation: 'OPÉRATION ANONYMISÉE 579',
  reference: null,
  infosComplementaires: null,
  typeOperation: 'Carte bancaire',
  categoryId: 1,
  subCategoryId: 2,
  debit: -8.4,
  credit: null,
  montant: -8.4,
  dateOperation: '2025-12-31',
  dateValeur: '2026-01-02',
  pointage: 0,
}

function event(
  streamId: string,
  streamVersion: number,
  type: StoredOperationEvent['type'],
  payload: StoredOperationEvent['payload'],
): StoredOperationEvent {
  return {
    type,
    payload,
    streamId,
    streamVersion,
    streamType: 'operation',
    globalPosition: streamVersion,
    eventId: `${streamId}:${streamVersion}`,
    occurredAt: '2026-01-02T00:00:00.000Z',
    metadata: {
      commandId: 'test',
      correlationId: 'test',
      source: 'system',
      schemaVersion: 1,
    },
  } as StoredOperationEvent
}

function importedState() {
  const streamId = operationStreamId(42)
  return foldOperation([
    event(streamId, 1, 'OperationImported', baseDetails),
  ])!
}

describe('operation aggregate', () => {
  it('maps stream ids to operation ids', () => {
    expect(operationStreamId(42)).toBe('operation:42')
    expect(operationIdFromStream('operation:42')).toBe(42)
    expect(() => operationIdFromStream('operation:abc')).toThrow()
  })

  it('builds state from OperationImported', () => {
    const state = importedState()
    expect(state).toMatchObject({
      id: 42,
      version: 1,
      deleted: false,
      ...baseDetails,
    })
  })

  it('emits only changed fields on update', () => {
    const state = importedState()
    const events = decideUpdate(state, {
      ...baseDetails,
      id: 42,
      libelleOperation: 'NOUVEAU LIBELLÉ',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'OperationDetailsUpdated',
      payload: { libelleOperation: 'NOUVEAU LIBELLÉ' },
    })
  })

  it('emits nothing when the update is a no-op', () => {
    const state = importedState()
    expect(decideUpdate(state, { ...baseDetails, id: 42 })).toEqual([])
  })

  it('emits a categorization event separately from details', () => {
    const state = importedState()
    const events = decideUpdate(state, {
      ...baseDetails,
      id: 42,
      categoryId: 3,
      subCategoryId: 4,
    })

    expect(events).toEqual([
      {
        type: 'OperationCategorized',
        payload: { categoryId: 3, subCategoryId: 4 },
      },
    ])
  })

  it('emits pointage changes only', () => {
    const state = importedState()
    expect(decidePointage(state, 0)).toEqual([])
    expect(decidePointage(state, 1)).toEqual([
      { type: 'OperationPointageChanged', payload: { pointage: 1 } },
    ])
  })

  it('emits categorization only when it changes', () => {
    const state = importedState()
    expect(decideCategorize(state, 1, 2)).toEqual([])
    expect(decideCategorize(state, 3, 4)).toEqual([
      {
        type: 'OperationCategorized',
        payload: { categoryId: 3, subCategoryId: 4 },
      },
    ])
  })

  it('marks the aggregate deleted', () => {
    const state = importedState()
    const events = decideDelete(state)
    expect(events).toEqual([{ type: 'OperationDeleted', payload: {} }])

    const deleted = evolve(
      state,
      event(operationStreamId(42), 2, 'OperationDeleted', {}),
    )
    expect(deleted.deleted).toBe(true)
    expect(decideDelete(deleted)).toEqual([])
  })

  it('stores the last manual classification in the aggregate', () => {
    const state = importedState()
    expect(state.classification).toBeNull()

    const classification = {
      kind: 'expense' as const,
      nature: 'essential' as const,
      classificationSource: 'manual' as const,
      classificationConfidence: 1,
    }

    expect(decideClassify(state, classification)).toEqual([
      { type: 'OperationClassified', payload: classification },
    ])

    const classified = evolve(
      state,
      event(
        operationStreamId(42),
        2,
        'OperationClassified',
        classification,
      ),
    )
    expect(classified.classification).toEqual(classification)
    expect(decideClassify(classified, classification)).toEqual([])
    expect(
      decideClassify(classified, { ...classification, kind: 'transfer' }),
    ).toHaveLength(1)
  })
})
