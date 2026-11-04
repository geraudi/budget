import { eq } from "drizzle-orm"

import { coachRecommendations, financialGoals } from "#/db/schema"
import type { CoachRecommendationKind } from "#/domain/goals/recommendation"
import type { CoachRecommendationPayload } from "#/domain/goals/recommendation"
import { parseGoalMonth } from "#/domain/goals/validation"
import type { AppContext } from "#/infrastructure/context"

export type RecordRecommendationInput = {
  period: { from: string; to: string }
  goalId: number | null
  kind: CoachRecommendationKind
  payload: CoachRecommendationPayload
}

const KINDS: ReadonlyArray<CoachRecommendationKind> = [
  "assessment",
  "goal_plan",
  "follow_up",
]

/**
 * Appends a recommendation to the immutable journal.
 *
 * This is not an event-sourced aggregate: no projector, no replay, no
 * update. A second call always creates a second row.
 */
export function recordRecommendation(
  ctx: AppContext,
  input: RecordRecommendationInput,
): { id: number } {
  const from = parseGoalMonth(input.period.from, "Mois de début")
  const to = parseGoalMonth(input.period.to, "Mois de fin")
  if (from > to) {
    throw new Error(`Période inversée : ${from} → ${to}`)
  }
  if (!KINDS.includes(input.kind)) {
    throw new Error("Type de recommandation invalide")
  }

  if (input.goalId !== null) {
    if (!Number.isInteger(input.goalId) || input.goalId <= 0) {
      throw new Error("Identifiant d’objectif invalide")
    }
    const goal = ctx.db
      .select({ id: financialGoals.id })
      .from(financialGoals)
      .where(eq(financialGoals.id, input.goalId))
      .get()
    if (!goal) throw new Error(`Objectif introuvable : ${input.goalId}`)
  }

  const [row] = ctx.db
    .insert(coachRecommendations)
    .values({
      periodFrom: from,
      periodTo: to,
      goalId: input.goalId,
      kind: input.kind,
      payload: input.payload,
    })
    .returning({ id: coachRecommendations.id })
    .all()

  return { id: row!.id }
}
