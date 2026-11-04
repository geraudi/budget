import { createServerFn } from '@tanstack/react-start'
import { and, eq, ne, sql } from 'drizzle-orm'

import { db } from '#/db'
import { operations, recurringOperations } from '#/db/schema'
import {
  isMatchMode,
  tryCompileMatcher,
  type MatchMode,
} from '#/lib/recurring-match'
import {
  monthIndex,
  type DurationType,
  type RecurringActual,
} from '#/lib/recurring-schedule'

export type RecurringOperation = {
  id: number
  libelleSimplifie: string
  montant: number
  intervalMonths: number
  firstMonth: string
  durationType: DurationType
  endMonth: string | null
  occurrences: number | null
  matchMode: MatchMode
  matchPattern: string | null
  createdAt: string
}

export type RecurringOperationInput = {
  libelleSimplifie: string
  montant: number
  intervalMonths: number
  firstMonth: string
  durationType: DurationType
  endMonth: string | null
  occurrences: number | null
  matchMode: MatchMode
  matchPattern: string | null
}

export type UpdateRecurringOperationInput = RecurringOperationInput & {
  id: number
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

function asRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') {
    throw new Error('Données invalides')
  }
  return data as Record<string, unknown>
}

function requireId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('Identifiant invalide')
  }
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} requis`)
  }
  return value
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} invalide`)
  }
  return value
}

function requireInteger(value: unknown, label: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`${label} invalide`)
  }
  return value
}

function requireMonth(value: unknown, label: string): string {
  if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) {
    throw new Error(`${label} invalide`)
  }

  const year = Number(value.slice(0, 4))
  if (year < 2000 || year > 2100) {
    throw new Error(`${label} invalide`)
  }

  return value
}

function parseMatchMode(value: unknown): MatchMode {
  if (value === undefined || value === null) return 'exact'
  if (isMatchMode(value)) return value
  throw new Error('Mode de correspondance invalide')
}

function parseMatchPattern(
  value: unknown,
  mode: MatchMode,
): string | null {
  if (mode === 'exact') return null

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Motif de correspondance requis')
  }

  const pattern = mode === 'contains' ? value.trim() : value

  if (mode === 'regex' && !tryCompileMatcher('regex', pattern, '')) {
    throw new Error('Expression régulière invalide')
  }

  return pattern
}

function parseInput(data: unknown): RecurringOperationInput {
  const d = asRecord(data)

  const libelleSimplifie = requireString(
    d.libelleSimplifie,
    'Libellé de l’opération',
  )
  const montant = requireNumber(d.montant, 'Montant')
  const intervalMonths = requireInteger(d.intervalMonths, 'Intervalle', 1)
  const firstMonth = requireMonth(d.firstMonth, 'Premier mois')
  const matchMode = parseMatchMode(d.matchMode)
  const matchPattern = parseMatchPattern(d.matchPattern, matchMode)

  if (
    d.durationType !== 'unlimited' &&
    d.durationType !== 'until' &&
    d.durationType !== 'count'
  ) {
    throw new Error('Durée invalide')
  }
  const durationType: DurationType = d.durationType

  let endMonth: string | null = null
  let occurrences: number | null = null

  if (durationType === 'until') {
    endMonth = requireMonth(d.endMonth, 'Mois de fin')
    if (monthIndex(endMonth) < monthIndex(firstMonth)) {
      throw new Error(
        'Le mois de fin doit être égal ou postérieur au premier mois',
      )
    }
  } else if (durationType === 'count') {
    occurrences = requireInteger(d.occurrences, 'Nombre d’occurrences', 1)
  }

  return {
    libelleSimplifie,
    montant,
    intervalMonths,
    firstMonth,
    durationType,
    endMonth,
    occurrences,
    matchMode,
    matchPattern,
  }
}

function assertLabelAvailable(libelleSimplifie: string, excludeId?: number) {
  const existing = db
    .select({ id: recurringOperations.id })
    .from(recurringOperations)
    .where(
      excludeId === undefined
        ? eq(recurringOperations.libelleSimplifie, libelleSimplifie)
        : and(
            eq(recurringOperations.libelleSimplifie, libelleSimplifie),
            ne(recurringOperations.id, excludeId),
          ),
    )
    .get()

  if (existing) {
    throw new Error(
      'Une opération récurrente existe déjà pour ce libellé.',
    )
  }
}

