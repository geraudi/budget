import Database from 'better-sqlite3'

const url = process.env.DATABASE_URL ?? '.db/budget.dev.db'
const db = new Database(url)

function normalizeName(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function accentCount(value) {
  return (value.normalize('NFD').match(/[\u0300-\u036f]/g) ?? []).length
}

/**
 * The bank export uses both "rentrees" and "rentrées" for the same
 * category. Keep the accented spelling as the canonical name.
 */
const CANONICAL_CATEGORY_NAMES = new Map([
  ["revenus et rentrees d'argent", "Revenus et rentrées d'argent"],
])

function chooseName(variants, normalizedKey) {
  const override = CANONICAL_CATEGORY_NAMES.get(normalizedKey)
  if (override) return override

  return [...variants.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      accentCount(b[0]) - accentCount(a[0]) ||
      a[0].localeCompare(b[0], 'fr'),
  )[0][0]
}

function hasTable(name) {
  return Boolean(
    db
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(name),
  )
}

function operationColumns() {
  return new Set(db.prepare('pragma table_info(operations)').all().map((c) => c.name))
}

if (!hasTable('categories') || !hasTable('sub_categories')) {
  console.error(
    'Les tables categories/sub_categories sont absentes. Appliquez la migration drizzle/0005_*.sql avant de lancer ce script.',
  )
  process.exit(1)
}

const columns = operationColumns()
const missingColumns = ['category_id', 'sub_category_id'].filter(
  (name) => !columns.has(name),
)
if (missingColumns.length > 0) {
  console.error(
    `Colonnes manquantes sur operations : ${missingColumns.join(', ')}. Appliquez la migration drizzle/0005_*.sql avant de lancer ce script.`,
  )
  process.exit(1)
}

const sourceColumns = ['categorie', 'sous_categorie'].filter((name) =>
  columns.has(name),
)
if (sourceColumns.length < 2) {
  console.log(
    'Les colonnes texte categorie/sous_categorie ne sont plus présentes : le backfill a déjà été appliqué.',
  )
  process.exit(0)
}

const rows = db
  .prepare('select id, categorie, sous_categorie from operations order by id')
  .all()

const categoryGroups = new Map()

for (const row of rows) {
  const categoryName = row.categorie?.trim()
  if (!categoryName) continue

  const categoryKey = normalizeName(categoryName)
  let group = categoryGroups.get(categoryKey)
  if (!group) {
    group = {
      variants: new Map(),
      subCategories: new Map(),
    }
    categoryGroups.set(categoryKey, group)
  }
  group.variants.set(
    categoryName,
    (group.variants.get(categoryName) ?? 0) + 1,
  )

  const subCategoryName = row.sous_categorie?.trim()
  if (!subCategoryName) continue

  const subCategoryKey = normalizeName(subCategoryName)
  let subVariants = group.subCategories.get(subCategoryKey)
  if (!subVariants) {
    subVariants = new Map()
    group.subCategories.set(subCategoryKey, subVariants)
  }
  subVariants.set(subCategoryName, (subVariants.get(subCategoryName) ?? 0) + 1)
}

const selectCategory = db.prepare(
  'select id, name from categories where normalized_name = ?',
)
const insertCategory = db.prepare(`
  insert into categories (name, normalized_name, created_at)
  values (?, ?, ?)
  on conflict(normalized_name) do nothing
`)
const updateCategoryName = db.prepare(
  'update categories set name = ? where id = ?',
)

const selectSubCategory = db.prepare(`
  select id, name from sub_categories
  where category_id = ? and normalized_name = ?
`)
const insertSubCategory = db.prepare(`
  insert into sub_categories (category_id, name, normalized_name, created_at)
  values (?, ?, ?, ?)
  on conflict(category_id, normalized_name) do nothing
`)
const updateSubCategoryName = db.prepare(
  'update sub_categories set name = ? where id = ?',
)

const updateOperation = db.prepare(
  'update operations set category_id = ?, sub_category_id = ? where id = ?',
)

let categoriesCreated = 0
let subCategoriesCreated = 0

const seed = db.transaction(() => {
  const now = new Date().toISOString()
  const categoryIds = new Map()
  const subCategoryIds = new Map()

  for (const [categoryKey, group] of categoryGroups) {
    const name = chooseName(group.variants, categoryKey)
    let category = selectCategory.get(categoryKey)

    if (!category) {
      insertCategory.run(name, categoryKey, now)
      category = selectCategory.get(categoryKey)
      categoriesCreated += 1
    } else if (category.name !== name) {
      updateCategoryName.run(name, category.id)
      category.name = name
    }

    categoryIds.set(categoryKey, category.id)

    for (const [subCategoryKey, variants] of group.subCategories) {
      const subName = chooseName(variants, `${categoryKey}\u001f${subCategoryKey}`)
      let subCategory = selectSubCategory.get(category.id, subCategoryKey)

      if (!subCategory) {
        insertSubCategory.run(category.id, subName, subCategoryKey, now)
        subCategory = selectSubCategory.get(category.id, subCategoryKey)
        subCategoriesCreated += 1
      } else if (subCategory.name !== subName) {
        updateSubCategoryName.run(subName, subCategory.id)
        subCategory.name = subName
      }

      subCategoryIds.set(
        `${categoryKey}\u001f${subCategoryKey}`,
        subCategory.id,
      )
    }
  }

  for (const row of rows) {
    const categoryName = row.categorie?.trim()
    if (!categoryName) {
      updateOperation.run(null, null, row.id)
      continue
    }

    const categoryKey = normalizeName(categoryName)
    const categoryId = categoryIds.get(categoryKey) ?? null
    const subCategoryName = row.sous_categorie?.trim()
    const subCategoryId = subCategoryName
      ? (subCategoryIds.get(
          `${categoryKey}\u001f${normalizeName(subCategoryName)}`,
        ) ?? null)
      : null

    updateOperation.run(categoryId, subCategoryId, row.id)
  }
})

seed()

const totals = db
  .prepare(`
    select
      (select count(*) from categories) as categories,
      (select count(*) from sub_categories) as sub_categories,
      (select count(*) from operations where category_id is not null) as linked,
      (select count(*) from operations where sub_category_id is not null) as sub_linked,
      (select count(*) from operations) as operations
  `)
  .get()

console.log(
  `${categoriesCreated} catégorie(s) créée(s), ${subCategoriesCreated} sous-catégorie(s) créée(s).`,
)
console.log(
  `Base : ${totals.categories} catégories, ${totals.sub_categories} sous-catégories.`,
)
console.log(
  `Opérations liées : ${totals.linked}/${totals.operations} (catégorie), ${totals.sub_linked}/${totals.operations} (sous-catégorie).`,
)

if (totals.linked < totals.operations) {
  console.warn(
    `${totals.operations - totals.linked} opération(s) sans catégorie source : elles restent non catégorisées.`,
  )
}

db.close()
