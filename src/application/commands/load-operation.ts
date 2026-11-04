import { eq } from 'drizzle-orm'

import { operations } from '#/db/schema'
import {
  foldOperation,
  operationStreamId,
} from '#/domain/operations/operation'
import type { OperationState } from '#/domain/operations/events'
import type { AppContext } from '#/infrastructure/context'

/** Replays an operation stream and rejects missing or deleted aggregates. */
export function loadOperation(ctx: AppContext, id: number): OperationState {
  const events = ctx.events.readStream(operationStreamId(id))

  if (events.length === 0) {
    const exists = ctx.db
      .select({ id: operations.id })
      .from(operations)
      .where(eq(operations.id, id))
      .get()

    if (exists) {
      throw new Error(
        "Opération présente dans la projection mais absente de l'event store. " +
          'Exécutez `pnpm events:backfill` sur cette base.',
      )
    }

    throw new Error('Opération inconnue')
  }

  const state = foldOperation(events)
  if (!state || state.deleted) throw new Error('Opération inconnue')
  return state
}
