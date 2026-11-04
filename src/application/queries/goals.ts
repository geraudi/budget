import { financialGoals } from "#/db/schema"
import type { GoalEvent, GoalStatus } from "#/domain/goals"
import type { StoredGoalEvent } from "#/domain/goals/events"
import { goalStreamId } from "#/domain/goals/goal"
import { round2 } from "#/domain/goals/money"
import type {
  CoachRecommendationGoal,
  CoachRecommendationPayload,
} from "#/domain/goals/recommendation"
import type {
  AnalyticsIndicators,
  AnalyticsPeriod,
} from "#/domain/analytics/types"
import type { AppContext } from "#/infrastructure/context"

export type GoalRealismReason =
  | "achieved"
  | "no-qualified-income"
  | "negative-capacity"
  | "insufficient-history"
  | "effort-above-capacity"
  | "overdue"

export type GoalProgress = {
  id: number
  label: string
  status: GoalStatus
  targetAmount: number
  savedAmount: number
  remaining: number
  progress: number // 0..1
  targetMonth: string
  monthsRemaining: number
  monthlyEffort: number
  observedMonthlyCapacity: number
  alternativeMonthlyEffort: number
  realistic: boolean
  reasons: GoalRealismReason[]
  savedInPeriod: number
  overdue: boolean
}

export type GoalCoachView = Pick<
  GoalProgress,
  | "id"
  | "label"
  | "status"
  | "targetAmount"
  | "savedAmount"
  | "remaining"
  | "targetMonth"
  | "monthsRemaining"
  | "monthlyEffort"
  | "observedMonthlyCapacity"
  | "alternativeMonthlyEffort"
  | "realistic"
  | "reasons"
  | "savedInPeriod"
>

export type GoalRecord = typeof financialGoals.$inferSelect

const euros = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
})

function formatEuros(value: number): string {
  return `${euros.format(value)} €`
}

/** Nombre de mois entiers entre deux `YYYY-MM` (négatif si `to` précède `from`). */
export function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number)
  const [toYear, toMonth] = to.split("-").map(Number)
  return (toYear - fromYear) * 12 + (toMonth - fromMonth)
}

/**
 * Observed monthly capacity.
 *
 * `dataQuality.monthsAvailable` counts months actually covered by operations,
 * not the length of the requested period, so a partial history cannot inflate
 * the capacity.
 */
export function observedMonthlyCapacity(
  indicators: AnalyticsIndicators,
): number {
  const months = indicators.dataQuality.monthsAvailable
  if (months <= 0) return 0
  return round2(indicators.savings.observed / months)
}

function realismReasons(
  goal: GoalRecord,
  input: {
    remaining: number
    overdue: boolean
    monthlyEffort: number
    capacity: number
    indicators: AnalyticsIndicators
  },
): GoalRealismReason[] {
  const { remaining, overdue, monthlyEffort, capacity, indicators } = input

  if (goal.status === "achieved" || remaining === 0) return ["achieved"]

  const reasons: GoalRealismReason[] = []

  const qualifiedIncome =
    indicators.income.recurring + indicators.income.other
  if (qualifiedIncome <= 0) reasons.push("no-qualified-income")
  if (capacity <= 0) reasons.push("negative-capacity")
  if (indicators.dataQuality.monthsAvailable < 3) {
    reasons.push("insufficient-history")
  }
  if (capacity > 0 && monthlyEffort > capacity) {
    reasons.push("effort-above-capacity")
  }
  if (overdue) reasons.push("overdue")

  return reasons
}

export function computeGoalProgress(
  goal: GoalRecord,
  contributions: ReadonlyArray<{ amount: number; month: string }>,
  input: {
    asOfMonth: string
    period: AnalyticsPeriod
    indicators: AnalyticsIndicators
  },
): GoalProgress {
  const remaining = round2(Math.max(0, goal.targetAmount - goal.savedAmount))
  const progress =
    goal.targetAmount > 0
      ? Math.min(1, goal.savedAmount / goal.targetAmount)
      : 0
  const monthsRemaining = Math.max(
    0,
    monthsBetween(input.asOfMonth, goal.targetMonth),
  )
  const overdue = goal.targetMonth < input.asOfMonth && remaining > 0
  const monthlyEffort =
    remaining === 0
      ? 0
      : monthsRemaining > 0
        ? round2(remaining / monthsRemaining)
        : remaining
  const capacity = observedMonthlyCapacity(input.indicators)
  const alternativeMonthlyEffort =
    capacity > 0 ? round2(Math.min(monthlyEffort, capacity)) : 0
  const savedInPeriod = round2(
    contributions
      .filter(
        (contribution) =>
          contribution.month >= input.period.from &&
          contribution.month <= input.period.to,
      )
      .reduce((sum, contribution) => sum + contribution.amount, 0),
  )

  const reasons = realismReasons(goal, {
    remaining,
    overdue,
    monthlyEffort,
    capacity,
    indicators: input.indicators,
  })

  return {
    id: goal.id,
    label: goal.label,
    status: goal.status,
    targetAmount: goal.targetAmount,
    savedAmount: goal.savedAmount,
    remaining,
    progress,
    targetMonth: goal.targetMonth,
    monthsRemaining,
    monthlyEffort,
    observedMonthlyCapacity: capacity,
    alternativeMonthlyEffort,
    realistic: !reasons.includes("achieved") && reasons.length === 0,
    reasons,
    savedInPeriod,
    overdue,
  }
}

