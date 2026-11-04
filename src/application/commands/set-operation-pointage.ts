import { appendAndProject, createMetadata, runCommand } from './append'
import { loadOperation } from './load-operation'
import type { AppContext } from '#/infrastructure/context'
import {
  decidePointage,
  operationStreamId,
} from '#/domain/operations/operation'

export function setOperationPointage(
  ctx: AppContext,
  id: number,
  pointage: number,
): { id: number; pointage: number } {
  if (pointage !== 0 && pointage !== 1) {
    throw new Error('Pointage invalide')
  }

  return runCommand(ctx, () => {
    const state = loadOperation(ctx, id)

    appendAndProject(ctx, {
      streamId: operationStreamId(id),
      expectedVersion: state.version,
      events: decidePointage(state, pointage).map((event) => ({
        ...event,
        metadata: createMetadata('ui'),
      })),
    })

    return { id, pointage }
  })
}
