import { foldGoal, goalStreamId } from "#/domain/goals/goal"
import type { GoalEvent, GoalState } from "#/domain/goals"
import type { AppContext } from "#/infrastructure/context"

/** Replays a goal stream and rejects missing aggregates. */
export function loadGoal(ctx: AppContext, id: number): GoalState {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Identifiant d’objectif invalide")
  }

  const state = foldGoal(ctx.events.readStream<GoalEvent>(goalStreamId(id)))
  if (!state) throw new Error(`Objectif introuvable : ${id}`)
  return state
}
