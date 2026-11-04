export type CoachRecommendationKind = "assessment" | "goal_plan" | "follow_up"

export type CoachRecommendationGoal = {
  id: number
  label: string
  targetAmount: number
  savedAmount: number
  remaining: number
  targetMonth: string
  monthlyEffort: number
  observedMonthlyCapacity: number
  alternativeMonthlyEffort: number
  realistic: boolean
  reasons: string[]
}

/**
 * Immutable journal entry written when the user explicitly saves a
 * recommendation.
 *
 * It only contains aggregates and user-entered goal labels: no merchant
 * label, no operation reference and no `topExpenses`.
 */
export type CoachRecommendationPayload = {
  schemaVersion: 1
  period: { from: string; to: string }
  indicators: {
    income: {
      recurring: number
      other: number
      unqualified: number
      total: number
    }
    expenses: {
      essential: number
      discretionary: number
      exceptional: number
      unqualified: number
      total: number
    }
    savings: { observed: number; rate: number }
    dataQuality: {
      monthsAvailable: number
      unqualifiedIncomeShare: number
      warnings: string[]
    }
  }
  goals: CoachRecommendationGoal[]
  /** Effort recommandé pour le `goalId` visé, sinon capacité mensuelle observée. */
  recommendedMonthlyEffort: number | null
  /** Justifications déterministes, en français, sans libellé bancaire. */
  rationale: string[]
}
