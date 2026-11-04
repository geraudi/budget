import { appendAndProject, createMetadata, runCommand } from './append'
import { loadOperation } from './load-operation'
import type { AppContext } from '#/infrastructure/context'
import {
  decideDelete,
  operationStreamId,
} from '#/domain/operations/operation'

export function deleteOperation(
  ctx: AppContext,
  id: number,
): { id: number } {
  return runCommand(ctx, () => {
    const state = loadOperation(ctx, id)

    appendAndProject(ctx, {
      streamId: operationStreamId(id),
      expectedVersion: state.version,
      events: decideDelete(state).map((event) => ({
        ...event,
        metadata: createMetadata('ui'),
      })),
    })

    return { id }
  })
}
