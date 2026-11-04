import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { categories, operations, subCategories } from '#/db/schema'
import type { OperationEvent } from '#/domain/operations/events'
import { createTestContext } from '#/test/helpers'

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
})

function setup() {
  const ctx = createTestContext()
  close = ctx.close
  const [first, second] = ctx.db
    .insert(categories)
    .values([
      { name: 'Alimentation', normalizedName: 'alimentation' },
      { name: 'Transports', normalizedName: 'transports' },
    ])
    .returning()
    .all()
  return { ctx, first: first!, second: second! }
}

const metadata = {
  commandId: 'cmd',
  correlationId: 'cmd',
  source: 'system' as const,
  schemaVersion: 1 as const,
}

const imported = {
  dateComptabilisation: '2026-01-02',
  libelleSimplifie: 'PRLV Free Telecom',
  libelleOperation: 'PRLV Free Telecom Janvier',
  reference: null,
  infosComplementaires: null,
  typeOperation: 'Prélèvement',
  categoryId: null,
  subCategoryId: null,
  debit: -29.99,
  credit: null,
  montant: -29.99,
  dateOperation: '2026-01-01',
  dateValeur: '2026-01-02',
  pointage: 0,
}

type Setup = ReturnType<typeof setup>

function row({ ctx }: Setup, id: number) {
  return ctx.db.select().from(operations).where(eq(operations.id, id)).get()
}

