import { createServerFn } from '@tanstack/react-start'

import {
  getOperationHistory as getOperationHistoryQuery,
  getSimilarOperations as querySimilarOperations,
  listOperations,
  type Operation,
  type OperationHistoryEntry,
  type SimilarOperation,
} from '#/application/queries/operations'
import {
  updateOperation as updateOperationCommand,
  type SaveOperationInput,
  type UpdateOperationInput,
} from '#/application/commands/update-operation'
import { setOperationPointage as setOperationPointageCommand } from '#/application/commands/set-operation-pointage'
import { deleteOperation as deleteOperationCommandFn } from '#/application/commands/delete-operation'
import { getContext } from '#/infrastructure/app-context'

export type {
  Operation,
  OperationHistoryEntry,
  SimilarOperation,
  UpdateOperationInput,
}

function toId(value: unknown, label = 'Identifiant'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} invalide`)
  }
  return value
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  return str === '' ? null : str
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) throw new Error('Nombre invalide')
  return num
}

function toIdOrNull(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null
  return toId(Number(value), label)
}

export const getOperations = createServerFn({ method: 'GET' }).handler(
  async () => listOperations(getContext()),
)

export const getSimilarOperations = createServerFn({ method: 'GET' })
  .validator((data: unknown): { id: number } => {
    if (!data || typeof data !== 'object') {
      throw new Error('Données invalides')
    }
    return { id: toId((data as Record<string, unknown>).id) }
  })
  .handler(({ data }) => querySimilarOperations(getContext(), data.id))

export const getOperationHistory = createServerFn({ method: 'GET' })
  .validator((data: unknown): { id: number } => {
    if (!data || typeof data !== 'object') {
      throw new Error('Données invalides')
    }
    return { id: toId((data as Record<string, unknown>).id) }
  })
  .handler(({ data }) => getOperationHistoryQuery(getContext(), data.id))

export const updateOperation = createServerFn({ method: 'POST' })
  .validator((data: unknown): SaveOperationInput => {
    if (!data || typeof data !== 'object') {
      throw new Error('Données invalides')
    }
    const d = data as Record<string, unknown>
    const dateComptabilisation = toStringOrNull(d.dateComptabilisation)
    if (!dateComptabilisation) {
      throw new Error('Date de comptabilisation requise')
    }
    const libelleSimplifie = toStringOrNull(d.libelleSimplifie)
    if (!libelleSimplifie) throw new Error('Libellé simplifié requis')
    const libelleOperation = toStringOrNull(d.libelleOperation)
    if (!libelleOperation) throw new Error('Libellé opération requis')
    const montant = toNumberOrNull(d.montant)
    if (montant === null) throw new Error('Montant requis')

    return {
      id: toId(d.id),
      dateComptabilisation,
      libelleSimplifie,
      libelleOperation,
      reference: toStringOrNull(d.reference),
      infosComplementaires: toStringOrNull(d.infosComplementaires),
      typeOperation: toStringOrNull(d.typeOperation),
      categoryId: toIdOrNull(d.categoryId, 'Catégorie'),
      subCategoryId: toIdOrNull(d.subCategoryId, 'Sous-catégorie'),
      debit: toNumberOrNull(d.debit),
      credit: toNumberOrNull(d.credit),
      montant,
      dateOperation: toStringOrNull(d.dateOperation),
      dateValeur: toStringOrNull(d.dateValeur),
      pointage: toNumberOrNull(d.pointage),
      applyToSimilar: d.applyToSimilar === true,
    }
  })
  .handler(({ data }) => updateOperationCommand(getContext(), data))

export const setOperationPointage = createServerFn({ method: 'POST' })
  .validator((data: unknown): { id: number; pointage: number } => {
    if (!data || typeof data !== 'object') {
      throw new Error('Données invalides')
    }
    const d = data as Record<string, unknown>
    const pointage = d.pointage
    if (pointage !== 0 && pointage !== 1) {
      throw new Error('Pointage invalide')
    }
    return { id: toId(d.id), pointage }
  })
  .handler(({ data }) =>
    setOperationPointageCommand(getContext(), data.id, data.pointage),
  )

export const deleteOperation = createServerFn({ method: 'POST' })
  .validator((data: unknown): { id: number } => {
    if (!data || typeof data !== 'object') {
      throw new Error('Données invalides')
    }
    return { id: toId((data as Record<string, unknown>).id) }
  })
  .handler(({ data }) => deleteOperationCommandFn(getContext(), data.id))
