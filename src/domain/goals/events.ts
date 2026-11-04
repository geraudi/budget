import type { NewEvent, StoredEvent } from "#/domain/events/envelope"
import type { GoalDetails, GoalPatch } from "./types"

export type { EventMetadata } from "#/domain/events/envelope"

export type GoalEvent =
  | { type: "GoalCreated"; payload: GoalDetails }
  | { type: "GoalUpdated"; payload: GoalPatch }
  | {
      type: "GoalContributionRecorded"
      payload: { amount: number; month: string } // amount signé, month YYYY-MM
    }

export type GoalEventType = GoalEvent["type"]

export type NewGoalEvent = NewEvent<GoalEvent>

export type StoredGoalEvent = StoredEvent<GoalEvent>