describe('operation projector', () => {
  it('applies the full event lifecycle', () => {
    const setupResult = setup()
    const { ctx, first } = setupResult

    ctx.projector.apply(
      ctx.events.append('operation:1', 'operation', 0, [
        { type: 'OperationImported', payload: imported, metadata },
        {
          type: 'OperationDetailsUpdated',
          payload: { libelleOperation: 'PRLV Free Telecom Février' },
          metadata,
        },
        {
          type: 'OperationCategorized',
          payload: { categoryId: first.id, subCategoryId: null },
          metadata,
        },
        { type: 'OperationPointageChanged', payload: { pointage: 1 }, metadata },
      ]),
    )

    expect(row(setupResult, 1)).toMatchObject({
      id: 1,
      libelleOperation: 'PRLV Free Telecom Février',
      categoryId: first.id,
      subCategoryId: null,
      pointage: 1,
      isRecurring: true,
    })
  })

  it('computes the fingerprint when metadata has none', () => {
    const setupResult = setup()
    const { ctx } = setupResult
    ctx.projector.apply(
      ctx.events.append('operation:2', 'operation', 0, [
        { type: 'OperationImported', payload: imported, metadata },
      ]),
    )

    expect(row(setupResult, 2)?.fingerprint).toBeTruthy()
  })

  it('recomputes isRecurring when the label changes', () => {
    const setupResult = setup()
    const { ctx } = setupResult
    ctx.projector.apply(
      ctx.events.append('operation:3', 'operation', 0, [
        { type: 'OperationImported', payload: imported, metadata },
      ]),
    )
    expect(row(setupResult, 3)?.isRecurring).toBe(true)

    ctx.projector.apply(
      ctx.events.append('operation:3', 'operation', 1, [
        {
          type: 'OperationDetailsUpdated',
          payload: { libelleOperation: 'Boulangerie' },
          metadata,
        },
      ]),
    )
    expect(row(setupResult, 3)?.isRecurring).toBe(false)
  })

  it('hard-deletes the read-model row but keeps the event', () => {
    const setupResult = setup()
    const { ctx } = setupResult
    ctx.projector.apply(
      ctx.events.append('operation:4', 'operation', 0, [
        { type: 'OperationImported', payload: imported, metadata },
      ]),
    )
    ctx.projector.apply(
      ctx.events.append('operation:4', 'operation', 1, [
        { type: 'OperationDeleted', payload: {}, metadata },
      ]),
    )

    expect(row(setupResult, 4)).toBeUndefined()
    expect(ctx.events.readStream('operation:4')).toHaveLength(2)
  })

  it('replays to the same projection', () => {
    const setupResult = setup()
    const { ctx, second } = setupResult
    ctx.projector.apply(
      ctx.events.append('operation:5', 'operation', 0, [
        { type: 'OperationImported', payload: imported, metadata },
        {
          type: 'OperationCategorized',
          payload: { categoryId: second.id, subCategoryId: null },
          metadata,
        },
      ]),
    )
    const before = row(setupResult, 5)

    ctx.db.delete(operations).run()
    ctx.projector.apply(ctx.events.readAll<OperationEvent>())

    expect(row(setupResult, 5)).toEqual(before)
  })

  it('derives the default classification from the category rule', () => {
    const setupResult = setup()
    const { ctx, first } = setupResult
    ctx.projector.apply(
      ctx.events.append('operation:6', 'operation', 0, [
        {
          type: 'OperationImported',
          payload: { ...imported, categoryId: first.id },
          metadata,
        },
      ]),
    )

    expect(row(setupResult, 6)).toMatchObject({
      kind: 'expense',
      nature: 'essential',
      classificationSource: 'rule',
      classificationConfidence: 0.9,
    })
  })

  it('prefers the sub-category rule over the category rule', () => {
    const setupResult = setup()
    const { ctx, first } = setupResult
    const [restaurant] = ctx.db
      .insert(subCategories)
      .values({
        categoryId: first.id,
        name: 'Restaurant',
        normalizedName: 'restaurant',
      })
      .returning()
      .all()

    ctx.projector.apply(
      ctx.events.append('operation:7', 'operation', 0, [
        {
          type: 'OperationImported',
          payload: {
            ...imported,
            categoryId: first.id,
            subCategoryId: restaurant!.id,
          },
          metadata,
        },
      ]),
    )

    expect(row(setupResult, 7)).toMatchObject({
      kind: 'expense',
      nature: 'discretionary',
      classificationConfidence: 0.8,
    })
  })

  it('recomputes the default when the category changes', () => {
    const setupResult = setup()
    const { ctx, first } = setupResult
    ctx.projector.apply(
      ctx.events.append('operation:8', 'operation', 0, [
        { type: 'OperationImported', payload: imported, metadata },
        {
          type: 'OperationCategorized',
          payload: { categoryId: first.id, subCategoryId: null },
          metadata,
        },
      ]),
    )

    expect(row(setupResult, 8)).toMatchObject({
      kind: 'expense',
      nature: 'essential',
    })
  })

  it('turns an expense into a refund when the amount becomes positive', () => {
    const setupResult = setup()
    const { ctx, first } = setupResult
    ctx.projector.apply(
      ctx.events.append('operation:9', 'operation', 0, [
        {
          type: 'OperationImported',
          payload: { ...imported, categoryId: first.id },
          metadata,
        },
        {
          type: 'OperationDetailsUpdated',
          payload: { montant: 29.99 },
          metadata,
        },
      ]),
    )

    expect(row(setupResult, 9)).toMatchObject({
      kind: 'refund',
      nature: null,
      classificationConfidence: 0.81,
    })
  })

  it('keeps a manual override when the category changes', () => {
    const setupResult = setup()
    const { ctx, second } = setupResult
    ctx.projector.apply(
      ctx.events.append('operation:10', 'operation', 0, [
        { type: 'OperationImported', payload: imported, metadata },
        {
          type: 'OperationClassified',
          payload: {
            kind: 'transfer',
            nature: null,
            classificationSource: 'manual',
            classificationConfidence: 1,
          },
          metadata,
        },
        {
          type: 'OperationCategorized',
          payload: { categoryId: second.id, subCategoryId: null },
          metadata,
        },
        {
          type: 'OperationDetailsUpdated',
          payload: { montant: 12 },
          metadata,
        },
      ]),
    )

    expect(row(setupResult, 10)).toMatchObject({
      categoryId: second.id,
      montant: 12,
      kind: 'transfer',
      nature: null,
      classificationSource: 'manual',
      classificationConfidence: 1,
    })
  })
})
