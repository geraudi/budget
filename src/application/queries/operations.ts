import { eq, getTableColumns, inArray, desc } from 'drizzle-orm'

import type { AppContext } from '#/infrastructure/context'
import { categories, operations, subCategories } from '#/db/schema'

export type Operation = ReturnType<typeof listOperations>[number]

/** Operations for the table, most recent first. */
export function listOperations(ctx: AppContext) {
  return ctx.db
    .select({
      ...getTableColumns(operations),
      categorie: categories.name,
      sousCategorie: subCategories.name,
    })
    .from(operations)
    .leftJoin(categories, eq(operations.categoryId, categories.id))
    .leftJoin(subCategories, eq(operations.subCategoryId, subCategories.id))
    .orderBy(desc(operations.dateComptabilisation), desc(operations.id))
    .limit(2000)
    .all()
}

export type SimilarOperation = ReturnType<typeof findSimilarOperations>[number]

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Operations sharing the same normalized simplified label (same merchant
 * or operation type), excluding the operation being edited.
 */
export function similarOperationIds(
  ctx: AppContext,
  libelleSimplifie: string,
  excludeId: number,
): number[] {
  const normalized = normalizeLabel(libelleSimplifie)
  return ctx.db
    .select({
      id: operations.id,
      libelleSimplifie: operations.libelleSimplifie,
    })
    .from(operations)
    .all()
    .filter(
      (row) =>
        row.id !== excludeId &&
        normalizeLabel(row.libelleSimplifie) === normalized,
    )
    .map((row) => row.id)
}

function findSimilarOperations(ctx: AppContext, ids: number[]) {
  if (ids.length === 0) return []

  return ctx.db
    .select({
      id: operations.id,
      dateComptabilisation: operations.dateComptabilisation,
      dateOperation: operations.dateOperation,
      libelleOperation: operations.libelleOperation,
      montant: operations.montant,
      categoryId: operations.categoryId,
      subCategoryId: operations.subCategoryId,
      categorie: categories.name,
      sousCategorie: subCategories.name,
    })
    .from(operations)
    .leftJoin(categories, eq(operations.categoryId, categories.id))
    .leftJoin(subCategories, eq(operations.subCategoryId, subCategories.id))
    .where(inArray(operations.id, ids))
    .orderBy(desc(operations.dateComptabilisation), desc(operations.id))
    .all()
}

export function getSimilarOperations(ctx: AppContext, id: number) {
  const operation = ctx.db
    .select({ libelleSimplifie: operations.libelleSimplifie })
    .from(operations)
    .where(eq(operations.id, id))
    .get()
  if (!operation) throw new Error('Opération inconnue')

  const ids = similarOperationIds(ctx, operation.libelleSimplifie, id)
  return {
    libelleSimplifie: operation.libelleSimplifie,
    operations: findSimilarOperations(ctx, ids),
  }
}

export type OperationHistoryEntry = {
  eventId: string
  type: string
  streamVersion: number
  occurredAt: string
  source: string
  payload: Record<string, string | number | boolean | null>
}

/** Event timeline for one operation, oldest first. */
export function getOperationHistory(
  ctx: AppContext,
  id: number,
): OperationHistoryEntry[] {
  return ctx.events
    .readStream(`operation:${id}`)
    .map((event) => ({
      eventId: event.eventId,
      type: event.type,
      streamVersion: event.streamVersion,
      occurredAt: event.occurredAt,
      source: event.metadata.source,
      payload: event.payload as Record<
        string,
        string | number | boolean | null
      >,
    }))
}
