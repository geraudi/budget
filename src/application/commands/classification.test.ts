import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { categories, operations, subCategories } from '#/db/schema'
import { createTestContext } from '#/test/helpers'
import { classifyOperation } from './classify-operation'

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

function setup() {
  const ctx = createTestContext()
  close = ctx.close

  const [food] = ctx.db
    .insert(categories)
    .values({ name: 'Alimentation', normalizedName: 'alimentation' })
    .returning()
    .all()
  const [transports] = ctx.db
    .insert(categories)
    .values({ name: 'Transports', normalizedName: 'transports' })
    .returning()
    .all()
  const [restaurant] = ctx.db
    .insert(subCategories)
    .values({
      categoryId: food!.id,
      name: 'Restaurant',
      normalizedName: 'restaurant',
    })
    .returning()
    .all()

  ctx.projector.apply(
    ctx.events.append('operation:1', 'operation', 0, [
      {
        type: 'OperationImported',
        payload: {
          dateComptabilisation: '2026-01-10',
          libelleSimplifie: 'RESTO',
          libelleOperation: 'RESTO',
          reference: null,
          infosComplementaires: null,
          typeOperation: null,
          categoryId: food!.id,
          subCategoryId: restaurant!.id,
          debit: -20,
          credit: null,
          montant: -20,
          dateOperation: null,
          dateValeur: null,
          pointage: 0,
        },
        metadata,
      },
    ]),
  )

  return { ctx, food: food!, transports: transports!, restaurant: restaurant! }
}

function row(ctx: ReturnType<typeof setup>['ctx']) {
  return ctx.db.select().from(operations).where(eq(operations.id, 1)).get()
}

describe('classifyOperation', () => {
  it('starts from the derived rule', () => {
    const { ctx } = setup()
    expect(row(ctx)).toMatchObject({
      kind: 'expense',
      nature: 'discretionary',
      classificationSource: 'rule',
    })
  })

  it('records a manual override and appends one event', () => {
    const { ctx } = setup()

    const result = classifyOperation(ctx, {
      id: 1,
      kind: 'transfer',
    })

    expect(result.classification).toEqual({
      kind: 'transfer',
      nature: null,
      classificationSource: 'manual',
      classificationConfidence: 1,
    })
    expect(row(ctx)).toMatchObject({
      kind: 'transfer',
      nature: null,
      classificationSource: 'manual',
      classificationConfidence: 1,
    })
    expect(
      ctx.events.readStream('operation:1').map((event) => event.type),
    ).toEqual(['OperationImported', 'OperationClassified'])
  })

  it('does not append a duplicate override', () => {
    const { ctx } = setup()
    classifyOperation(ctx, { id: 1, kind: 'expense', nature: 'essential' })
    classifyOperation(ctx, { id: 1, kind: 'expense', nature: 'essential' })

    expect(
      ctx.events
        .readStream('operation:1')
        .filter((event) => event.type === 'OperationClassified'),
    ).toHaveLength(1)
  })

  it('rejects a nature on a non-expense kind', () => {
    const { ctx } = setup()
    expect(() =>
      classifyOperation(ctx, {
        id: 1,
        kind: 'transfer',
        nature: 'essential',
      }),
    ).toThrow(/dépenses/)
  })

  it('rejects an invalid confidence or unknown operation', () => {
    const { ctx } = setup()
    expect(() =>
      classifyOperation(ctx, { id: 1, kind: 'expense', confidence: 2 }),
    ).toThrow(/Confiance/)
    expect(() => classifyOperation(ctx, { id: 999, kind: 'expense' })).toThrow(
      /inconnue/,
    )
  })
})
