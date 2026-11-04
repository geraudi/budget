import { appendAndProject, createMetadata, runCommand } from './append'
import { loadOperation } from './load-operation'
import type { AppContext } from '#/infrastructure/context'
import {
  isOperationKind,
  isOperationNature,
  type OperationClassification,
  type OperationKind,
  type OperationNature,
} from '#/domain/operations/classification'
import {
  decideClassify,
  operationStreamId,
} from '#/domain/operations/operation'

export type ClassifyOperationInput = {
  id: number
  kind: OperationKind
  /** Only meaningful for `kind = 'expense'`. */
  nature?: OperationNature | null
  /** Defaults to 1: a manual classification is asserted, not guessed. */
  confidence?: number
}

/**
 * Records a manual classification override.
 *
 * Defaults stay derived from the rules; this event is the only way to pin a
 * value that must survive rule changes and rebuilds.
 */
export function classifyOperation(
  ctx: AppContext,
  input: ClassifyOperationInput,
): { id: number; classification: OperationClassification } {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    throw new Error('Identifiant d’opération invalide')
  }
  if (!isOperationKind(input.kind)) {
    throw new Error('Nature comptable invalide')
  }

  const nature = input.nature ?? null
  if (nature !== null && !isOperationNature(nature)) {
    throw new Error('Nature de dépense invalide')
  }
  if (nature !== null && input.kind !== 'expense') {
    throw new Error(
      'La nature essential/discretionary/exceptional ne s’applique qu’aux dépenses',
    )
  }

  const confidence = input.confidence ?? 1
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('Confiance de classification invalide (0 à 1 attendu)')
  }

  const classification: OperationClassification = {
    kind: input.kind,
    nature: input.kind === 'expense' ? nature : null,
    classificationSource: 'manual',
    classificationConfidence: confidence,
  }

  return runCommand(ctx, () => {
    const state = loadOperation(ctx, input.id)

    appendAndProject(ctx, {
      streamId: operationStreamId(state.id),
      expectedVersion: state.version,
      events: decideClassify(state, classification).map((event) => ({
        ...event,
        metadata: createMetadata('ui'),
      })),
    })

    return { id: state.id, classification }
  })
}
