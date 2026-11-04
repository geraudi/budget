#!/usr/bin/env node
/**
 * Anonymise une copie de la base Budget avant partage (démo, debug, issue).
 *
 * Champs anonymisés sur `operations` :
 *   - libelle_simplifie / libelle_operation / infos_complementaires : libellés
 *     factices stables (une même valeur réelle garde la même valeur factice,
 *     ce qui préserve les regroupements et les doublons) ;
 *   - reference : même longueur et mêmes classes de caractères (chiffre,
 *     lettre, casse, séparateurs), mappage stable pour les références
 *     répétées ;
 *   - debit / credit / montant : ±10 % aléatoires (un seul facteur par
 *     opération, l'invariant montant = debit + credit est conservé) ;
 *   - fingerprint : recalculé avec l'algorithme de `src/lib/csv.ts`.
 *
 * Les tables de récurrence (`recurring_labels.pattern`,
 * `recurring_operations.libelle_simplifie`, `.match_pattern`, `.montant`) sont
 * anonymisées avec les mêmes règles afin qu'aucun commerçant ne fuie. Le
 * rapprochement des opérations récurrentes n'est plus significatif après
 * anonymisation (les motifs ne correspondent plus aux libellés), mais le flag
 * `is_recurring` existant est conservé.
 *
 * Le script écrit par défaut dans une copie (`.db/budget.anonymized.db`) et ne
 * modifie jamais la base source, sauf avec `--in-place`.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

const DEFAULT_SOURCE = '.db/budget.dev.db'
const DEFAULT_DESTINATION = '.db/budget.anonymized.db'
const FINGERPRINT_SEP = '\u001f'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'

const USAGE = `Anonymise une copie de la base Budget.

Usage :
  node scripts/anonymize-db.mjs [options] [source] [destination]

Arguments :
  source        base SQLite à lire (défaut : $DATABASE_URL ou ${DEFAULT_SOURCE})
  destination   copie anonymisée à écrire (défaut : ${DEFAULT_DESTINATION})

Options :
  --in-place    anonymise la base source directement (aucune copie)
  --force       écrase la destination si elle existe déjà
  --seed <n>    graine du générateur aléatoire (défaut : 1)
  -h, --help    affiche cette aide`

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  const options = {
    source: null,
    destination: null,
    inPlace: false,
    force: false,
    seed: 1,
    help: false,
  }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--in-place') {
      options.inPlace = true
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--seed') {
      const value = argv[index + 1]
      if (value === undefined || !/^-?\d+$/.test(value)) {
        fail(`--seed attend un entier.\n\n${USAGE}`)
      }
      options.seed = Number(value)
      index += 1
    } else if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (arg.startsWith('-')) {
      fail(`Option inconnue : ${arg}\n\n${USAGE}`)
    } else {
      positional.push(arg)
    }
  }

  if (positional.length > 2) {
    fail(`Trop d'arguments.\n\n${USAGE}`)
  }

  options.source = positional[0] ?? process.env.DATABASE_URL ?? DEFAULT_SOURCE
  options.destination = positional[1] ?? DEFAULT_DESTINATION
  options.destinationProvided = positional.length > 1
  return options
}

/** Générateur déterministe (mulberry32) : même graine, même anonymisation. */
function createRandom(seed) {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Associe chaque valeur réelle à un libellé factice stable. Les valeurs nulles
 * et vides sont conservées telles quelles.
 */
function createLabelMapper(prefix) {
  const mapping = new Map()
  return (value) => {
    if (value === null || value === undefined) return value
    const original = String(value)
    if (original === '') return original

    let replacement = mapping.get(original)
    if (replacement === undefined) {
      replacement = `${prefix} ${String(mapping.size + 1).padStart(3, '0')}`
      mapping.set(original, replacement)
    }
    return replacement
  }
}

/**
 * Remplace chaque lettre/chiffre par un caractère aléatoire de même classe en
 * conservant la longueur, les séparateurs et la casse. Le mappage est stable :
 * une référence répétée reste répétée.
 */
function createReferenceMapper(random) {
  const mapping = new Map()
  return (value) => {
    if (value === null || value === undefined) return value
    const original = String(value)
    if (original === '') return original

    let replacement = mapping.get(original)
    if (replacement === undefined) {
      replacement = Array.from(original, (char) => {
        if (char >= '0' && char <= '9') {
          return DIGITS[Math.floor(random() * DIGITS.length)]
        }
        if (char >= 'A' && char <= 'Z') {
          return LETTERS[Math.floor(random() * LETTERS.length)]
        }
        if (char >= 'a' && char <= 'z') {
          return LETTERS[
            Math.floor(random() * LETTERS.length)
          ].toLowerCase()
        }
        return char
      }).join('')
      mapping.set(original, replacement)
    }
    return replacement
  }
}

function roundCents(value) {
  return Math.round(value * 100) / 100
}

/**
 * Arrondit au centime sans sortir de la fourchette ±10 % : pour les petits
 * montants, l'arrondi seul peut dépasser la borne (ex. 7,29 → 6,56 = 10,01 %).
 */
function clampedCents(value, rounded) {
  const min = Math.ceil(Math.min(value * 0.9, value * 1.1) * 100) / 100
  const max = Math.floor(Math.max(value * 0.9, value * 1.1) * 100) / 100
  return Math.min(max, Math.max(min, rounded))
}

/**
 * Applique un même facteur (±10 %) au montant et aux colonnes debit/credit
 * pour conserver montant = debit + credit.
 */
function anonymizeAmounts(row, random) {
  const factor = 0.9 + random() * 0.2
  const montant = clampedCents(row.montant, roundCents(row.montant * factor))
  let debit = row.debit
  let credit = row.credit

  if (debit !== null && credit !== null) {
    debit = clampedCents(debit, roundCents(debit * factor))
    credit = roundCents(montant - debit)
  } else if (debit !== null) {
    debit = montant
  } else if (credit !== null) {
    credit = montant
  }

  return { montant, debit, credit }
}

function toNum(value) {
  return value === null ? '' : String(value)
}

/** Même empreinte que `fingerprintOperation` dans src/lib/csv.ts. */
function fingerprint(row) {
  return createHash('sha256')
    .update(
      [
        row.date_comptabilisation,
        row.libelle_simplifie,
        row.libelle_operation,
        row.reference ?? '',
        row.infos_complementaires ?? '',
        row.type_operation ?? '',
        toNum(row.debit),
        toNum(row.credit),
        row.montant,
        row.date_operation ?? '',
        row.date_valeur ?? '',
        toNum(row.pointage),
      ].join(FINGERPRINT_SEP),
    )
    .digest('hex')
}

function tableExists(db, name) {
  return Boolean(
    db
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(name),
  )
}

function tableColumns(db, name) {
  return new Set(
    db
      .prepare(`pragma table_info(${name})`)
      .all()
      .map((column) => column.name),
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }

  const source = resolve(options.source)
  const destination = options.inPlace ? source : resolve(options.destination)

  if (options.inPlace && options.destinationProvided) {
    fail('--in-place ne prend pas de destination : indiquez seulement la base source.')
  }

  if (!existsSync(source)) {
    fail(`Base introuvable : ${source}`)
  }

  if (!options.inPlace && destination === source) {
    fail(
      "La destination est identique à la source : utilisez --in-place pour modifier la base d'origine.",
    )
  }

  if (destination !== source && existsSync(destination)) {
    if (!options.force) {
      fail(
        `La destination existe déjà : ${destination}\nRelancez avec --force pour l'écraser.`,
      )
    }
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${destination}${suffix}`, { force: true })
    }
  }

  if (!options.inPlace) {
    mkdirSync(dirname(destination), { recursive: true })
    const sourceDb = new Database(source, { readonly: true })
    await sourceDb.backup(destination)
    sourceDb.close()
  }

  const db = new Database(destination)
  // Évite que les anciennes valeurs restent lisibles dans les pages libérées.
  db.pragma('secure_delete = ON')

  if (!tableExists(db, 'operations')) {
    fail('La table operations est absente de la base.')
  }

  const columns = tableColumns(db, 'operations')
  const hasFingerprint = columns.has('fingerprint')

  const operationRows = db
    .prepare(
      `select id, date_comptabilisation, libelle_simplifie, libelle_operation,
              reference, infos_complementaires, type_operation, debit, credit,
              montant, date_operation, date_valeur, pointage
       from operations
       order by id`,
    )
    .all()

  const random = createRandom(options.seed)
  const anonymizeSimplifiedLabel = createLabelMapper('LIBELLÉ ANONYMISÉ')
  const anonymizeOperationLabel = createLabelMapper('OPÉRATION ANONYMISÉE')
  const anonymizeInfo = createLabelMapper('INFORMATION ANONYMISÉE')
  const anonymizeReference = createReferenceMapper(random)

  const updateOperation = db.prepare(`
    update operations
    set libelle_simplifie = @libelle_simplifie,
        libelle_operation = @libelle_operation,
        reference = @reference,
        infos_complementaires = @infos_complementaires,
        debit = @debit,
        credit = @credit,
        montant = @montant${hasFingerprint ? ',\n        fingerprint = @fingerprint' : ''}
    where id = @id
  `)

  const anonymizeOperations = db.transaction(() => {
    for (const row of operationRows) {
      const amounts = anonymizeAmounts(row, random)
      const anonymized = {
        id: row.id,
        date_comptabilisation: row.date_comptabilisation,
        libelle_simplifie: anonymizeSimplifiedLabel(row.libelle_simplifie),
        libelle_operation: anonymizeOperationLabel(row.libelle_operation),
        reference: anonymizeReference(row.reference),
        infos_complementaires: anonymizeInfo(row.infos_complementaires),
        type_operation: row.type_operation,
        debit: amounts.debit,
        credit: amounts.credit,
        montant: amounts.montant,
        date_operation: row.date_operation,
        date_valeur: row.date_valeur,
        pointage: row.pointage,
      }

      if (hasFingerprint) {
        anonymized.fingerprint = fingerprint(anonymized)
      }

      updateOperation.run(anonymized)
    }
  })

  anonymizeOperations()

  let recurringOperations = 0
  let recurringPatterns = 0

  if (tableExists(db, 'recurring_operations')) {
    const recurringColumns = tableColumns(db, 'recurring_operations')
    const hasMatchPattern = recurringColumns.has('match_pattern')

    const rows = db
      .prepare(
        `select id, libelle_simplifie, montant${
          hasMatchPattern ? ', match_pattern' : ''
        } from recurring_operations order by id`,
      )
      .all()

    const updateRecurring = db.prepare(`
      update recurring_operations
      set libelle_simplifie = @libelle_simplifie,
          montant = @montant${
            hasMatchPattern ? ',\n          match_pattern = @match_pattern' : ''
          }
      where id = @id
    `)

    const anonymizeRecurring = db.transaction(() => {
      for (const row of rows) {
        const { montant } = anonymizeAmounts(
          { montant: row.montant, debit: null, credit: null },
          random,
        )
        const values = {
          id: row.id,
          libelle_simplifie: anonymizeSimplifiedLabel(row.libelle_simplifie),
          montant,
        }

        if (hasMatchPattern) {
          values.match_pattern =
            row.match_pattern === null
              ? null
              : anonymizeSimplifiedLabel(row.match_pattern)
        }

        updateRecurring.run(values)
        recurringOperations += 1
      }
    })

    anonymizeRecurring()
  }

  if (tableExists(db, 'recurring_labels')) {
    const rows = db
      .prepare('select id, pattern from recurring_labels order by id')
      .all()
    const anonymizePattern = createLabelMapper('MOTIF ANONYMISÉ')
    const updatePattern = db.prepare(
      'update recurring_labels set pattern = ? where id = ?',
    )

    const anonymizeLabels = db.transaction(() => {
      for (const row of rows) {
        updatePattern.run(anonymizePattern(row.pattern), row.id)
        recurringPatterns += 1
      }
    })

    anonymizeLabels()
  }

  // Réécrit le fichier pour ne pas laisser les anciennes valeurs dans les
  // pages libérées (utile même si secure_delete est actif).
  db.exec('VACUUM')
  db.close()

  console.log(`Base source : ${source}`)
  if (destination === source) {
    console.log('Base anonymisée sur place.')
  } else {
    console.log(`Copie anonymisée : ${destination}`)
  }
  console.log(`Graine aléatoire : ${options.seed}`)
  console.log(
    `${operationRows.length} opération(s) anonymisée(s) : libellés, informations complémentaires, références, montants ±10 %.`,
  )

  if (recurringOperations > 0 || recurringPatterns > 0) {
    console.log(
      `${recurringOperations} récurrence(s) et ${recurringPatterns} motif(s) anonymisés.`,
    )
  }

  if (hasFingerprint) {
    console.log('Empreintes (fingerprint) recalculées.')
  } else {
    console.log('Colonne fingerprint absente : empreintes non recalculées.')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
