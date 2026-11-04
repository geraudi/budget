import { createServerFn } from '@tanstack/react-start'

import {
  buildCoachContext,
  parseMonthInput,
  type CoachSource,
} from '#/application/queries/coach'
import type { AnalyticsIndicators } from '#/domain/analytics'
import { getContext } from '#/infrastructure/app-context'

export type { CoachSource }

const MAX_QUESTION_LENGTH = 4_000

function parsePeriod(data: unknown): {
  from: string | null
  to: string | null
} {
  if (data === null || data === undefined) return { from: null, to: null }
  if (typeof data !== 'object') throw new Error('Données invalides')

  const d = data as Record<string, unknown>
  return {
    from: parseMonthInput(d.from, 'Mois de début'),
    to: parseMonthInput(d.to, 'Mois de fin'),
  }
}

function parseQuestion(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Question requise')
  }
  const question = value.trim()
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new Error(`Question trop longue (${MAX_QUESTION_LENGTH} caractères max)`)
  }
  return question
}

/**
 * Read-only indicators for the dashboard. The model is not involved: the UI
 * renders exactly the JSON produced by `computeIndicators`.
 */
export const getCoachIndicators = createServerFn({ method: 'GET' })
  .validator(parsePeriod)
  .handler(async ({ data }): Promise<AnalyticsIndicators> => {
    const ctx = getContext()
    return (await buildCoachContext(ctx, {
      from: data.from,
      to: data.to,
      question: '',
    })).indicators
  })

/**
 * Knowledge cards retrieved for a question. Exposed separately from the chat
 * stream so the UI can cite the sources without parsing the Markdown answer.
 */
export const getCoachSources = createServerFn({ method: 'POST' })
  .validator((data: unknown): {
    question: string
    from: string | null
    to: string | null
  } => {
    if (!data || typeof data !== 'object') throw new Error('Données invalides')
    const d = data as Record<string, unknown>
    const period = parsePeriod(d)
    return { ...period, question: parseQuestion(d.question) }
  })
  .handler(async ({ data }): Promise<CoachSource[]> => {
    const ctx = getContext()
    return (await buildCoachContext(ctx, {
      from: data.from,
      to: data.to,
      question: data.question,
    })).sources
  })
