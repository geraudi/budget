import { eq } from 'drizzle-orm'

import { appendAndProject, createMetadata, runCommand } from './append'
import { loadOperation } from './load-operation'
import { similarOperationIds } from '#/application/queries/operations'
import type { AppContext } from '#/infrastructure/context'
import { operations } from '#/db/schema'
import {
  decideCategorize,
  decideUpdate,
  operationStreamId,
} from '#/domain/operations/operation'
import type { OperationDetails } from '#/domain/operations/events'
import { categoryExists, getSubCategoryCategoryId } from '#/lib/categories-core'

export type UpdateOperationInput = OperationDetails & { id: number }

export type SaveOperationInput = UpdateOperationInput & {
  applyToSimilar?: boolean
}

export type UpdateOperationResult = {
  id: number
  updatedSimilar: number
  updatedSimilarIds: number[]
  categoryId: number | null
  subCategoryId: number | null
  isRecurring: boolean
}

export function updateOperation(
  ctx: AppContext,
  input: SaveOperationInput,
): UpdateOperationResult {
  let categoryId = input.categoryId
  const subCategoryId = input.subCategoryId

  if (subCategoryId !== null) {
    const subCategoryCategoryId = getSubCategoryCategoryId(
      ctx.db,
      subCategoryId,
    )
    if (subCategoryCategoryId === null) {
      throw new Error('Sous-catégorie inconnue')
    }
    if (categoryId === null) {
      categoryId = subCategoryCategoryId
    } else if (subCategoryCategoryId !== categoryId) {
      throw new Error(
        'La sous-catégorie ne correspond pas à la catégorie sélectionnée',
      )
    }
  }

  if (categoryId !== null && !categoryExists(ctx.db, categoryId)) {
    throw new Error('Catégorie inconnue')
  }

  const command: UpdateOperationInput = {
    ...input,
    categoryId,
    subCategoryId,
  }

  return runCommand(ctx, () => {
    const state = loadOperation(ctx, input.id)

    const similarIds = input.applyToSimilar
      ? similarOperationIds(ctx, state.libelleSimplifie, input.id)
      : []

    appendAndProject(ctx, {
      streamId: operationStreamId(state.id),
      expectedVersion: state.version,
      events: decideUpdate(state, command).map((event) => ({
        ...event,
        metadata: createMetadata('ui'),
      })),
    })

    for (const similarId of similarIds) {
      const similar = loadOperation(ctx, similarId)
      appendAndProject(ctx, {
        streamId: operationStreamId(similarId),
        expectedVersion: similar.version,
        events: decideCategorize(similar, categoryId, subCategoryId).map(
          (event) => ({ ...event, metadata: createMetadata('ui') }),
        ),
      })
    }

    const projected = ctx.db
      .select({ isRecurring: operations.isRecurring })
      .from(operations)
      .where(eq(operations.id, input.id))
      .get()

    return {
      id: input.id,
      updatedSimilar: similarIds.length,
      updatedSimilarIds: similarIds,
      categoryId,
      subCategoryId,
      isRecurring: projected?.isRecurring ?? false,
    }
  })
}
