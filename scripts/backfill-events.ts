import { sql } from 'drizzle-orm'

import { operations } from '#/db/schema'
import { operationStreamId } from '#/domain/operations/operation'
import { createContext } from '#/infrastructure/context'
import { withTransaction } from '#/infrastructure/context'
import { fingerprintFromOperationRow } from '#/lib/csv'
import { allowProdFromArgs, resolveDatabaseUrl } from './db-utils'

const url = resolveDatabaseUrl({ allowProd: allowProdFromArgs() })
const ctx = createContext({ url })

const rows = ctx.db.select().from(operations).all()

let appended = 0
let skipped = 0

withTransaction(ctx, () => {
  const repairs: Array<{ id: number; fingerprint: string }> = []

  for (const row of rows) {
    const streamId = operationStreamId(row.id)
    if (ctx.events.hasStream(streamId)) {
      skipped += 1
      continue
    }

    const fingerprint = fingerprintFromOperationRow(row)
    if (row.fingerprint !== fingerprint) {
      repairs.push({ id: row.id, fingerprint })
    }

    ctx.events.append(streamId, 'operation', 0, [
      {
        type: 'OperationImported',
        payload: {
          dateComptabilisation: row.dateComptabilisation,
          libelleSimplifie: row.libelleSimplifie,
          libelleOperation: row.libelleOperation,
          reference: row.reference,
          infosComplementaires: row.infosComplementaires,
          typeOperation: row.typeOperation,
          categoryId: row.categoryId,
          subCategoryId: row.subCategoryId,
          debit: row.debit,
          credit: row.credit,
          montant: row.montant,
          dateOperation: row.dateOperation,
          dateValeur: row.dateValeur,
          pointage: row.pointage,
        },
        eventId: `backfill:operation:${row.id}`,
        occurredAt: `${row.dateComptabilisation}T00:00:00.000Z`,
        metadata: {
          commandId: 'backfill',
          correlationId: 'backfill',
          source: 'backfill',
          schemaVersion: 1,
          legacyId: row.id,
          fingerprint,
        },
      },
    ])
    appended += 1
  }

  if (repairs.length > 0) ctx.projector.repairFingerprints(repairs)

  const maxId =
    ctx.db
      .select({ max: sql<number | null>`max(${operations.id})` })
      .from(operations)
      .get()?.max ?? 0
  ctx.events.ensureSequence('operation', maxId + 1)
  ctx.events.saveCheckpoint('operations', ctx.events.maxPosition())

  console.log(
    `Backfill terminé : ${appended} événement(s), ${skipped} flux déjà présent(s), ` +
      `${repairs.length} empreinte(s) réparée(s).`,
  )
  console.log(`Dernière position : ${ctx.events.maxPosition()}`)
})

ctx.sqlite.close()
