import { describe, expect, it } from 'vitest'

import {
  defaultClassificationRules,
  resolveClassification,
  type ClassificationRule,
} from './classification'

const rules: ClassificationRule[] = [
  {
    categoryId: 1,
    subCategoryId: null,
    kind: 'expense',
    nature: 'essential',
    confidence: 0.9,
  },
  {
    categoryId: 1,
    subCategoryId: 2,
    kind: 'expense',
    nature: 'discretionary',
    confidence: 0.8,
  },
  {
    categoryId: 3,
    subCategoryId: null,
    kind: 'income',
    nature: null,
    confidence: 0.2,
  },
  {
    categoryId: 4,
    subCategoryId: null,
    kind: 'debt_payment',
    nature: null,
    confidence: 1,
  },
]

function resolve(
  montant: number,
  categoryId: number | null,
  subCategoryId: number | null = null,
) {
  return resolveClassification(
    { montant, categoryId, subCategoryId },
    rules,
  )
}

describe('resolveClassification', () => {
  it('uses the category rule when there is no sub-category rule', () => {
    expect(resolve(-20, 1)).toEqual({
      kind: 'expense',
      nature: 'essential',
      classificationSource: 'rule',
      classificationConfidence: 0.9,
    })
  })

  it('prefers the sub-category rule over the category rule', () => {
    expect(resolve(-20, 1, 2)).toMatchObject({
      kind: 'expense',
      nature: 'discretionary',
      classificationConfidence: 0.8,
    })
  })

  it('turns a positive amount in an expense category into a refund', () => {
    expect(resolve(20, 1)).toEqual({
      kind: 'refund',
      nature: null,
      classificationSource: 'rule',
      classificationConfidence: 0.81,
    })
  })

  it('turns a negative income into a refund', () => {
    expect(resolve(-20, 3)).toMatchObject({
      kind: 'refund',
      nature: null,
      classificationConfidence: 0.18,
    })
  })

  it('never keeps a nature on a non-expense kind', () => {
    expect(resolve(-300, 4)).toMatchObject({
      kind: 'debt_payment',
      nature: null,
    })
  })

  it('falls back to the sign when no rule matches', () => {
    expect(resolve(12.5, null, null)).toEqual({
      kind: 'income',
      nature: null,
      classificationSource: 'import',
      classificationConfidence: 0.1,
    })
    expect(resolve(-12.5, null, null)).toEqual({
      kind: 'expense',
      nature: null,
      classificationSource: 'import',
      classificationConfidence: 0.1,
    })
  })

  it('does not match a sub-category rule from another category', () => {
    expect(resolve(-20, 1, 999)).toMatchObject({
      nature: 'essential',
      classificationConfidence: 0.9,
    })
  })
})

describe('defaultClassificationRules', () => {
  it('keeps unqualified incoming transfers below the qualification threshold', () => {
    const rule = defaultClassificationRules.find(
      (candidate) =>
        candidate.category === "A categoriser - rentree d'argent" &&
        candidate.subCategory === undefined,
    )
    expect(rule).toMatchObject({ kind: 'income', confidence: 0.2 })
  })

  it('classifies credit repayments as debt payments', () => {
    const rule = defaultClassificationRules.find(
      (candidate) => candidate.subCategory === 'Credit',
    )
    expect(rule).toMatchObject({ kind: 'debt_payment' })
  })

  it('classifies internal transfers as transfers', () => {
    const rule = defaultClassificationRules.find(
      (candidate) => candidate.subCategory === 'Virement interne',
    )
    expect(rule).toMatchObject({ kind: 'transfer' })
  })
})
