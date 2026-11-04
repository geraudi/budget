import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { categories, operations } from '#/db/schema'

export type BudgetSummary = {
  period: { from: string | null; to: string | null }
  availableMonths: string[]
  operationCount: number
  totalIncome: number
  totalExpenses: number
  netBalance: number
  recurringCount: number
  recurringTotal: number
  byCategory: { name: string; count: number; total: number }[]
  monthly: { month: string; count: number; total: number }[]
  topExpenses: { label: string; count: number; total: number }[]
}

function computeBudgetSummary(filter?: {
  fromMonth?: string | null
  toMonth?: string | null
}): BudgetSummary {
  const allRows = db
    .select({
      dateComptabilisation: operations.dateComptabilisation,
      libelleSimplifie: operations.libelleSimplifie,
      montant: operations.montant,
      isRecurring: operations.isRecurring,
      categorie: categories.name,
    })
    .from(operations)
    .leftJoin(categories, eq(operations.categoryId, categories.id))
    .all()

  const availableMonths = [...new Set(allRows.map((row) => row.dateComptabilisation?.slice(0, 7)).filter((value): value is string => Boolean(value)))].sort()

  const fromMonth = filter?.fromMonth ?? null
  const toMonth = filter?.toMonth ?? null
  const rows =
    fromMonth || toMonth
      ? allRows.filter((row) => {
          const month = row.dateComptabilisation?.slice(0, 7)
          if (!month) return false
          if (fromMonth && month < fromMonth) return false
          if (toMonth && month > toMonth) return false
          return true
        })
      : allRows

  let totalIncome = 0
  let totalExpenses = 0
  for (const row of rows) {
    if (row.montant >= 0) totalIncome += row.montant
    else totalExpenses += row.montant
  }

  const recurringRows = rows.filter((row) => row.isRecurring)
  const recurringTotal = recurringRows.reduce((sum, row) => sum + row.montant, 0)

  const categoryMap = new Map<string, { count: number; total: number }>()
  for (const row of rows) {
    const key = row.categorie ?? 'Non catégorisé'
    const entry = categoryMap.get(key) ?? { count: 0, total: 0 }
    entry.count += 1
    entry.total += row.montant
    categoryMap.set(key, entry)
  }
  const byCategory = [...categoryMap.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => a.total - b.total)

  const monthMap = new Map<string, { count: number; total: number }>()
  for (const row of rows) {
    const month = row.dateComptabilisation?.slice(0, 7) ?? '—'
    const entry = monthMap.get(month) ?? { count: 0, total: 0 }
    entry.count += 1
    entry.total += row.montant
    monthMap.set(month, entry)
  }
  const monthly = [...monthMap.entries()]
    .map(([month, value]) => ({ month, ...value }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const labelMap = new Map<string, { count: number; total: number }>()
  for (const row of rows) {
    if (row.montant >= 0) continue
    const key = row.libelleSimplifie
    const entry = labelMap.get(key) ?? { count: 0, total: 0 }
    entry.count += 1
    entry.total += row.montant
    labelMap.set(key, entry)
  }
  const topExpenses = [...labelMap.entries()]
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => a.total - b.total)
    .slice(0, 10)

  const dates = rows
    .map((row) => row.dateComptabilisation)
    .filter((value): value is string => Boolean(value))
    .sort()

  return {
    period: {
      from: dates.length > 0 ? dates[0] : null,
      to: dates.length > 0 ? dates[dates.length - 1] : null,
    },
    availableMonths,
    operationCount: rows.length,
    totalIncome,
    totalExpenses,
    netBalance: totalIncome + totalExpenses,
    recurringCount: recurringRows.length,
    recurringTotal,
    byCategory,
    monthly,
    topExpenses,
  }
}

export const getBudgetSummary = createServerFn({ method: 'GET' })
  .validator((data?: { fromMonth?: string | null; toMonth?: string | null }) => data ?? {})
  .handler(async ({ data }) =>
    computeBudgetSummary({
      fromMonth: data?.fromMonth ?? null,
      toMonth: data?.toMonth ?? null,
    }),
  )
