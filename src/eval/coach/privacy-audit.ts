import { eq } from 'drizzle-orm'

import { classifyOperation } from '#/application/commands/classify-operation'
import { createGoal } from '#/application/commands/create-goal'
import { recordRecommendation } from '#/application/commands/record-recommendation'
import {
  buildCoachContext,
  type CoachSource,
} from '#/application/queries/coach'
import {
  buildRecommendationPayload,
  listGoalProgress,
  type GoalCoachView,
} from '#/application/queries/goals'
import { categories, coachRecommendations, operations } from '#/db/schema'
import type { AnalyticsIndicators } from '#/domain/analytics'
import type { CoachRecommendationPayload } from '#/domain/goals/recommendation'
import type { AppContext } from '#/infrastructure/context'
import { createLexicalRetriever } from '#/infrastructure/knowledge/retrieval'
import {
  buildCoachPayload,
  buildCoachSystemPrompt,
  buildGoalPayload,
} from '#/lib/coach-prompt'
import { createTestContext } from '#/test/helpers'

/**
 * Privacy audit of the coach chain.
 *
 * It runs the real query/command path against an in-memory SQLite database
 * seeded with unique markers, then looks for those markers in every string
 * that can leave the server: indicator payload, goal payload, system prompt,
 * knowledge block, citations, saved recommendation and the journal row.
 */

const OPERATION_ID = 9001
const OPERATION_ID_MARKER = String(OPERATION_ID)

const SECRET_LABEL = 'PHARMACIE SECRETE 42'
const SECRET_OPERATION_LABEL = 'CARTE PHARMACIE SECRETE 42'
const SECRET_REFERENCE = 'REF-SECRET-42'
const SECRET_DETAILS = 'Carte 1234'

/**
 * Unique markers and field names that must never be serialised.
 *
 * `operations` is deliberately handled as a JSON key below: the word is too
 * common to be a safe substring.
 */
const FORBIDDEN_SUBSTRINGS = [
  'PHARMACIE',
  'SECRETE',
  SECRET_REFERENCE,
  SECRET_DETAILS,
  'libelleSimplifie',
  'libelleOperation',
  'infosComplementaires',
  'topExpenses',
  'merchant',
  'operationId',
]

/**
 * Field names are checked as JSON keys. `operations` and `reference` are too
 * common as raw substrings (a card may mention "reference" in prose), while a
 * leaked field always appears as a quoted key in the serialised payload.
 */
const FORBIDDEN_JSON_KEYS = ['operations', 'reference']

export type PrivacyCheck = {
  label: string
  value: string
}

export type PrivacyAuditResult = {
  leaks: string[]
  checks: PrivacyCheck[]
  prompt: string
  indicators: AnalyticsIndicators
  goals: GoalCoachView[]
  sources: CoachSource[]
  recommendation: CoachRecommendationPayload
  journal: CoachRecommendationPayload
}

const metadata = {
  commandId: 'privacy-audit',
  correlationId: 'privacy-audit',
  source: 'system' as const,
  schemaVersion: 1 as const,
}

function importOperation(
  ctx: AppContext,
  values: {
    date: string
    montant: number
    categoryId: number
  },
): void {
  ctx.projector.apply(
    ctx.events.append(`operation:${OPERATION_ID}`, 'operation', 0, [
      {
        type: 'OperationImported',
        payload: {
          dateComptabilisation: values.date,
          libelleSimplifie: SECRET_LABEL,
          libelleOperation: SECRET_OPERATION_LABEL,
          reference: SECRET_REFERENCE,
          infosComplementaires: SECRET_DETAILS,
          typeOperation: null,
          categoryId: values.categoryId,
          subCategoryId: null,
          debit: values.montant < 0 ? values.montant : null,
          credit: values.montant > 0 ? values.montant : null,
          montant: values.montant,
          dateOperation: null,
          dateValeur: null,
          pointage: 0,
        },
        metadata,
      },
    ]),
  )
}

function seed(ctx: AppContext): void {
  const [health] = ctx.db
    .insert(categories)
    .values({ name: 'Santé', normalizedName: 'sante' })
    .returning()
    .all()

  importOperation(ctx, {
    date: '2026-01-15',
    montant: -800,
    categoryId: health!.id,
  })
  classifyOperation(ctx, {
    id: OPERATION_ID,
    kind: 'expense',
    nature: 'essential',
  })

  // Recurring is normally derived for real imports; setting it here keeps the
  // category-level `recurring.byCategory` block in the payload so the audit
  // also proves that category names (allowed) do not drag labels (forbidden).
  ctx.db
    .update(operations)
    .set({ isRecurring: true })
    .where(eq(operations.id, OPERATION_ID))
    .run()

  createGoal(ctx, {
    label: 'Vacances',
    targetAmount: 1_200,
    targetMonth: '2026-12',
    startMonth: '2026-01',
  })
}

function leaksIn(label: string, value: string): string[] {
  const leaks: string[] = []

  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (value.includes(needle)) {
      leaks.push(`${label} contient « ${needle} »`)
    }
  }

  for (const key of FORBIDDEN_JSON_KEYS) {
    if (new RegExp(`"${key}"\\s*:`).test(value)) {
      leaks.push(`${label} contient la clé JSON « ${key} »`)
    }
  }

  if (value.includes(OPERATION_ID_MARKER)) {
    leaks.push(`${label} contient l’identifiant d’opération ${OPERATION_ID}`)
  }

  return leaks
}

/**
 * Runs the audit and returns everything the privacy test may inspect.
 *
 * Throws only on an inconsistent setup; leaks are reported, so both the Vitest
 * test and `pnpm test:coach` can fail on them with a readable list.
 */
export async function runPrivacyAudit(
  input: { question?: string } = {},
): Promise<PrivacyAuditResult> {
  const ctx = createTestContext()

  try {
    seed(ctx)

    const period = { from: '2026-01', to: '2026-01' }
    const context = await buildCoachContext(
      ctx,
      {
        ...period,
        question: input.question ?? '',
      },
      createLexicalRetriever(),
    )
    const progress = listGoalProgress(ctx, {
      period,
      indicators: context.indicators,
    })
    const recommendation = buildRecommendationPayload({
      period,
      indicators: context.indicators,
      progress,
      goal: progress[0] ?? null,
    })

    recordRecommendation(ctx, {
      period,
      goalId: progress[0]?.id ?? null,
      kind: 'assessment',
      payload: recommendation,
    })

    const journalRow = ctx.db.select().from(coachRecommendations).get()
    if (!journalRow) {
      throw new Error('La recommandation n’a pas été journalisée')
    }

    const checks: PrivacyCheck[] = [
      {
        label: 'payload des indicateurs',
        value: buildCoachPayload(context.indicators),
      },
      {
        label: 'payload des objectifs',
        value: buildGoalPayload(context.goals),
      },
      {
        label: 'prompt système',
        value: buildCoachSystemPrompt(context.indicators, context.goals),
      },
      {
        label: 'bloc de connaissances',
        value: context.knowledgeBlock,
      },
      {
        label: 'sources citées',
        value: JSON.stringify(context.sources),
      },
      {
        label: 'payload de recommandation',
        value: JSON.stringify(recommendation),
      },
      {
        label: 'journal coach_recommendations',
        value: JSON.stringify(journalRow.payload),
      },
    ]

    const leaks = checks.flatMap((check) => leaksIn(check.label, check.value))

    return {
      leaks,
      checks,
      prompt: checks[2]!.value,
      indicators: context.indicators,
      goals: context.goals,
      sources: context.sources,
      recommendation,
      journal: journalRow.payload,
    }
  } finally {
    ctx.close()
  }
}
