/**
 * Classification of an operation: accounting nature (`kind`) and, for
 * expenses, essential / discretionary / exceptional (`nature`).
 *
 * Defaults come from `category_classification_rules`. They are derived data:
 * the projector resolves them from the current category, so a full replay
 * always produces the same projection. A manual `OperationClassified` event
 * is the only persistent override.
 */

export const operationKinds = [
  'income',
  'expense',
  'transfer',
  'savings',
  'debt_payment',
  'refund',
  'excluded',
] as const

export type OperationKind = (typeof operationKinds)[number]

export const operationNatures = [
  'essential',
  'discretionary',
  'exceptional',
] as const

export type OperationNature = (typeof operationNatures)[number]

export const classificationSources = ['rule', 'manual', 'import'] as const

export type ClassificationSource = (typeof classificationSources)[number]

export type OperationClassification = {
  kind: OperationKind
  nature: OperationNature | null
  classificationSource: ClassificationSource
  classificationConfidence: number
}

/** Below this confidence an income is reported as "unqualified". */
export const QUALIFIED_CLASSIFICATION_CONFIDENCE = 0.5

/** Confidence used when no rule covers the operation (sign-only fallback). */
export const FALLBACK_CLASSIFICATION_CONFIDENCE = 0.1

export function isOperationKind(value: unknown): value is OperationKind {
  return (
    typeof value === 'string' &&
    (operationKinds as ReadonlyArray<string>).includes(value)
  )
}

export function isOperationNature(value: unknown): value is OperationNature {
  return (
    typeof value === 'string' &&
    (operationNatures as ReadonlyArray<string>).includes(value)
  )
}

export type ClassifiableOperation = {
  montant: number
  categoryId: number | null
  subCategoryId: number | null
}

export type ClassificationRule = {
  categoryId: number | null
  subCategoryId: number | null
  kind: OperationKind
  nature: OperationNature | null
  confidence: number
}

export type DefaultClassificationRule = {
  /** Human-readable category name, normalized when seeded. */
  category: string
  /** Human-readable sub-category name, normalized when seeded. */
  subCategory?: string
  kind: OperationKind
  nature?: OperationNature | null
  confidence: number
}

/**
 * Default rules, seeded into `category_classification_rules` on first run.
 *
 * Category rules act as a fallback; sub-category rules win. Confidence is
 * deliberately low on "à catégoriser" buckets so `dataQuality` reports them
 * instead of presenting them as qualified figures.
 */