/** Reads the goal projection; commands fold the event streams instead. */
export function loadGoalRecords(ctx: AppContext): GoalRecord[] {
  return ctx.db.select().from(financialGoals).all()
}

export function loadGoalContributions(
  ctx: AppContext,
  goalId: number,
): Array<{ amount: number; month: string }> {
  return ctx.events
    .readStream<GoalEvent>(goalStreamId(goalId))
    .filter(
      (event): event is StoredGoalEvent & {
        type: "GoalContributionRecorded"
      } => event.type === "GoalContributionRecorded",
    )
    .map((event) => event.payload)
}

export function listGoalProgress(
  ctx: AppContext,
  input: { period: AnalyticsPeriod; indicators: AnalyticsIndicators },
): GoalProgress[] {
  return loadGoalRecords(ctx)
    .map((goal) =>
      computeGoalProgress(goal, loadGoalContributions(ctx, goal.id), {
        asOfMonth: input.period.to,
        period: input.period,
        indicators: input.indicators,
      }),
    )
    .sort((a, b) => {
      const activeRank = (goal: GoalProgress): number =>
        goal.status === "active" ? 0 : 1
      return (
        activeRank(a) - activeRank(b) ||
        a.targetMonth.localeCompare(b.targetMonth) ||
        a.id - b.id
      )
    })
}

/** Drops the progress ratio: the model does not need it. */
export function toGoalCoachView(goal: GoalProgress): GoalCoachView {
  return {
    id: goal.id,
    label: goal.label,
    status: goal.status,
    targetAmount: goal.targetAmount,
    savedAmount: goal.savedAmount,
    remaining: goal.remaining,
    targetMonth: goal.targetMonth,
    monthsRemaining: goal.monthsRemaining,
    monthlyEffort: goal.monthlyEffort,
    observedMonthlyCapacity: goal.observedMonthlyCapacity,
    alternativeMonthlyEffort: goal.alternativeMonthlyEffort,
    realistic: goal.realistic,
    reasons: goal.reasons,
    savedInPeriod: goal.savedInPeriod,
  }
}

function toRecommendationGoal(goal: GoalProgress): CoachRecommendationGoal {
  return {
    id: goal.id,
    label: goal.label,
    targetAmount: goal.targetAmount,
    savedAmount: goal.savedAmount,
    remaining: goal.remaining,
    targetMonth: goal.targetMonth,
    monthlyEffort: goal.monthlyEffort,
    observedMonthlyCapacity: goal.observedMonthlyCapacity,
    alternativeMonthlyEffort: goal.alternativeMonthlyEffort,
    realistic: goal.realistic,
    reasons: goal.reasons,
  }
}

function translateReason(
  reason: GoalRealismReason,
  goal: GoalProgress,
  monthsAvailable: number,
): string {
  switch (reason) {
    case "achieved":
      return `L’objectif « ${goal.label} » est atteint.`
    case "no-qualified-income":
      return "Aucun revenu qualifié sur la période : un effort d’épargne n’est pas interprétable."
    case "negative-capacity":
      return "La capacité d’épargne observée est nulle ou négative : stabilisez le budget avant d’épargner."
    case "insufficient-history":
      return `L’historique ne couvre que ${monthsAvailable} mois : l’effort mensuel est une estimation.`
    case "effort-above-capacity":
      return `L’objectif « ${goal.label} » demande ${formatEuros(
        goal.monthlyEffort,
      )}/mois, au-dessus de la capacité observée ${formatEuros(
        goal.observedMonthlyCapacity,
      )}/mois.`
    case "overdue":
      return `L’échéance de l’objectif « ${goal.label} » est passée : il faut le replanifier.`
  }
}

/**
 * Builds the deterministic payload stored in `coach_recommendations`.
 *
 * Pure on purpose: no SQLite, no model output, no operation labels.
 */
export function buildRecommendationPayload(input: {
  period: AnalyticsPeriod
  indicators: AnalyticsIndicators
  progress: ReadonlyArray<GoalProgress>
  goal: GoalProgress | null
}): CoachRecommendationPayload {
  const { period, indicators, progress, goal } = input
  const capacity = Math.max(0, observedMonthlyCapacity(indicators))
  const scopedGoals = goal ? [goal] : progress
  const rationale = [
    ...new Set(
      scopedGoals.flatMap((item) =>
        item.reasons.map((reason) =>
          translateReason(
            reason,
            item,
            indicators.dataQuality.monthsAvailable,
          ),
        ),
      ),
    ),
  ]

  return {
    schemaVersion: 1,
    period: { from: period.from, to: period.to },
    indicators: {
      income: {
        recurring: indicators.income.recurring,
        other: indicators.income.other,
        unqualified: indicators.income.unqualified,
        total: indicators.income.total,
      },
      expenses: {
        essential: indicators.expenses.essential,
        discretionary: indicators.expenses.discretionary,
        exceptional: indicators.expenses.exceptional,
        unqualified: indicators.expenses.unqualified,
        total: indicators.expenses.total,
      },
      savings: {
        observed: indicators.savings.observed,
        rate: indicators.savings.rate,
      },
      dataQuality: {
        monthsAvailable: indicators.dataQuality.monthsAvailable,
        unqualifiedIncomeShare:
          indicators.dataQuality.unqualifiedIncomeShare,
        warnings: [...indicators.dataQuality.warnings],
      },
    },
    goals: progress.map(toRecommendationGoal),
    recommendedMonthlyEffort: goal
      ? goal.alternativeMonthlyEffort
      : capacity,
    rationale,
  }
}
