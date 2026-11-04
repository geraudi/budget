import type {
  OperationDetails,
  OperationDetailsPatch,
  OperationEvent,
  OperationState,
  StoredOperationEvent,
} from './events'
import type { OperationClassification } from './classification'

const STREAM_PREFIX = 'operation:'

export function operationStreamId(id: number): string {
  return `${STREAM_PREFIX}${id}`
}

export function operationIdFromStream(streamId: string): number {
  const match = new RegExp(`^${STREAM_PREFIX}(\\d+)$`).exec(streamId)
  if (!match) throw new Error(`Flux d’opération invalide : ${streamId}`)
  return Number(match[1])
}

/** Folds a stream of events into the current aggregate state. */
export function foldOperation(
  events: ReadonlyArray<StoredOperationEvent>,
): OperationState | null {
  return events.reduce<OperationState | null>(
    (state, event) => evolve(state, event),
    null,
  )
}

export function evolve(
  state: OperationState | null,
  event: StoredOperationEvent,
): OperationState {
  switch (event.type) {
    case 'OperationImported':
      return {
        ...event.payload,
        id: operationIdFromStream(event.streamId),
        version: event.streamVersion,
        deleted: false,
        classification: null,
      }
    case 'OperationDetailsUpdated': {
      if (!state) throw new Error('État d’opération manquant')
      return {
        ...state,
        ...event.payload,
        version: event.streamVersion,
      }
    }
    case 'OperationCategorized': {
      if (!state) throw new Error('État d’opération manquant')
      return {
        ...state,
        categoryId: event.payload.categoryId,
        subCategoryId: event.payload.subCategoryId,
        version: event.streamVersion,
      }
    }
    case 'OperationClassified': {
      if (!state) throw new Error('État d’opération manquant')
      return {
        ...state,
        classification: event.payload,
        version: event.streamVersion,
      }
    }
    case 'OperationPointageChanged': {
      if (!state) throw new Error('État d’opération manquant')
      return {
        ...state,
        pointage: event.payload.pointage,
        version: event.streamVersion,
      }
    }
    case 'OperationDeleted': {
      if (!state) throw new Error('État d’opération manquant')
      return {
        ...state,
        deleted: true,
        version: event.streamVersion,
      }
    }
  }
}

export type UpdateOperationCommand = OperationDetails & { id: number }

/** Emits only the events that actually change the aggregate. */
export function decideUpdate(
  state: OperationState,
  command: UpdateOperationCommand,
): OperationEvent[] {
  const patch: OperationDetailsPatch = {}

  if (state.dateComptabilisation !== command.dateComptabilisation) {
    patch.dateComptabilisation = command.dateComptabilisation
  }
  if (state.libelleSimplifie !== command.libelleSimplifie) {
    patch.libelleSimplifie = command.libelleSimplifie
  }
  if (state.libelleOperation !== command.libelleOperation) {
    patch.libelleOperation = command.libelleOperation
  }
  if (state.reference !== command.reference) {
    patch.reference = command.reference
  }
  if (state.infosComplementaires !== command.infosComplementaires) {
    patch.infosComplementaires = command.infosComplementaires
  }
  if (state.typeOperation !== command.typeOperation) {
    patch.typeOperation = command.typeOperation
  }
  if (state.debit !== command.debit) {
    patch.debit = command.debit
  }
  if (state.credit !== command.credit) {
    patch.credit = command.credit
  }
  if (state.montant !== command.montant) {
    patch.montant = command.montant
  }
  if (state.dateOperation !== command.dateOperation) {
    patch.dateOperation = command.dateOperation
  }
  if (state.dateValeur !== command.dateValeur) {
    patch.dateValeur = command.dateValeur
  }
  if (state.pointage !== command.pointage) {
    patch.pointage = command.pointage
  }

  const events: OperationEvent[] = []
  if (Object.keys(patch).length > 0) {
    events.push({ type: 'OperationDetailsUpdated', payload: patch })
  }

  const categoryChanged =
    state.categoryId !== command.categoryId ||
    state.subCategoryId !== command.subCategoryId
  if (categoryChanged) {
    events.push({
      type: 'OperationCategorized',
      payload: {
        categoryId: command.categoryId,
        subCategoryId: command.subCategoryId,
      },
    })
  }

  return events
}

export function decideCategorize(
  state: OperationState,
  categoryId: number | null,
  subCategoryId: number | null,
): OperationEvent[] {
  if (
    state.categoryId === categoryId &&
    state.subCategoryId === subCategoryId
  ) {
    return []
  }
  return [
    {
      type: 'OperationCategorized',
      payload: { categoryId, subCategoryId },
    },
  ]
}

export function decidePointage(
  state: OperationState,
  pointage: number,
): OperationEvent[] {
  if (state.pointage === pointage) return []
  return [{ type: 'OperationPointageChanged', payload: { pointage } }]
}

function sameClassification(
  a: OperationClassification,
  b: OperationClassification,
): boolean {
  return (
    a.kind === b.kind &&
    a.nature === b.nature &&
    a.classificationSource === b.classificationSource &&
    Math.abs(a.classificationConfidence - b.classificationConfidence) < 0.0001
  )
}

/**
 * Emits a manual classification override.
 *
 * `state.classification` only holds the last manual override, so the first
 * override is always emitted even when it matches a derived default: the
 * intent to override must be recorded.
 */
export function decideClassify(
  state: OperationState,
  classification: OperationClassification,
): OperationEvent[] {
  if (
    state.classification &&
    sameClassification(state.classification, classification)
  ) {
    return []
  }
  return [{ type: 'OperationClassified', payload: classification }]
}

export function decideDelete(state: OperationState): OperationEvent[] {
  if (state.deleted) return []
  return [{ type: 'OperationDeleted', payload: {} }]
}
