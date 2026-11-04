import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { operations } from '#/db/schema'
import { parseCsvText } from '#/lib/csv'
import { createTestContext } from '#/test/helpers'
import { deleteOperation } from './delete-operation'
import { importOperations } from './import-operations'
import { setOperationPointage } from './set-operation-pointage'
import { updateOperation } from './update-operation'
import { listOperations } from '#/application/queries/operations'

const SAMPLES = ['2026-01', '2026-06', '2026-10'].map((month) => ({
  month,
  path: fileURLToPath(
    new URL(`../../../samples/sample-operations-${month}.csv`, import.meta.url),
  ),
}))

function readSample(path: string) {
  const text = new TextDecoder('iso-8859-1').decode(readFileSync(path))
  return parseCsvText(text)
}

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
})

function setup() {
  const ctx = createTestContext()
  close = ctx.close
  return ctx
}

describe('operation commands', () => {
  for (const sample of SAMPLES) {
    it(`imports ${sample.month} and is idempotent`, () => {
      const ctx = setup()
      const { rows, ignored } = readSample(sample.path)
      expect(rows.length).toBeGreaterThan(0)

      const first = importOperations(ctx, rows, { ignored })
      expect(first).toEqual({
        total: rows.length,
        inserted: rows.length,
        duplicates: 0,
        ignored: 0,
      })
      expect(
        ctx.db.select().from(operations).all(),
      ).toHaveLength(rows.length)

      const second = importOperations(ctx, rows, { ignored })
      expect(second).toEqual({
        total: rows.length,
        inserted: 0,
        duplicates: rows.length,
        ignored: 0,
      })
      expect(
        ctx.db.select().from(operations).all(),
      ).toHaveLength(rows.length)
    })
  }

  it('imports all three samples into one database', () => {
    const ctx = setup()
    let expected = 0

    for (const sample of SAMPLES) {
      const { rows, ignored } = readSample(sample.path)
      expected += rows.length
      const result = importOperations(ctx, rows, { ignored })
      expect(result.inserted).toBe(rows.length)
    }

    expect(ctx.db.select().from(operations).all()).toHaveLength(expected)
  })

  it('resolves categories from the CSV', () => {
    const ctx = setup()
    const { rows, ignored } = readSample(SAMPLES[0]!.path)
    importOperations(ctx, rows, { ignored })

    const withCategory = listOperations(ctx).filter(
      (operation) => operation.categoryId !== null,
    )
    expect(withCategory.length).toBeGreaterThan(0)
    expect(withCategory[0]!.categorie).toBeTruthy()
  })

  it('explains a projection row without an event stream', () => {
    const ctx = setup()
    const [row] = ctx.db
      .insert(operations)
      .values({
        dateComptabilisation: '2026-01-02',
        libelleSimplifie: 'SANS ÉVÉNEMENT',
        libelleOperation: 'SANS ÉVÉNEMENT',
        montant: -1,
      })
      .returning()
      .all()

    expect(() => deleteOperation(ctx, row!.id)).toThrow(/events:backfill/)
  })

  it('updates, categorizes similar operations, points and deletes', () => {
    const ctx = setup()
    const { rows, ignored } = readSample(SAMPLES[0]!.path)
    importOperations(ctx, rows, { ignored })

    const first = listOperations(ctx)[0]!
    const updated = updateOperation(ctx, {
      id: first.id,
      dateComptabilisation: first.dateComptabilisation,
      libelleSimplifie: first.libelleSimplifie,
      libelleOperation: 'LIBELLÉ MODIFIÉ',
      reference: first.reference,
      infosComplementaires: first.infosComplementaires,
      typeOperation: first.typeOperation,
      categoryId: first.categoryId,
      subCategoryId: first.subCategoryId,
      debit: first.debit,
      credit: first.credit,
      montant: first.montant,
      dateOperation: first.dateOperation,
      dateValeur: first.dateValeur,
      pointage: first.pointage,
    })

    expect(updated.updatedSimilar).toBe(0)
    expect(
      ctx.db
        .select({ label: operations.libelleOperation })
        .from(operations)
        .where(eq(operations.id, first.id))
        .get()?.label,
    ).toBe('LIBELLÉ MODIFIÉ')

    expect(
      ctx.events
        .readStream(`operation:${first.id}`)
        .map((event) => event.type),
    ).toEqual(['OperationImported', 'OperationDetailsUpdated'])

    setOperationPointage(ctx, first.id, first.pointage === 1 ? 0 : 1)
    expect(
      ctx.events
        .readStream(`operation:${first.id}`)
        .map((event) => event.type),
    ).toEqual([
      'OperationImported',
      'OperationDetailsUpdated',
      'OperationPointageChanged',
    ])

    deleteOperation(ctx, first.id)
    expect(
      ctx.db
        .select({ id: operations.id })
        .from(operations)
        .where(eq(operations.id, first.id))
        .get(),
    ).toBeUndefined()
    expect(
      ctx.events
        .readStream(`operation:${first.id}`)
        .map((event) => event.type),
    ).toContain('OperationDeleted')
  })
})
