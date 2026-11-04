import { createServerFn } from '@tanstack/react-start'

import {
  importOperations,
  type ImportResult,
} from '#/application/commands/import-operations'
import { getContext } from '#/infrastructure/app-context'
import { parseCsvText } from '#/lib/csv'

export type { ImportResult }

export const importOperationsCsv = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) {
      throw new Error('Fichier CSV attendu')
    }
    const file = data.get('file')
    if (!(file instanceof File)) {
      throw new Error('Fichier CSV attendu')
    }
    return file
  })
  .handler(async ({ data: file }) => {
    const text = new TextDecoder('iso-8859-1').decode(await file.arrayBuffer())
    const { rows, ignored } = parseCsvText(text)

    return importOperations(getContext(), rows, {
      ignored,
      fileName: file.name,
    })
  })
