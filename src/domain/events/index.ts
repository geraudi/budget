import type { GoalEvent } from "#/domain/goals/events"
import type { OperationEvent } from "#/domain/operations/events"
import type { StoredEvent } from "./envelope"

export type AnyEvent = OperationEvent | GoalEvent

export type AnyStoredEvent = StoredEvent<AnyEvent>
