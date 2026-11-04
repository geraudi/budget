import Database from 'better-sqlite3'

const url = process.env.DATABASE_URL ?? '.db/budget.dev.db'
const db = new Database(url)

function gcd(a, b) {
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a
}

function monthToIndex(month) {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1
}

const table = db
  .prepare(
    "select name from sqlite_master where type = 'table' and name = 'recurring_operations'",
  )
  .get()

if (!table) {
  console.error(
    'La table recurring_operations est absente. Appliquez la migration drizzle/0004_add_recurring_operations.sql avant de lancer ce script.',
  )
  process.exit(1)
}

const existing = db
  .prepare('select count(*) as count from recurring_operations')
  .get()

if (existing.count > 0) {
  console.log(
    `La table recurring_operations contient déjà ${existing.count} ligne(s), aucun seed appliqué.`,
  )
  process.exit(0)
}

const labels = db
  .prepare('select pattern from recurring_labels order by id')
  .all()
const operations = db
  .prepare(
    'select libelle_simplifie, libelle_operation, date_comptabilisation, montant from operations',
  )
  .all()

const insert = db.prepare(`
  insert into recurring_operations
    (libelle_simplifie, montant, interval_months, first_month, duration_type, created_at)
  values
    (?, ?, ?, ?, 'unlimited', ?)
`)

const inserted = []
const seenLabels = new Set()

const seed = db.transaction(() => {
  for (const { pattern } of labels) {
    let regex
    try {
      regex = new RegExp(pattern, 'iu')
    } catch {
      console.warn(`Motif ignoré (regex invalide) : ${pattern}`)
      continue
    }

    const matches = operations.filter((op) => regex.test(op.libelle_operation))
    if (matches.length === 0) {
      console.warn(`Motif ignoré (aucune opération) : ${pattern}`)
      continue
    }

    const labelCounts = new Map()
    for (const match of matches) {
      labelCounts.set(
        match.libelle_simplifie,
        (labelCounts.get(match.libelle_simplifie) ?? 0) + 1,
      )
    }
    const [label] = [...labelCounts.entries()].sort((a, b) => b[1] - a[1])[0]

    if (seenLabels.has(label)) {
      console.warn(`Motif ignoré (libellé déjà migré) : ${pattern} → ${label}`)
      continue
    }
    seenLabels.add(label)

    const monthly = new Map()
    for (const op of operations) {
      if (op.libelle_simplifie !== label) continue
      const month = op.date_comptabilisation.slice(0, 7)
      monthly.set(month, (monthly.get(month) ?? 0) + op.montant)
    }

    const months = [...monthly.keys()].sort()
    const firstMonth = months[0]
    const latestMonth = months[months.length - 1]
    const montant = monthly.get(latestMonth)

    let interval = 0
    for (let index = 1; index < months.length; index++) {
      interval = gcd(interval, monthToIndex(months[index]) - monthToIndex(months[index - 1]))
    }
    interval = interval || 1

    insert.run(label, montant, interval, firstMonth, new Date().toISOString())
    inserted.push({
      pattern,
      label,
      montant,
      interval,
      firstMonth,
    })
  }
})

seed()

if (inserted.length === 0) {
  console.log('Aucune opération récurrente à migrer.')
  process.exit(0)
}

console.log(`${inserted.length} opération(s) récurrente(s) migrée(s) :`)
for (const row of inserted) {
  console.log(
    `  ${row.label} · ${row.montant.toFixed(2)} € · tous les ${row.interval} mois · depuis ${row.firstMonth}`,
  )
}
