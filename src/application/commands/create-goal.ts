import {
  appendGoalAndProject,
  createMetadata,
  runCommand,
} from "./append"
import { decideCreate, goalStreamId } from "#/domain/goals/goal"
import type { GoalDetails } from "#/domain/goals/types"
import type { AppContext } from "#/infrastructure/context"

export type CreateGoalInput = {
  label: string
  targetAmount: number
  targetMonth: string
  startMonth: string
  initialSavedAmount?: number
}

/** Creates a goal and its projection row in one transaction. */
export function createGoal(
  ctx: AppContext,
  input: CreateGoalInput,
): { id: number } {
  const details: GoalDetails = {
    label: input.label,
    targetAmount: input.targetAmount,
    targetMonth: input.targetMonth,
    startMonth: input.startMonth,
    initialSavedAmount: input.initialSavedAmount ?? 0,
  }

  return runCommand(ctx, () => {
    const events = decideCreate(details)
    const id = ctx.events.nextId("goal")

    appendGoalAndProject(ctx, {
      streamId: goalStreamId(id),
      expectedVersion: 0,
      events: events.map((event) => ({
        ...event,
        metadata: createMetadata("ui"),
      })),
    })

    return { id }
  })
}
