import { eq } from "drizzle-orm"

import type { AppDb } from "#/db/create"
import { financialGoals } from "#/db/schema"
import {
  goalIdFromStream,
} from "#/domain/goals/goal"
import { round2 } from "#/domain/goals/money"
import type { StoredGoalEvent } from "#/domain/goals/events"

/**
 * Inline projector for the `financial_goals` read model.
 *
 * `savedAmount` is derived exclusively from contribution events, and
 * `createdAt` / `updatedAt` come from `occurredAt` so a rebuild is
 * deterministic. Commands never write this table directly.
 */
export function createGoalProjector(db: AppDb) {
  return {
    apply(events: ReadonlyArray<StoredGoalEvent>): void {
      for (const event of events) {
        if (event.streamType !== "goal") continue
        const id = goalIdFromStream(event.streamId)

        switch (event.type) {
          case "GoalCreated":
            db.insert(financialGoals)
              .values({
                id,
                label: event.payload.label,
                targetAmount: event.payload.targetAmount,
                savedAmount: event.payload.initialSavedAmount,
                targetMonth: event.payload.targetMonth,
                startMonth: event.payload.startMonth,
                status:
                  event.payload.initialSavedAmount >= event.payload.targetAmount
                    ? "achieved"
                    : "active",
                createdAt: event.occurredAt,
                updatedAt: event.occurredAt,
              })
              .run()
            break

          case "GoalUpdated":
            db.update(financialGoals)
              .set({ ...event.payload, updatedAt: event.occurredAt })
              .where(eq(financialGoals.id, id))
              .run()
            break

          case "GoalContributionRecorded": {
            const current = db
              .select({ savedAmount: financialGoals.savedAmount })
              .from(financialGoals)
              .where(eq(financialGoals.id, id))
              .get()
            if (!current) {
              throw new Error(
                `Objectif introuvable dans la projection : ${id}`,
              )
            }
            db.update(financialGoals)
              .set({
                savedAmount: round2(
                  current.savedAmount + event.payload.amount,
                ),
                updatedAt: event.occurredAt,
              })
              .where(eq(financialGoals.id, id))
              .run()
            break
          }
        }
      }
    },
  }
}

export type GoalProjector = ReturnType<typeof createGoalProjector>
