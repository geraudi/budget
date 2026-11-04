import { operations } from '#/db/schema'
import { appendAndProject, createMetadata, runCommand } from './append'
import type { AppContext } from '#/infrastructure/context'
import { operationStreamId } from '#/domain/operations/operation'
import { resolveCategoryLinks } from '#/lib/categories-core'
import type { ParsedOperation } from '#/lib/csv'
import { planImport } from '#/lib/import-dedup'

export type ImportResult = {
  /** valid rows found in the file (header/empty lines excluded) */
  total: number
  inserted: number
  /** already in the database, or repeated within the same file */
  duplicates: number
  /** malformed / incomplete lines */
  ignored: number
}

export type ImportOptions = {
  ignored?: number
  fileName?: string
}

/** Inserts new operations as `OperationImported` events, in one transaction. */
export function importOperations(
  ctx: AppContext,
  rows: ParsedOperation[],
  options: ImportOptions = {},
): ImportResult {
  return runCommand(ctx, () => {
    const existing = ctx.db.select().from(operations).all()
    const { newRows, duplicates, staleFingerprints } = planImport(
      rows,
      existing,
    )

    if (staleFingerprints.length > 0) {
      ctx.projector.repairFingerprints(staleFingerprints)
    }

    if (newRows.length > 0) {
      const links = resolveCategoryLinks(
        ctx.db,
        newRows.map(({ row }) => row),
      )
      const importId = crypto.randomUUID()

      newRows.forEach(({ row, fingerprint }, index) => {
        const id = ctx.events.nextId('operation')
        const link = links[index] ?? { categoryId: null, subCategoryId: null }

        appendAndProject(ctx, {
          streamId: operationStreamId(id),
          expectedVersion: 0,
          events: [
            {
              type: 'OperationImported',
              payload: {
                dateComptabilisation: row.dateComptabilisation,
                libelleSimplifie: row.libelleSimplifie,
                libelleOperation: row.libelleOperation,
                reference: row.reference,
                infosComplementaires: row.infosComplementaires,
                typeOperation: row.typeOperation,
                categoryId: link.categoryId,
                subCategoryId: link.subCategoryId,
                debit: row.debit,
                credit: row.credit,
                montant: row.montant,
                dateOperation: row.dateOperation,
                dateValeur: row.dateValeur,
                pointage: row.pointage,
              },
              metadata: createMetadata('csv-import', {
                fingerprint,
                importId,
                fileName: options.fileName,
              }),
            },
          ],
        })
      })
    }

    return {
      total: rows.length,
      inserted: newRows.length,
      duplicates,
      ignored: options.ignored ?? 0,
    }
  })
}
