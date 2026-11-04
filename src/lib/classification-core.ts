import { inArray } from 'drizzle-orm'

import type { AppDb } from '#/db/create'
import {
  categories,
  categoryClassificationRules,
  operations,
  subCategories,
} from '#/db/schema'
import {
  type ClassifiableOperation,
  type ClassificationRule,
  defaultClassificationRules,
  type OperationClassification,
  resolveClassification,
} from '#/domain/operations/classification'
import { normalizeCategoryName } from './categories-core'

type RuleRow = typeof categoryClassificationRules.$inferSelect

/**
 * Seeds the default rules on an empty table.
 *
 * Like recurring patterns, seeding only runs once so that rules edited or
 * deleted afterwards are not silently restored.
 */
export function ensureDefaultClassificationRules(db: AppDb): void {
  const existing = db
    .select({ id: categoryClassificationRules.id })
    .from(categoryClassificationRules)
    .get()
  if (existing) return

  const categoryIdByName = new Map(
    db
      .select({ id: categories.id, normalizedName: categories.normalizedName })
      .from(categories)
      .all()
      .map((category) => [category.normalizedName, category.id]),
  )
  if (categoryIdByName.size === 0) return

  const subCategoryIdByKey = new Map(
    db
      .select({
        id: subCategories.id,
        categoryId: subCategories.categoryId,
        normalizedName: subCategories.normalizedName,
      })
      .from(subCategories)
      .all()
      .map((subCategory) => [
        `${subCategory.categoryId}\u001f${subCategory.normalizedName}`,
        subCategory.id,
      ]),
  )

  const values: Array<typeof categoryClassificationRules.$inferInsert> = []

  for (const rule of defaultClassificationRules) {
    const categoryId = categoryIdByName.get(
      normalizeCategoryName(rule.category),
    )
    if (!categoryId) continue

    const subCategoryId = rule.subCategory
      ? (subCategoryIdByKey.get(
          `${categoryId}\u001f${normalizeCategoryName(rule.subCategory)}`,
        ) ?? null)
      : null

    values.push({
      categoryId,
      subCategoryId,
      kind: rule.kind,
      nature: rule.nature ?? null,
      confidence: rule.confidence,
    })
  }

  if (values.length > 0) {
    db.insert(categoryClassificationRules)
      .values(values)
      .onConflictDoNothing()
      .run()
  }
}

function toRule(row: RuleRow): ClassificationRule {
  return {
    categoryId: row.categoryId,
    subCategoryId: row.subCategoryId,
    kind: row.kind as ClassificationRule['kind'],
    nature: row.nature as ClassificationRule['nature'],
    confidence: row.confidence,
  }
}

export type ClassificationResolver = {
  rules: ReadonlyArray<ClassificationRule>
  resolve(operation: ClassifiableOperation): OperationClassification
}

/** Loads the rules once for a batch of projection work. */
export function createClassificationResolver(
  db: AppDb,
): ClassificationResolver {
  const rules = db
    .select()
    .from(categoryClassificationRules)
    .all()
    .map(toRule)

  return {
    rules,
    resolve: (operation) => resolveClassification(operation, rules),
  }
}

export type RefreshClassificationResult = {
  updated: number
  skippedManual: number
}

/**
 * Re-applies the stored rules to existing projection rows.
 *
 * Used by the backfill script after a migration, and safe to run repeatedly.
 * Manual overrides are never touched. This is projection maintenance (like
 * `refreshRecurringFlags`), not a command: it does not emit events.
 */
export function refreshClassifications(
  db: AppDb,
  operationIds?: ReadonlyArray<number>,
): RefreshClassificationResult {
  if (operationIds !== undefined && operationIds.length === 0) {
    return { updated: 0, skippedManual: 0 }
  }

  ensureDefaultClassificationRules(db)
  const resolver = createClassificationResolver(db)

  const baseQuery = db.select({
    id: operations.id,
    montant: operations.montant,
    categoryId: operations.categoryId,
    subCategoryId: operations.subCategoryId,
    kind: operations.kind,
    nature: operations.nature,
    classificationSource: operations.classificationSource,
    classificationConfidence: operations.classificationConfidence,
  })

  const rows =
    operationIds === undefined
      ? baseQuery.from(operations).all()
      : baseQuery
          .from(operations)
          .where(inArray(operations.id, [...operationIds]))
          .all()

  let updated = 0
  let skippedManual = 0

  for (const row of rows) {
    if (row.classificationSource === 'manual') {
      skippedManual += 1
      continue
    }

    const classification = resolver.resolve(row)
    const unchanged =
      row.kind === classification.kind &&
      row.nature === classification.nature &&
      row.classificationSource === classification.classificationSource &&
      row.classificationConfidence !== null &&
      Math.abs(
        row.classificationConfidence - classification.classificationConfidence,
      ) < 0.0001

    if (unchanged) continue

    db.update(operations)
      .set({
        kind: classification.kind,
        nature: classification.nature,
        classificationSource: classification.classificationSource,
        classificationConfidence: classification.classificationConfidence,
      })
      .where(inArray(operations.id, [row.id]))
      .run()
    updated += 1
  }

  return { updated, skippedManual }
}
