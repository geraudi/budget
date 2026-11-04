import { eq } from 'drizzle-orm'

import type { AppDb } from '#/db/create'
import { categories, subCategories } from '#/db/schema'

export type SubCategoryOption = {
  id: number
  name: string
}

export type CategoryWithSubCategories = {
  id: number
  name: string
  subCategories: SubCategoryOption[]
}

export type CategoryLink = {
  categoryId: number | null
  subCategoryId: number | null
}

type CategoryLinkInput = {
  categorie: string | null
  sousCategorie: string | null
}

export function normalizeCategoryName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function pairKey(categoryId: number, normalizedSubCategory: string): string {
  return `${categoryId}\u001f${normalizedSubCategory}`
}

/**
 * Returns categories with their sub-categories, sorted for the UI.
 */
export function listCategories(db: AppDb): CategoryWithSubCategories[] {
  const categoryRows = db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .all()
  const subCategoryRows = db
    .select({
      id: subCategories.id,
      categoryId: subCategories.categoryId,
      name: subCategories.name,
    })
    .from(subCategories)
    .all()

  const byId = new Map<number, CategoryWithSubCategories>()
  for (const category of categoryRows) {
    byId.set(category.id, { ...category, subCategories: [] })
  }
  for (const subCategory of subCategoryRows) {
    byId.get(subCategory.categoryId)?.subCategories.push({
      id: subCategory.id,
      name: subCategory.name,
    })
  }

  return [...byId.values()]
    .map((category) => ({
      ...category,
      subCategories: category.subCategories.sort((a, b) =>
        a.name.localeCompare(b.name, 'fr'),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/**
 * Ensures the categories/sub-categories referenced by the given rows
 * exist, then returns the matching ids for each row.
 *
 * Names are matched accent-insensitively so that spelling variants
 * from the bank export converge on the same category.
 */
export function resolveCategoryLinks(
  db: AppDb,
  rows: CategoryLinkInput[],
): CategoryLink[] {
  const categoryNames = new Map<string, string>()
  const subCategoryNames = new Map<
    string,
    { categoryKey: string; normalizedName: string; name: string }
  >()

  for (const row of rows) {
    if (!row.categorie) continue

    const categoryKey = normalizeCategoryName(row.categorie)
    if (!categoryNames.has(categoryKey)) {
      categoryNames.set(categoryKey, row.categorie.trim())
    }

    if (!row.sousCategorie) continue
    const subCategoryName = row.sousCategorie.trim()
    if (!subCategoryName) continue

    const normalizedName = normalizeCategoryName(subCategoryName)
    const mapKey = `${categoryKey}\u001f${normalizedName}`
    if (!subCategoryNames.has(mapKey)) {
      subCategoryNames.set(mapKey, {
        categoryKey,
        normalizedName,
        name: subCategoryName,
      })
    }
  }

  for (const [normalizedName, name] of categoryNames) {
    db.insert(categories)
      .values({ name, normalizedName })
      .onConflictDoNothing()
      .run()
  }

  const categoryIdByKey = new Map(
    db
      .select({ id: categories.id, normalizedName: categories.normalizedName })
      .from(categories)
      .all()
      .map((category) => [category.normalizedName, category.id]),
  )

  for (const subCategory of subCategoryNames.values()) {
    const categoryId = categoryIdByKey.get(subCategory.categoryKey)
    if (!categoryId) continue

    db.insert(subCategories)
      .values({
        categoryId,
        name: subCategory.name,
        normalizedName: subCategory.normalizedName,
      })
      .onConflictDoNothing()
      .run()
  }

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
        pairKey(subCategory.categoryId, subCategory.normalizedName),
        subCategory.id,
      ]),
  )

  return rows.map((row) => {
    if (!row.categorie) {
      return { categoryId: null, subCategoryId: null }
    }

    const categoryId =
      categoryIdByKey.get(normalizeCategoryName(row.categorie)) ?? null
    const subCategoryId =
      categoryId !== null && row.sousCategorie
        ? (subCategoryIdByKey.get(
            pairKey(categoryId, normalizeCategoryName(row.sousCategorie)),
          ) ?? null)
        : null

    return { categoryId, subCategoryId }
  })
}

export function getSubCategoryCategoryId(
  db: AppDb,
  id: number,
): number | null {
  const row = db
    .select({ categoryId: subCategories.categoryId })
    .from(subCategories)
    .where(eq(subCategories.id, id))
    .get()
  return row?.categoryId ?? null
}

export function categoryExists(db: AppDb, id: number): boolean {
  return Boolean(
    db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, id))
      .get(),
  )
}
