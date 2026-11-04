export const MONTHS = [
  'Janv.',
  'Févr.',
  'Mars',
  'Avr.',
  'Mai',
  'Juin',
  'Juil.',
  'Août',
  'Sept.',
  'Oct.',
  'Nov.',
  'Déc.',
] as const

export type DurationType = 'unlimited' | 'until' | 'count'

export type RecurringSchedule = {
  firstMonth: string
  intervalMonths: number
  durationType: DurationType
  endMonth: string | null
  occurrences: number | null
}

export type RecurringSource = RecurringSchedule & {
  id: number
  libelleSimplifie: string
  montant: number
}

export type RecurringActual = {
  libelleSimplifie: string
  month: string
  montant: number
}

export type RecurringCell =
  | { kind: 'actual'; value: number }
  | { kind: 'planned'; value: number }
  | { kind: 'missing' }
  | { kind: 'out' }

export type RecurringRow<T extends RecurringSource = RecurringSource> = {
  operation: T
  cells: Array<RecurringCell>
  total: number
  hasValue: boolean
}

export type RecurringTable<T extends RecurringSource = RecurringSource> = {
  rows: Array<RecurringRow<T>>
  monthTotals: Array<number | null>
  grandTotal: number
}

export function monthIndex(month: string): number {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  return year * 12 + monthNumber - 1
}

export function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

export function isScheduled(schedule: RecurringSchedule, month: string): boolean {
  const offset = monthIndex(month) - monthIndex(schedule.firstMonth)
  if (offset < 0) return false
  if (offset % schedule.intervalMonths !== 0) return false

  if (schedule.durationType === 'until') {
    if (!schedule.endMonth) return false
    return monthIndex(month) <= monthIndex(schedule.endMonth)
  }

  if (schedule.durationType === 'count') {
    return offset / schedule.intervalMonths < (schedule.occurrences ?? 0)
  }

  return true
}

export function lastScheduledMonth(
  schedule: RecurringSchedule,
): string | null {
  if (schedule.durationType === 'until') return schedule.endMonth
  if (schedule.durationType === 'count') {
    const occurrences = schedule.occurrences ?? 0
    if (occurrences < 1) return null
    return monthFromIndex(
      monthIndex(schedule.firstMonth) +
        (occurrences - 1) * schedule.intervalMonths,
    )
  }
  return null
}

export function buildRecurringTable<T extends RecurringSource>(
  operations: Array<T>,
  actuals: Array<RecurringActual>,
  annee: number,
  currentMonth: string,
): RecurringTable<T> {
  const actualByLabelMonth = new Map<string, number>()
  for (const actual of actuals) {
    actualByLabelMonth.set(
      `${actual.libelleSimplifie}\u0000${actual.month}`,
      actual.montant,
    )
  }

  const rows: Array<RecurringRow<T>> = operations.map((operation) => {
    let total = 0
    let hasValue = false

    const cells = MONTHS.map<RecurringCell>((_, index) => {
      const month = `${annee}-${String(index + 1).padStart(2, '0')}`
      const actual = actualByLabelMonth.get(
        `${operation.libelleSimplifie}\u0000${month}`,
      )

      if (month < currentMonth) {
        if (actual === undefined) return { kind: 'missing' }
        hasValue = true
        total += actual
        return { kind: 'actual', value: actual }
      }

      if (month === currentMonth) {
        if (actual !== undefined) {
          hasValue = true
          total += actual
          return { kind: 'actual', value: actual }
        }
        if (!isScheduled(operation, month)) return { kind: 'out' }
        hasValue = true
        total += operation.montant
        return { kind: 'planned', value: operation.montant }
      }

      if (!isScheduled(operation, month)) return { kind: 'out' }
      hasValue = true
      total += operation.montant
      return { kind: 'planned', value: operation.montant }
    })

    return { operation, cells, total, hasValue }
  })

  rows.sort(
    (a, b) =>
      Math.abs(b.total) - Math.abs(a.total) ||
      a.operation.libelleSimplifie.localeCompare(
        b.operation.libelleSimplifie,
        'fr',
      ),
  )

  const monthTotals = MONTHS.map<number | null>((_, index) => {
    let sum = 0
    let hasValue = false
    for (const row of rows) {
      const cell = row.cells[index]!
      if (cell.kind === 'actual' || cell.kind === 'planned') {
        sum += cell.value
        hasValue = true
      }
    }
    return hasValue ? sum : null
  })

  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0)

  return { rows, monthTotals, grandTotal }
}

export function getYearBounds(
  operations: Array<RecurringSchedule>,
  actuals: Array<RecurringActual>,
  currentYear: number,
): { min: number; max: number } {
  const years = new Set<number>([currentYear])

  for (const operation of operations) {
    const firstYear = Number(operation.firstMonth.slice(0, 4))
    years.add(firstYear)
    const last = lastScheduledMonth(operation)
    if (last) {
      years.add(Number(last.slice(0, 4)))
    } else {
      years.add(Math.max(currentYear, firstYear) + 1)
    }
  }

  for (const actual of actuals) {
    years.add(Number(actual.month.slice(0, 4)))
  }

  const values = [...years]
  return {
    min: Math.max(2000, Math.min(...values)),
    max: Math.min(2100, Math.max(...values)),
  }
}

export function formatMonthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1
  return `${MONTHS[index] ?? month} ${month.slice(0, 4)}`
}

export function formatScheduleSummary(schedule: RecurringSchedule): string {
  const interval =
    schedule.intervalMonths === 1
      ? 'tous les mois'
      : `tous les ${schedule.intervalMonths} mois`

  let duration = 'illimitée'
  if (schedule.durationType === 'until' && schedule.endMonth) {
    duration = `jusqu'à ${formatMonthLabel(schedule.endMonth).toLowerCase()}`
  } else if (schedule.durationType === 'count' && schedule.occurrences) {
    duration = `${schedule.occurrences} occurrence${schedule.occurrences > 1 ? 's' : ''}`
  }

  return `${interval} · ${duration}`
}
