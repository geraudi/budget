import {
  appendGoalAndProject,
  createMetadata,
  runCommand,
} from "./append"
import { loadGoal } from "./load-goal"
import {
  decideContribution,
  goalStreamId,
} from "#/domain/goals/goal"
import type { GoalState } from "#/domain/goals"
import { validateContribution } from "#/domain/goals/validation"
import type { AppContext } from "#/infrastructure/context"

export type RecordGoalContributionInput = {
  id: number
  amount: number // signé
  month: string // YYYY-MM
}

/** Records a signed contribution and marks the goal achieved if reached. */
export function recordGoalContribution(
  ctx: AppContext,
  input: RecordGoalContributionInput,
): GoalState {
  const contribution = validateContribution({
    amount: input.amount,
    month: input.month,
  })

  return runCommand(ctx, () => {
    const state = loadGoal(ctx, input.id)
    const events = decideContribution(state, contribution)

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
