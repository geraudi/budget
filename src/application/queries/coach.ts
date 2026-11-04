import { eq } from 'drizzle-orm'

import { categories, operations } from '#/db/schema'
import type { AppDb } from '#/db/create'
import {
  computeIndicators,
  type AnalyticsIndicators,
  type AnalyticsOperation,
  type AnalyticsPeriod,
} from '#/domain/analytics'
import { formatKnowledgeContext } from '#/domain/knowledge/search'
import type { AppContext } from '#/infrastructure/context'
import {
  retrieveKnowledge,
  type KnowledgeRetriever,
} from '#/infrastructure/knowledge/retrieval'
import {
  listGoalProgress,
  toGoalCoachView,
  type GoalCoachView,
} from './goals'

/** A knowledge card cited in the answer, shaped for the UI. */
export type CoachSource = {
  id: string
  title: string
  source: string
  reviewRequired: boolean
}

export type CoachContext = {
  /** Versioned indicator payload; the coach model only restates these values. */
  indicators: AnalyticsIndicators
  /** Server-persisted goals, already scored against the requested period. */
  goals: GoalCoachView[]
  /** Cards retrieved for the question, for citation in the UI. */
  sources: CoachSource[]
  /** Formatted cards injected in the model prompt; empty without a question. */
  knowledgeBlock: string
}

export type CoachPeriodInput = {
  from?: string | null
  to?: string | null
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isAnalyticsMonth(value: string): boolean {
  return MONTH_PATTERN.test(value)
}

/** Validates an optional `YYYY-MM` transport value. */
export function parseMonthInput(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) {
    throw new Error(`${label} invalide (format YYYY-MM attendu)`)
  }
  return value
}

/**
 * Loads the minimal operation projection used by the indicators.
 *
 * The whole table is loaded (a few hundred rows) and `computeIndicators`
 * filters on the period itself, so there is a single definition of the range.
 */
export function loadAnalyticsOperations(db: AppDb): AnalyticsOperation[] {
  return db
    .select({
      id: operations.id,
      date: operations.dateComptabilisation,
      montant: operations.montant,
      kind: operations.kind,
      nature: operations.nature,
      categoryId: operations.categoryId,
      subCategoryId: operations.subCategoryId,
      categoryLabel: categories.name,
      libelleSimplifie: operations.libelleSimplifie,
      isRecurring: operations.isRecurring,
      classificationSource: operations.classificationSource,
      classificationConfidence: operations.classificationConfidence,
    })
    .from(operations)
    .leftJoin(categories, eq(operations.categoryId, categories.id))
    .all()
}

/** Months present in the database, oldest first. */
export function availableAnalyticsMonths(db: AppDb): string[] {
  const rows = db
    .select({ date: operations.dateComptabilisation })
    .from(operations)
    .all()

  return [
    ...new Set(
      rows
        .map((row) => row.date.slice(0, 7))
        .filter((month) => MONTH_PATTERN.test(month)),
    ),
  ].sort()
}

/**
 * Resolves the displayed period. Missing bounds default to the months present
 * in the database, never to a hard-coded range.
 */
export function resolveCoachPeriod(
  db: AppDb,
  input: CoachPeriodInput = {},
): AnalyticsPeriod {
  const months = availableAnalyticsMonths(db)
  const fallback = new Date().toISOString().slice(0, 7)
  const from = input.from ?? months[0] ?? fallback
  const to = input.to ?? months.at(-1) ?? fallback

  if (!isAnalyticsMonth(from) || !isAnalyticsMonth(to)) {
    throw new Error(
      `Période invalide : ${from} → ${to} (format YYYY-MM attendu)`,
    )
  }
  if (from > to) {
    throw new Error(`Période inversée : ${from} → ${to}`)
  }

  return { from, to }
}

/**
 * Builds the deterministic coach context: verified indicators plus the cards
 * retrieved for the question.
 *
 * No merchant label is copied into the result: `libelleSimplifie` stays inside
 * `computeIndicators` (recurring counts) and never reaches the payload.
 */
export async function buildCoachContext(
  ctx: AppContext,
  input: { question: string } & CoachPeriodInput,
  retrieve: KnowledgeRetriever = retrieveKnowledge,
): Promise<CoachContext> {
  const period = resolveCoachPeriod(ctx.db, input)
  const indicators = computeIndicators(
    loadAnalyticsOperations(ctx.db),
    period,
  )
  const goals = listGoalProgress(ctx, { period, indicators }).map(
    toGoalCoachView,
  )

  const question = input.question.trim()
  const matches = question ? await retrieve(question, { limit: 4 }) : []

  return {
    indicators,
    goals,
    sources: matches.map((match) => ({
      id: match.entry.id,
      title: match.entry.title,
      source: match.entry.source,
      reviewRequired: match.entry.reviewRequired,
    })),
    knowledgeBlock: formatKnowledgeContext(matches),
  }
}
