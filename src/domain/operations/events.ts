/**
 * Domain events for the Operation aggregate.
 *
 * The event payloads contain business data only. Derived values such as
 * `fingerprint` and `isRecurring` are computed by the read-model projector.
 */

import type { NewEvent, StoredEvent } from '#/domain/events/envelope'
import type { OperationClassification } from './classification'

export type { EventMetadata } from '#/domain/events/envelope'

export type OperationDetails = {
  dateComptabilisation: string
  libelleSimplifie: string
  libelleOperation: string
  reference: string | null
  infosComplementaires: string | null
  typeOperation: string | null
  categoryId: number | null
  subCategoryId: number | null
  debit: number | null
  credit: number | null
  montant: number
  dateOperation: string | null
  dateValeur: string | null
  pointage: number | null
}

export type OperationDetailsPatch = Partial<
  Omit<OperationDetails, 'categoryId' | 'subCategoryId'>
>

export type OperationEvent =
  | { type: 'OperationImported'; payload: OperationDetails }
  | { type: 'OperationDetailsUpdated'; payload: OperationDetailsPatch }
  | {
      type: 'OperationCategorized'
      payload: { categoryId: number | null; subCategoryId: number | null }
    }
  | { type: 'OperationClassified'; payload: OperationClassification }
  | { type: 'OperationPointageChanged'; payload: { pointage: number } }
  | { type: 'OperationDeleted'; payload: Record<string, never> }

export type OperationEventType = OperationEvent['type']

export type NewOperationEvent = NewEvent<OperationEvent>

export type StoredOperationEvent = StoredEvent<OperationEvent>

export type OperationState = OperationDetails & {
  id: number
  version: number
  deleted: boolean
  /** Last manual classification override, if any. Defaults are derived. */
  classification: OperationClassification | null
}
