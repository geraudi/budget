import type { AppContext } from '#/infrastructure/context'
import { withTransaction } from '#/infrastructure/context'
import type { NewGoalEvent, StoredGoalEvent } from '#/domain/goals/events'
import type {
  EventMetadata,
  NewOperationEvent,
  StoredOperationEvent,
} from '#/domain/operations/events'

export type AppendOptions = {
  streamId: string
  expectedVersion: number
  events: ReadonlyArray<NewOperationEvent>
}

/**
 * Appends events and applies the inline projection in the same transaction.
 *
 * Commands should call this through `withTransaction`; the helper itself does
 * not open a transaction so several streams can be written atomically.
 */
export function appendAndProject(
  ctx: AppContext,
  options: AppendOptions,
): StoredOperationEvent[] {
  const stored = ctx.events.append(
    options.streamId,
    'operation',
    options.expectedVersion,
    options.events,
  )

  if (stored.length > 0) {
    ctx.projector.apply(stored)
    ctx.events.saveCheckpoint('operations', ctx.events.maxPosition())
  }

  return stored
}

export type AppendGoalOptions = {
  streamId: string
  expectedVersion: number
  events: ReadonlyArray<NewGoalEvent>
}

/**
 * Appends goal events and applies the goal projection in the same transaction.
 *
 * Deliberately separate from `appendAndProject`: applying the operation
 * projector to a `goal:*` stream would fail, and the checkpoint name differs.
 */
export function appendGoalAndProject(
  ctx: AppContext,
  options: AppendGoalOptions,
): StoredGoalEvent[] {
  const stored = ctx.events.append(
    options.streamId,
    'goal',
    options.expectedVersion,
    options.events,
  )

  if (stored.length > 0) {
    ctx.goalProjector.apply(stored)
    ctx.events.saveCheckpoint('goals', ctx.events.maxPosition())
  }

  return stored
}

export function createMetadata(
  source: EventMetadata['source'],
  extra: Partial<EventMetadata> = {},
): EventMetadata {
  const commandId = crypto.randomUUID()
  return {
    commandId,
    correlationId: commandId,
    source,
    schemaVersion: 1,
    ...extra,
  }
}

/** Wraps a command body in a transaction. */
export function runCommand<T>(ctx: AppContext, fn: () => T): T {
  return withTransaction(ctx, fn)
}
