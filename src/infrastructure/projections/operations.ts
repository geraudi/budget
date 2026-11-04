import { eq } from 'drizzle-orm'

import type { AppDb } from '#/db/create'
import { operations } from '#/db/schema'
import type { StoredOperationEvent } from '#/domain/operations/events'
import type { OperationClassification } from '#/domain/operations/classification'
import { operationIdFromStream } from '#/domain/operations/operation'
import {
  createClassificationResolver,
  ensureDefaultClassificationRules,
} from '#/lib/classification-core'
import { fingerprintOperation } from '#/lib/csv'
import {
  createRecurringMatcher,
  ensureDefaultRecurringPatterns,
} from '#/lib/recurring-core'

type ClassificationColumns = {
  kind: OperationClassification['kind']
  nature: OperationClassification['nature']
  classificationSource: OperationClassification['classificationSource']
  classificationConfidence: number
}

function isSameClassification(
  current: {
    kind: OperationClassification['kind'] | null
    nature: OperationClassification['nature'] | null
    classificationSource: OperationClassification['classificationSource'] | null
    classificationConfidence: number | null
  },
  next: ClassificationColumns,
): boolean {
  return (
    current.kind === next.kind &&
    current.nature === next.nature &&
    current.classificationSource === next.classificationSource &&
    current.classificationConfidence !== null &&
    Math.abs(current.classificationConfidence - next.classificationConfidence) <
      0.0001
  )
}

/**
 * Inline projector for the `operations` read model.
 *
 * It is intentionally synchronous and idempotent per event so the same code
 * can be used by command handlers, the backfill script, and a full rebuild.
 *
 * `kind` / `nature` are derived from the current classification rules unless
 * a manual `OperationClassified` override is present. This keeps a rebuild
 * deterministic and lets rule edits take effect on the next projection pass.
 */
export function createOperationProjector(db: AppDb) {
  return {
    apply(storedEvents: ReadonlyArray<StoredOperationEvent>): void {
      if (storedEvents.length === 0) return

      ensureDefaultRecurringPatterns(db)
      ensureDefaultClassificationRules(db)
      const matcher = createRecurringMatcher(db)
      const classifier = createClassificationResolver(db)

      for (const event of storedEvents) {
        if (event.streamType !== 'operation') continue
        const id = operationIdFromStream(event.streamId)

        switch (event.type) {
          case 'OperationImported':
            db.insert(operations)
              .values({
                id,
                ...event.payload,
                ...classifier.resolve(event.payload),
                isRecurring: matcher.matches(event.payload.libelleOperation),
                fingerprint:
                  event.metadata.fingerprint ??
                  fingerprintOperation(event.payload),
              })
              .run()
            break

          case 'OperationDetailsUpdated': {
            const patch = event.payload
            if (Object.keys(patch).length === 0) break

            let reclassification: ClassificationColumns | null = null

            if (patch.montant !== undefined) {
              const current = db
                .select({
                  montant: operations.montant,
                  categoryId: operations.categoryId,
                  subCategoryId: operations.subCategoryId,
                  kind: operations.kind,
                  nature: operations.nature,
                  classificationSource: operations.classificationSource,
                  classificationConfidence: operations.classificationConfidence,
                })
                .from(operations)
                .where(eq(operations.id, id))
                .get()

              if (current && current.classificationSource !== 'manual') {
                const resolved = classifier.resolve({
                  ...current,
                  montant: patch.montant,
                })
                if (!isSameClassification(current, resolved)) {
                  reclassification = resolved
                }
              }
            }

            db.update(operations)
              .set({
                ...patch,
                ...(reclassification ?? {}),
                ...(patch.libelleOperation === undefined
                  ? {}
                  : {
                      isRecurring: matcher.matches(patch.libelleOperation),
                    }),
              })
              .where(eq(operations.id, id))
              .run()
            break
          }

          case 'OperationCategorized': {
            const current = db
              .select({
                montant: operations.montant,
                classificationSource: operations.classificationSource,
              })
              .from(operations)
              .where(eq(operations.id, id))
              .get()

            const classification =
              current && current.classificationSource !== 'manual'
                ? classifier.resolve({
                    montant: current.montant,
                    categoryId: event.payload.categoryId,
                    subCategoryId: event.payload.subCategoryId,
                  })
                : null

            db.update(operations)
              .set({
                categoryId: event.payload.categoryId,
                subCategoryId: event.payload.subCategoryId,
                ...(classification ?? {}),
              })
              .where(eq(operations.id, id))
              .run()
            break
          }

          case 'OperationClassified':
            db.update(operations)
              .set({
                kind: event.payload.kind,
                nature: event.payload.nature,
                classificationSource: event.payload.classificationSource,
                classificationConfidence:
                  event.payload.classificationConfidence,
              })
              .where(eq(operations.id, id))
              .run()
            break

          case 'OperationPointageChanged':
            db.update(operations)
              .set({ pointage: event.payload.pointage })
              .where(eq(operations.id, id))
              .run()
            break

          case 'OperationDeleted':
            db.delete(operations).where(eq(operations.id, id)).run()
            break
        }
      }
    },

    /**
     * Read-model maintenance for fingerprints computed with an older
     * algorithm. Fingerprints are derived data, so this does not emit events.
     */
    repairFingerprints(
      repairs: ReadonlyArray<{ id: number; fingerprint: string }>,
    ): void {
      for (const repair of repairs) {
        db.update(operations)
          .set({ fingerprint: repair.fingerprint })
          .where(eq(operations.id, repair.id))
          .run()
      }
    },
  }
}

export type OperationProjector = ReturnType<typeof createOperationProjector>
