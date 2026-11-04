import { createServerFn } from '@tanstack/react-start'

import {
  loadAnalyticsOperations,
  parseMonthInput,
  resolveCoachPeriod,
} from '#/application/queries/coach'
import {
  buildRecommendationPayload,
  listGoalProgress,
  type GoalProgress,
} from '#/application/queries/goals'
import { computeIndicators } from '#/domain/analytics'
import type { CoachRecommendationKind } from '#/domain/goals/recommendation'
import type { GoalState } from '#/domain/goals/types'
import { createGoal as createGoalCommand } from '#/application/commands/create-goal'
import { recordGoalContribution as recordGoalContributionCommand } from '#/application/commands/record-goal-contribution'
import { recordRecommendation as recordRecommendationCommand } from '#/application/commands/record-recommendation'
import { updateGoal as updateGoalCommand } from '#/application/commands/update-goal'
import { getContext } from '#/infrastructure/app-context'

export type { GoalProgress }

const KINDS: ReadonlyArray<CoachRecommendationKind> = [
  'assessment',
  'goal_plan',
  'follow_up',
]

function asObject(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') throw new Error('Données invalides')
  return data as Record<string, unknown>
}

function toId(value: unknown, label = 'Identifiant'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} invalide`)
  }
  return value
}

function toIdOrNull(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} invalide`)
  }
  return value
}

function toStringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} requis`)
  }
  return value.trim()
}

function toNumberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} invalide`)
  }
  return value
}

function parsePeriod(data: unknown): {
  from: string | null
  to: string | null
} {
  if (data === null || data === undefined) return { from: null, to: null }
  const d = asObject(data)
  return {
    from: parseMonthInput(d.from, 'Mois de début'),
    to: parseMonthInput(d.to, 'Mois de fin'),
  }
}

/** Read-only goal progress for the dashboard. */
export const getGoalProgress = createServerFn({ method: 'GET' })
  .validator(parsePeriod)
  .handler(({ data }): GoalProgress[] => {
    const ctx = getContext()
    const period = resolveCoachPeriod(ctx.db, data)
    const indicators = computeIndicators(
      loadAnalyticsOperations(ctx.db),
      period,
    )
    return listGoalProgress(ctx, { period, indicators })
  })

export const createGoal = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = asObject(data)
    const initialSavedAmount =
      d.initialSavedAmount === null || d.initialSavedAmount === undefined
        ? 0
        : toNumberValue(d.initialSavedAmount, 'Montant déjà épargné')

    return {
      label: toStringValue(d.label, 'Libellé d’objectif'),
      targetAmount: toNumberValue(d.targetAmount, 'Montant cible'),
      targetMonth: toStringValue(d.targetMonth, 'Mois cible'),
      startMonth: toStringValue(d.startMonth, 'Mois de départ'),
      initialSavedAmount,
    }
  })
  .handler(({ data }) => createGoalCommand(getContext(), data))

export const updateGoal = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = asObject(data)
    const status = d.status
    if (
      status !== undefined &&
      status !== 'active' &&
      status !== 'paused' &&
      status !== 'abandoned'
    ) {
      throw new Error('Statut d’objectif invalide')
    }

    return {
      id: toId(d.id),
      ...(d.label === undefined
        ? {}
        : { label: toStringValue(d.label, 'Libellé d’objectif') }),
      ...(d.targetAmount === undefined
        ? {}
        : {
            targetAmount: toNumberValue(d.targetAmount, 'Montant cible'),
          }),
      ...(d.targetMonth === undefined
        ? {}
        : { targetMonth: toStringValue(d.targetMonth, 'Mois cible') }),
      ...(status === undefined
        ? {}
        : { status: status as 'active' | 'paused' | 'abandoned' }),
    }
  })
  .handler(({ data }): GoalState => updateGoalCommand(getContext(), data))

export const recordGoalContribution = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = asObject(data)
    return {
      id: toId(d.id),
      amount: toNumberValue(d.amount, 'Montant de contribution'),
      month: toStringValue(d.month, 'Mois de contribution'),
    }
  })
  .handler(({ data }): GoalState =>
    recordGoalContributionCommand(getContext(), data),
  )

/**
 * Saves the current, server-computed recommendation for a period.
 *
 * The payload is rebuilt here from the verified indicators and goals; the
 * model output is never parsed, and the client cannot inject a figure.
 */
export const recordCoachRecommendation = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = asObject(data)
    const period = parsePeriod(d)
    const kind = d.kind ?? 'assessment'
    if (
      typeof kind !== 'string' ||
      !KINDS.includes(kind as CoachRecommendationKind)
    ) {
      throw new Error('Type de recommandation invalide')
    }

    return {
      ...period,
      goalId: toIdOrNull(d.goalId, 'Objectif'),
      kind: kind as CoachRecommendationKind,
    }
  })
  .handler(({ data }) => {
    const ctx = getContext()
    const period = resolveCoachPeriod(ctx.db, data)
    const indicators = computeIndicators(
      loadAnalyticsOperations(ctx.db),
      period,
    )
    const progress = listGoalProgress(ctx, { period, indicators })
    const goal = data.goalId
      ? progress.find((item) => item.id === data.goalId) ?? null
      : null
    const payload = buildRecommendationPayload({
      period,
      indicators,
      progress,
      goal,
    })

    return recordRecommendationCommand(ctx, {
      period,
      goalId: goal?.id ?? null,
      kind: data.kind,
      payload,
    })
  })
