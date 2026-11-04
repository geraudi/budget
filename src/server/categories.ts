import { createServerFn } from '@tanstack/react-start'

import { getCategories as getCategoriesQuery } from '#/application/queries/categories'
import { getContext } from '#/infrastructure/app-context'

export const getCategories = createServerFn({ method: 'GET' }).handler(
  async () => getCategoriesQuery(getContext()),
)