export const defaultClassificationRules: ReadonlyArray<DefaultClassificationRule> =
  [
    // Revenus
    {
      category: "Revenus et rentrées d'argent",
      kind: 'income',
      confidence: 1,
    },
    {
      category: "Revenus et rentrées d'argent",
      subCategory: 'Remboursements de soins',
      kind: 'refund',
      confidence: 1,
    },
    {
      category: "A categoriser - rentree d'argent",
      kind: 'income',
      confidence: 0.2,
    },
    {
      category: "A categoriser - rentree d'argent",
      subCategory: 'Remise de cheque - a categoriser',
      kind: 'income',
      confidence: 0.2,
    },

    // Transferts internes
    { category: 'Transaction exclue', kind: 'transfer', confidence: 1 },
    {
      category: 'Transaction exclue',
      subCategory: 'Virement interne',
      kind: 'transfer',
      confidence: 1,
    },
    {
      category: "A categoriser - sortie d'argent",
      subCategory: 'Virement emis - a categoriser',
      kind: 'transfer',
      confidence: 0.3,
    },

    // Sorties non qualifiées : montant compté, nature inconnue
    {
      category: "A categoriser - sortie d'argent",
      kind: 'expense',
      confidence: 0.2,
    },

    // Banque et assurances
    {
      category: 'Banque et assurances',
      kind: 'expense',
      nature: 'essential',
      confidence: 0.8,
    },
    {
      category: 'Banque et assurances',
      subCategory: 'Credit',
      kind: 'debt_payment',
      confidence: 1,
    },
    {
      category: 'Banque et assurances',
      subCategory: 'Frais bancaires',
      kind: 'expense',
      nature: 'essential',
      confidence: 0.7,
    },

    // Alimentation
    {
      category: 'Alimentation',
      kind: 'expense',
      nature: 'essential',
      confidence: 0.9,
    },
    {
      category: 'Alimentation',
      subCategory: 'Restaurant',
      kind: 'expense',
      nature: 'discretionary',
      confidence: 0.8,
    },
    {
      category: 'Alimentation',
      subCategory: 'Restauration rapide',
      kind: 'expense',
      nature: 'discretionary',
      confidence: 0.8,
    },

    // Logement
    {
      category: 'Logement - maison',
      kind: 'expense',
      nature: 'essential',
      confidence: 0.9,
    },
    {
      category: 'Logement - maison',
      subCategory: 'Ameublement et appareil',
      kind: 'expense',
      nature: 'discretionary',
      confidence: 0.7,
    },
    {
      category: 'Logement - maison',
      subCategory: 'Travaux - Entretien',
      kind: 'expense',
      nature: 'exceptional',
      confidence: 0.6,
    },

    // Loisirs
    {
      category: 'Loisirs et vacances',
      kind: 'expense',
      nature: 'discretionary',
      confidence: 0.9,
    },

    // Impôts et juridique
    {
      category: 'Impots et taxes',
      kind: 'expense',
      nature: 'essential',
      confidence: 0.9,
    },
    {
      category: 'Juridique et administratif',
      kind: 'expense',
      nature: 'exceptional',
      confidence: 0.8,
    },

    // Santé
    {
      category: 'Sante',
      kind: 'expense',
      nature: 'essential',
      confidence: 0.95,
    },

    // Shopping
    {
      category: 'Shopping et services',
      kind: 'expense',
      nature: 'discretionary',
      confidence: 0.9,
    },
    {
      category: 'Shopping et services',
      subCategory: 'Cadeaux et dons',
      kind: 'expense',
      nature: 'discretionary',
      confidence: 0.6,
    },

    // Transports
    {
      category: 'Transports',
      kind: 'expense',
      nature: 'essential',
      confidence: 0.8,
    },
    {
      category: 'Transports',
      subCategory: 'Trains, avions et ferrys',
      kind: 'expense',
      nature: 'discretionary',
      confidence: 0.6,
    },
  ]

function findRule(
  operation: Pick<ClassifiableOperation, 'categoryId' | 'subCategoryId'>,
  rules: ReadonlyArray<ClassificationRule>,
): ClassificationRule | null {
  if (operation.subCategoryId !== null) {
    const subCategoryRule = rules.find(
      (rule) =>
        rule.subCategoryId !== null &&
        rule.subCategoryId === operation.subCategoryId,
    )
    if (subCategoryRule) return subCategoryRule
  }

  if (operation.categoryId !== null) {
    const categoryRule = rules.find(
      (rule) =>
        rule.subCategoryId === null &&
        rule.categoryId === operation.categoryId,
    )
    if (categoryRule) return categoryRule
  }

  return null
}

/**
 * A positive amount in an expense category is a refund, not an income: it
 * must not inflate the income figures. Symmetrically, a negative income is
 * treated as a refund.
 */
function adaptToAmount(
  classification: OperationClassification,
  montant: number,
): OperationClassification {
  if (
    (classification.kind === 'expense' ||
      classification.kind === 'debt_payment') &&
    montant > 0
  ) {
    return {
      ...classification,
      kind: 'refund',
      nature: null,
      classificationConfidence: roundConfidence(
        classification.classificationConfidence * 0.9,
      ),
    }
  }

  if (classification.kind === 'income' && montant < 0) {
    return {
      ...classification,
      kind: 'refund',
      nature: null,
      classificationConfidence: roundConfidence(
        classification.classificationConfidence * 0.9,
      ),
    }
  }

  return classification
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Resolves the default classification of an operation.
 *
 * Sub-category rule > category rule > sign-only fallback. The result is
 * always a complete classification, so the projection never stores a
 * half-filled row.
 */
export function resolveClassification(
  operation: ClassifiableOperation,
  rules: ReadonlyArray<ClassificationRule>,
): OperationClassification {
  const rule = findRule(operation, rules)

  if (!rule) {
    return {
      kind: operation.montant >= 0 ? 'income' : 'expense',
      nature: null,
      classificationSource: 'import',
      classificationConfidence: FALLBACK_CLASSIFICATION_CONFIDENCE,
    }
  }

  const base: OperationClassification = {
    kind: rule.kind,
    nature: rule.kind === 'expense' ? rule.nature : null,
    classificationSource: 'rule',
    classificationConfidence: roundConfidence(rule.confidence),
  }

  return adaptToAmount(base, operation.montant)
}
