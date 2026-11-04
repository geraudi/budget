import { afterEach, describe, expect, it } from 'vitest'

import { classifyOperation } from '#/application/commands/classify-operation'
import { createGoal } from '#/application/commands/create-goal'
import { categories } from '#/db/schema'
import { computeIndicators } from '#/domain/analytics'
import type { AppContext } from '#/infrastructure/context'
import { createLexicalRetriever } from '#/infrastructure/knowledge/retrieval'
import { createTestContext } from '#/test/helpers'
import {
  buildCoachContext,
  loadAnalyticsOperations,
  resolveCoachPeriod,
} from './coach'

const metadata = {
  commandId: 'cmd',
  correlationId: 'cmd',
  source: 'system' as const,
  schemaVersion: 1 as const,
}

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
})

function importOperation(
  ctx: AppContext,
  id: number,
  values: {
    date: string
    label: string
    montant: number
    categoryId: number
  },
) {
  ctx.projector.apply(
    ctx.events.append(`operation:${id}`, 'operation', 0, [
      {
        type: 'OperationImported',
        payload: {
          dateComptabilisation: values.date,
          libelleSimplifie: values.label,
          libelleOperation: values.label,
          reference: null,
          infosComplementaires: null,
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

function setup() {
  const ctx = createTestContext()
  close = ctx.close

  const [food] = ctx.db
    .insert(categories)
    .values({ name: 'Alimentation', normalizedName: 'alimentation' })
    .returning()
    .all()
  const [income] = ctx.db
    .insert(categories)
    .values({ name: 'Revenus', normalizedName: 'revenus' })
    .returning()
    .all()

  importOperation(ctx, 1, {
    date: '2026-01-05',
    label: 'SALAIRE EMPLOYEUR',
    montant: 3_000,
    categoryId: income!.id,
  })
  importOperation(ctx, 2, {
    date: '2026-02-05',
    label: 'VIREMENT RECU A CATEGORISER',
    montant: 2_000,
    categoryId: income!.id,
  })
  importOperation(ctx, 3, {
    date: '2026-02-10',
    label: 'SUPERMARCHE LECLERC',
    montant: -500,
    categoryId: food!.id,
  })
  importOperation(ctx, 4, {
    date: '2025-12-10',
    label: 'ANCIEN ACHAT',
    montant: -100,
    categoryId: food!.id,
  })
  importOperation(ctx, 5, {
    date: '2026-03-01',
    label: 'CAFE',
    montant: -50,
    categoryId: food!.id,
  })

  classifyOperation(ctx, { id: 1, kind: 'income', confidence: 1 })
  classifyOperation(ctx, { id: 2, kind: 'income', confidence: 0.2 })
  classifyOperation(ctx, {
    id: 3,
    kind: 'expense',
    nature: 'essential',
  })
  classifyOperation(ctx, {
    id: 4,
    kind: 'expense',
    nature: 'discretionary',
  })
  classifyOperation(ctx, {
    id: 5,
    kind: 'expense',
    nature: 'discretionary',
  })

  return ctx
}

/** Deterministic, offline retrieval for the context tests. */
function buildContext(
  ctx: AppContext,
  input: { question: string; from?: string | null; to?: string | null },
) {
  return buildCoachContext(ctx, input, createLexicalRetriever())
}

describe('buildCoachContext', () => {
  it('computes the indicators on the requested period only', async () => {
    const ctx = setup()

    const context = await buildContext(ctx, {
      from: '2026-01',
      to: '2026-02',
      question: '',
    })

    expect(context.indicators.period).toEqual({
      from: '2026-01',
      to: '2026-02',
    })
    expect(context.indicators.income).toMatchObject({
      recurring: 0,
      other: 3_000,
      unqualified: 2_000,
      total: 5_000,
    })
    expect(context.indicators.expenses.essential).toBe(500)
    expect(context.indicators.expenses.total).toBe(500)
    expect(context.indicators.dataQuality.monthsAvailable).toBe(2)
    expect(context.indicators).toEqual(
      computeIndicators(loadAnalyticsOperations(ctx.db), {
        from: '2026-01',
        to: '2026-02',
      }),
    )
  })

  it('never copies a merchant label into the payload', async () => {
    const ctx = setup()

    const context = await buildContext(ctx, {
      from: '2026-01',
      to: '2026-02',
      question: '',
    })
    const payload = JSON.stringify(context.indicators)

    expect(payload).not.toContain('SALAIRE')
    expect(payload).not.toContain('LECLERC')
    expect(payload).not.toContain('libelle')
    expect(payload).not.toContain('libellé')
  })

  it('returns no source when the question matches no card', async () => {
    const ctx = setup()

    const context = await buildContext(ctx, {
      from: '2026-01',
      to: '2026-02',
      question: '',
    })

    expect(context.sources).toEqual([])
    expect(context.knowledgeBlock).toBe('')
  })

  it('maps retrieved cards to citable sources', async () => {
    const ctx = setup()

    const context = await buildContext(ctx, {
      from: '2026-01',
      to: '2026-02',
      question: 'Comment constituer une épargne de précaution ?',
    })

    expect(context.sources.length).toBeGreaterThan(0)
    expect(context.sources[0]).toMatchObject({
      id: 'epargne_precaution_montant',
      title: expect.any(String),
      source: expect.any(String),
      reviewRequired: expect.any(Boolean),
    })
    expect(context.knowledgeBlock).toContain('Limites')
  })

  it('defaults to the months present in the database', async () => {
    const ctx = setup()

    const context = await buildContext(ctx, { question: '' })

    expect(context.indicators.period).toEqual({
      from: '2025-12',
      to: '2026-03',
    })
  })

  it('exposes the goals scored on the requested period', async () => {
    const ctx = setup()
    createGoal(ctx, {
      label: 'Vacances',
      targetAmount: 1_200,
      targetMonth: '2026-12',
      startMonth: '2026-01',
    })

    const context = await buildContext(ctx, {
      from: '2026-01',
      to: '2026-02',
      question: '',
    })

    expect(context.goals).toHaveLength(1)
    expect(context.goals[0]).toMatchObject({
      label: 'Vacances',
      targetAmount: 1_200,
      savedAmount: 0,
      remaining: 1_200,
      targetMonth: '2026-12',
    })
  })

  it('keeps merchant labels out of the full coach context', async () => {
    const ctx = setup()
    createGoal(ctx, {
      label: 'Vacances',
      targetAmount: 1_200,
      targetMonth: '2026-12',
      startMonth: '2026-01',
    })

    const context = await buildContext(ctx, {
      from: '2026-01',
      to: '2026-02',
      question: '',
    })
    const payload = JSON.stringify(context)

    expect(payload).not.toContain('SALAIRE')
    expect(payload).not.toContain('LECLERC')
    expect(payload).not.toContain('libelleSimplifie')
    expect(payload).not.toContain('topExpenses')
  })
})

describe('resolveCoachPeriod', () => {
  it('rejects an inverted period', () => {
    const ctx = setup()

    expect(() =>
      resolveCoachPeriod(ctx.db, { from: '2026-03', to: '2026-01' }),
    ).toThrow(/inversée/)
  })

  it('rejects an invalid month format', () => {
    const ctx = setup()

    expect(() =>
      resolveCoachPeriod(ctx.db, { from: '2026-1', to: '2026-10' }),
    ).toThrow(/YYYY-MM/)
  })
})
