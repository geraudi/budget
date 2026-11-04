import type { GoalPatch, GoalStatus } from "./types"
import { round2 } from "./money"

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const MAX_LABEL_LENGTH = 80
const GOAL_STATUSES: ReadonlyArray<GoalStatus> = [
  "active",
  "paused",
  "achieved",
  "abandoned",
]

export function parseGoalMonth(value: unknown, label: string): string {
  if (typeof value !== "string" || !MONTH_PATTERN.test(value)) {
    throw new Error(`${label} invalide (format YYYY-MM attendu)`)
  }
  return value
}

export function validateGoalLabel(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Libellé d’objectif requis (80 caractères max)")
  }
  const label = value.trim()
  if (label.length > MAX_LABEL_LENGTH) {
    throw new Error("Libellé d’objectif requis (80 caractères max)")
  }
  return label
}

export function validateGoalAmount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} invalide (montant positif attendu)`)
  }
  return round2(value)
}

export function validateNonNegativeAmount(
  value: unknown,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} invalide (montant positif ou nul attendu)`)
  }
  return round2(value)
}

export function validateGoalStatus(value: unknown): GoalStatus {
  if (typeof value !== "string" || !GOAL_STATUSES.includes(value as GoalStatus)) {
    throw new Error("Statut d’objectif invalide")
  }
  return value as GoalStatus
}

export function validateGoalPatch(value: unknown): GoalPatch {
  if (value === null || typeof value !== "object") {
    throw new Error("Modifications d’objectif invalides")
  }

  const input = value as Record<string, unknown>
  const patch: GoalPatch = {}

  if (input.label !== undefined) patch.label = validateGoalLabel(input.label)
  if (input.targetAmount !== undefined) {
    patch.targetAmount = validateGoalAmount(
      input.targetAmount,
      "Montant cible",
    )
  }
  if (input.targetMonth !== undefined) {
    patch.targetMonth = parseGoalMonth(input.targetMonth, "Mois cible")
  }
  if (input.status !== undefined) patch.status = validateGoalStatus(input.status)

  return patch
}

export function validateContribution(value: unknown): {
  amount: number
  month: string
} {
  if (value === null || typeof value !== "object") {
    throw new Error("Contribution invalide")
  }

  const input = value as Record<string, unknown>
  const amount = input.amount
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error("Montant de contribution invalide")
  }
  const rounded = round2(amount)
  if (rounded === 0) {
    throw new Error("Une contribution ne peut pas être nulle")
  }

  return {
    amount: rounded,
    month: parseGoalMonth(input.month, "Mois de contribution"),
  }
}
