import {
  appendGoalAndProject,
  createMetadata,
  runCommand,
} from "./append"
import { loadGoal } from "./load-goal"
import { decideUpdate, goalStreamId } from "#/domain/goals/goal"
import type { GoalPatch, GoalState } from "#/domain/goals"
import { validateGoalPatch } from "#/domain/goals/validation"
import type { AppContext } from "#/infrastructure/context"

export type UpdateGoalInput = {
  id: number
  label?: string
  targetAmount?: number
  targetMonth?: string
  status?: "active" | "paused" | "abandoned"
}

/** Updates an existing goal, emitting only the changed fields. */
export function updateGoal(
  ctx: AppContext,
  input: UpdateGoalInput,
): GoalState {
  const patch: GoalPatch = validateGoalPatch({
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.targetAmount === undefined
      ? {}
      : { targetAmount: input.targetAmount }),
    ...(input.targetMonth === undefined
      ? {}
      : { targetMonth: input.targetMonth }),
    ...(input.status === undefined ? {} : { status: input.status }),
  })

  return runCommand(ctx, () => {
    const state = loadGoal(ctx, input.id)
    const events = decideUpdate(state, patch)

    if (events.length === 0) return state

    appendGoalAndProject(ctx, {
      streamId: goalStreamId(state.id),
      expectedVersion: state.version,
      events: events.map((event) => ({
        ...event,
        metadata: createMetadata("ui"),
      })),
    })

    return loadGoal(ctx, state.id)
  })
}
