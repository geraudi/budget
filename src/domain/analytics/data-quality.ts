import { QUALIFIED_CLASSIFICATION_CONFIDENCE } from '#/domain/operations/classification'
import type { AnalyticsOperation, DataQualityIndicators } from './types'

export type DataQualityInput = {
  operations: ReadonlyArray<
    Pick<
      AnalyticsOperation,
      'categoryId' | 'classificationConfidence' | 'classificationSource'
    >
  >
  monthsAvailable: number
  pairingConfidence: number
  unclassifiedPairs: number
  detectedPairs: number
  transferCount: number
  qualifiedIncome: number
  unqualifiedIncome: number
  totalIncome: number
  savingsRate: number
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function percent(value: number): number {
  return Math.round(value * 100)
}

/**
 * Summarises how much confidence the figures deserve.
 *
 * Warnings are part of the contract: phase C's prompt must change its answer
 * when they are present, rather than presenting shaky aggregates as facts.
 */
export function computeDataQuality(
  input: DataQualityInput,
): DataQualityIndicators {
  const total = input.operations.length
  const lowConfidence = input.operations.filter(
    (operation) =>
      operation.categoryId === null ||
      operation.classificationSource === null ||
      operation.classificationConfidence === null ||
      operation.classificationConfidence <
        QUALIFIED_CLASSIFICATION_CONFIDENCE,
  ).length

  const confidenceSum = input.operations.reduce(
    (sum, operation) => sum + (operation.classificationConfidence ?? 0),
    0,
  )

  const uncategorizedShare = total === 0 ? 0 : lowConfidence / total
  const classificationConfidence = total === 0 ? 0 : confidenceSum / total
  const unqualifiedIncomeShare =
    input.totalIncome === 0 ? 0 : input.unqualifiedIncome / input.totalIncome

  const warnings: string[] = []

  if (input.monthsAvailable < 6) {
    warnings.push(
      `Historique de ${input.monthsAvailable} mois : les tendances restent fragiles.`,
    )
  }

  if (uncategorizedShare > 0.1) {
    warnings.push(
      `${percent(uncategorizedShare)} % des opérations ne sont pas qualifiées ` +
        '(catégorie absente ou confiance insuffisante).',
    )
  }

  if (unqualifiedIncomeShare > 0.1) {
    warnings.push(
      `${percent(unqualifiedIncomeShare)} % des revenus probables ne sont pas ` +
        'qualifiés : les ratios (taux d’épargne, 50/30/20) ne sont pas fiables.',
    )
  }

  if (input.unclassifiedPairs > 0) {
    warnings.push(
      `${input.unclassifiedPairs} paire(s) de montants opposés ne sont pas ` +
        'classées en transfert : le solde net peut être faussé.',
    )
  } else if (input.transferCount > 0 && input.detectedPairs === 0) {
    warnings.push(
      'Aucun transfert interne confirmé par appariement : vérifier les ' +
        'virements non qualifiés.',
    )
  } else if (input.pairingConfidence < 0.5) {
    warnings.push(
      `Transferts internes partiellement appariés (${percent(input.pairingConfidence)} %) : ` +
        'vérifier les virements non qualifiés.',
    )
  }

  if (input.qualifiedIncome <= 0) {
    warnings.push(
      'Aucun revenu qualifié sur la période : le taux d’épargne n’est pas interprétable.',
    )
  } else if (input.savingsRate < 0) {
    warnings.push('Le solde net est négatif sur la période.')
  }

  return {
    monthsAvailable: input.monthsAvailable,
    uncategorizedShare: round4(uncategorizedShare),
    unqualifiedIncomeShare: round4(unqualifiedIncomeShare),
    classificationConfidence: round4(classificationConfidence),
    warnings,
  }
}
