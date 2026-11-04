import type {
  GoalDetails,
  GoalPatch,
  GoalState,
  GoalStatus,
} from "./types"
import type { GoalEvent, StoredGoalEvent } from "./events"
import { round2 } from "./money"
import {
  parseGoalMonth,
  validateContribution,
  validateGoalAmount,
  validateGoalLabel,
  validateGoalPatch,
  validateNonNegativeAmount,
} from "./validation"

const STREAM_PREFIX = "goal:"

export function goalStreamId(id: number): string {
  return `${STREAM_PREFIX}${id}`
}

export function goalIdFromStream(streamId: string): number {
  const match = new RegExp(`^${STREAM_PREFIX}(\\d+)$`).exec(streamId)
  if (!match) throw new Error(`Flux d’objectif invalide : ${streamId}`)
  return Number(match[1])
}

/** Folds a goal stream into the current aggregate state. */
export function foldGoal(
  events: ReadonlyArray<StoredGoalEvent>,
): GoalState | null {
  return events.reduce<GoalState | null>(
    (state, event) => evolve(state, event),
    null,
  )
}

export function evolve(
  state: GoalState | null,
  event: StoredGoalEvent,
): GoalState {
  switch (event.type) {
    case "GoalCreated":
      return {
        id: goalIdFromStream(event.streamId),
        label: event.payload.label,
        targetAmount: event.payload.targetAmount,
        savedAmount: event.payload.initialSavedAmount,
        targetMonth: event.payload.targetMonth,
        startMonth: event.payload.startMonth,
        status:
          event.payload.initialSavedAmount >= event.payload.targetAmount
            ? "achieved"
            : "active",
        version: event.streamVersion,
      }
    case "GoalUpdated": {
      if (!state) throw new Error("État d’objectif manquant")
      return {
        ...state,
        ...event.payload,
        version: event.streamVersion,
      }
    }
    case "GoalContributionRecorded": {
      if (!state) throw new Error("État d’objectif manquant")
      return {
        ...state,
        savedAmount: round2(state.savedAmount + event.payload.amount),
        version: event.streamVersion,
      }
    }
  }
}

function assertMonthOrder(targetMonth: string, startMonth: string): void {
  if (targetMonth < startMonth) {
    throw new Error(
      "Le mois cible doit être postérieur ou égal au mois de départ",
    )
  }
}

/** Validates a creation command and returns the single creation event. */
export function decideCreate(details: GoalDetails): GoalEvent[] {
  const label = validateGoalLabel(details.label)
  const targetAmount = validateGoalAmount(details.targetAmount, "Montant cible")
  const targetMonth = parseGoalMonth(details.targetMonth, "Mois cible")
  const startMonth = parseGoalMonth(details.startMonth, "Mois de départ")
  const initialSavedAmount = validateNonNegativeAmount(
    details.initialSavedAmount,
    "Montant déjà épargné",
  )

  assertMonthOrder(targetMonth, startMonth)
  if (initialSavedAmount > targetAmount) {
    throw new Error("Le montant déjà épargné ne peut pas dépasser la cible")
  }

  return [
    {
      type: "GoalCreated",
      payload: {
        label,
        targetAmount,
        targetMonth,
        startMonth,
        initialSavedAmount,
      },
    },
  ]
}

/** Emits only the fields that actually change the aggregate. */
export function decideUpdate(
  state: GoalState,
  input: GoalPatch,
): GoalEvent[] {
  const patch = validateGoalPatch(input)

  if (patch.status === "achieved") {
    throw new Error("Le statut « atteint » est dérivé d’une contribution")
  }

  const nextLabel = patch.label ?? state.label
  const nextTargetAmount = patch.targetAmount ?? state.targetAmount
  const nextTargetMonth = patch.targetMonth ?? state.targetMonth

  assertMonthOrder(nextTargetMonth, state.startMonth)

  const changes: GoalPatch = {}
  if (nextLabel !== state.label) changes.label = nextLabel
  if (nextTargetAmount !== state.targetAmount) {
    changes.targetAmount = nextTargetAmount
  }
  if (nextTargetMonth !== state.targetMonth) {
    changes.targetMonth = nextTargetMonth
  }

  if (patch.status !== undefined) {
    if (patch.status !== state.status) changes.status = patch.status
  } else if (
    state.status === "achieved" &&
    nextTargetAmount > state.savedAmount
  ) {
    // Raising the target reopens an achieved goal; an explicit status wins.
    changes.status = "active"
  }

  if (Object.keys(changes).length === 0) return []
  return [{ type: "GoalUpdated", payload: changes }]
}

export function decideContribution(
  state: GoalState,
  input: { amount: number; month: string },
): GoalEvent[] {
  const { amount, month } = validateContribution(input)

  if (state.status !== "active") {
    throw new Error("Cet objectif n’accepte plus de contribution")
  }

  const nextSavedAmount = round2(state.savedAmount + amount)
  if (nextSavedAmount < 0) {
    throw new Error("Une contribution ne peut pas rendre l’épargne négative")
  }

  const events: GoalEvent[] = [
    { type: "GoalContributionRecorded", payload: { amount, month } },
  ]

  if (nextSavedAmount >= state.targetAmount) {
    const status: GoalStatus = "achieved"
    events.push({ type: "GoalUpdated", payload: { status } })
  }

  return events
}