function assertMatcherAvailable(
  input: Pick<
    RecurringOperationInput,
    'libelleSimplifie' | 'matchMode' | 'matchPattern'
  >,
  excludeId?: number,
) {
  const candidate = tryCompileMatcher(
    input.matchMode,
    input.matchPattern,
    input.libelleSimplifie,
  )

  if (!candidate) {
    throw new Error('Expression régulière invalide')
  }

  const labels = db
    .selectDistinct({ libelleSimplifie: operations.libelleSimplifie })
    .from(operations)
    .all()
    .map((row) => row.libelleSimplifie)

  const others = db
    .select()
    .from(recurringOperations)
    .all()
    .filter((row) => row.id !== excludeId)
    .map((row) => ({
      row,
      matcher: tryCompileMatcher(
        isMatchMode(row.matchMode) ? row.matchMode : 'exact',
        row.matchPattern,
        row.libelleSimplifie,
      ),
    }))

  for (const label of labels) {
    if (!candidate.test(label)) continue

    for (const other of others) {
      if (other.matcher?.test(label)) {
        throw new Error(
          `Le libellé « ${label} » correspond déjà à « ${other.row.libelleSimplifie} ».`,
        )
      }
    }
  }
}

function toDurationType(value: string): DurationType {
  if (value === 'until' || value === 'count') return value
  return 'unlimited'
}

export const getRecurringOperations = createServerFn({ method: 'GET' }).handler(
  async () => {
    const rows = db
      .select()
      .from(recurringOperations)
      .orderBy(recurringOperations.libelleSimplifie)
      .all()

    const labels = db
      .selectDistinct({ libelleSimplifie: operations.libelleSimplifie })
      .from(operations)
      .all()
      .map((row) => row.libelleSimplifie)
      .sort((a, b) => a.localeCompare(b, 'fr'))

    const grouped = db
      .select({
        libelleSimplifie: operations.libelleSimplifie,
        month: sql<string>`substr(${operations.dateComptabilisation}, 1, 7)`,
        montant: sql<number>`sum(${operations.montant})`,
      })
      .from(operations)
      .groupBy(
        operations.libelleSimplifie,
        sql`substr(${operations.dateComptabilisation}, 1, 7)`,
      )
      .all()

    const matchers = rows.map((row) => ({
      libelleSimplifie: row.libelleSimplifie,
      regex: tryCompileMatcher(
        isMatchMode(row.matchMode) ? row.matchMode : 'exact',
        row.matchPattern,
        row.libelleSimplifie,
      ),
    }))

    const actualByLabelMonth = new Map<string, number>()
    for (const actual of grouped) {
      const matched = matchers.find((matcher) =>
        matcher.regex?.test(actual.libelleSimplifie),
      )
      if (!matched) continue

      const key = `${matched.libelleSimplifie}\u0000${actual.month}`
      actualByLabelMonth.set(
        key,
        (actualByLabelMonth.get(key) ?? 0) + actual.montant,
      )
    }

    const actuals = [...actualByLabelMonth.entries()].map(
      ([key, montant]) => {
        const separator = key.indexOf('\u0000')
        return {
          libelleSimplifie: key.slice(0, separator),
          month: key.slice(separator + 1),
          montant,
        }
      },
    )

    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}`

    return {
      recurring: rows.map((row) => ({
        ...row,
        durationType: toDurationType(row.durationType),
        matchMode: isMatchMode(row.matchMode) ? row.matchMode : 'exact',
      })) satisfies Array<RecurringOperation>,
      labels,
      actuals: actuals satisfies Array<RecurringActual>,
      currentMonth,
    }
  },
)

export const createRecurringOperation = createServerFn({ method: 'POST' })
  .validator((data: unknown): RecurringOperationInput => parseInput(data))
  .handler(async ({ data }) => {
    assertLabelAvailable(data.libelleSimplifie)
    assertMatcherAvailable(data)
    db.insert(recurringOperations).values(data).run()
    return { success: true }
  })

export const updateRecurringOperation = createServerFn({ method: 'POST' })
  .validator((data: unknown): UpdateRecurringOperationInput => {
    const d = asRecord(data)
    return { id: requireId(d.id), ...parseInput(d) }
  })
  .handler(async ({ data }) => {
    const { id, ...values } = data
    assertLabelAvailable(values.libelleSimplifie, id)
    assertMatcherAvailable(values, id)

    const result = db
      .update(recurringOperations)
      .set(values)
      .where(eq(recurringOperations.id, id))
      .run()

    if (result.changes === 0) {
      throw new Error('Opération récurrente introuvable')
    }

    return { id }
  })

export const deleteRecurringOperation = createServerFn({ method: 'POST' })
  .validator((data: unknown): { id: number } => ({
    id: requireId(asRecord(data).id),
  }))
  .handler(async ({ data }) => {
    const result = db
      .delete(recurringOperations)
      .where(eq(recurringOperations.id, data.id))
      .run()

    if (result.changes === 0) {
      throw new Error('Opération récurrente introuvable')
    }

    return { id: data.id }
  })