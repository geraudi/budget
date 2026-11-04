import type { AppContext } from '#/infrastructure/context'
import {
  listCategories,
  type CategoryWithSubCategories,
} from '#/lib/categories-core'

export type { CategoryWithSubCategories }

export function getCategories(ctx: AppContext): CategoryWithSubCategories[] {
  return listCategories(ctx.db)
}
