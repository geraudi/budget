import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useHydrated, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { StopIcon } from '@hugeicons/core-free-icons'
import { cn } from 'cn'
import ReactMarkdown from 'react-markdown'

import {
  AiAssessmentProvider,
  getMessageText,
  useAiAssessment,
} from '#/components/ai-assessment-provider'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { getBudgetSummary } from '#/lib/budget'
import { money, percent, ratio } from '#/lib/format'
import { GoalTracking } from '#/components/goal-tracking'
import { getCoachIndicators } from '#/server/coach'
import { getGoalProgress } from '#/server/goals'

export const Route = createFileRoute('/dashboard')({
  validateSearch: (search: Record<string, unknown>) => {
    const result: { from?: string; to?: string } = {}
    if (typeof search.from === 'string') result.from = search.from
    if (typeof search.to === 'string') result.to = search.to
    return result
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [summary, indicators, goals] = await Promise.all([
      getBudgetSummary({
        data: { fromMonth: deps.from ?? null, toMonth: deps.to ?? null },
      }),
      getCoachIndicators({
        data: { from: deps.from ?? null, to: deps.to ?? null },
      }),
      getGoalProgress({
        data: { from: deps.from ?? null, to: deps.to ?? null },
      }),
    ])
    return { summary, indicators, goals }
  },
  component: DashboardPage,
})

const ASSESSMENT_PROMPT =
  'Fais une évaluation complète de mon budget à partir des données fournies.'

const MONTH_NAMES = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
]

function DashboardPage() {
  const { summary } = Route.useLoaderData()
  const search = Route.useSearch()

  const defaultFrom = summary.availableMonths[0] ?? ''
  const defaultTo = summary.availableMonths[summary.availableMonths.length - 1] ?? ''
  const fromValue = search.from ?? defaultFrom
  const toValue = search.to ?? defaultTo
  const periodKey = `${fromValue}:${toValue}`

  return (
    <AiAssessmentProvider
      // Remounting on period change recreates the chat client and loads the
      // transcript of the right period, instead of replaying another range.
      key={periodKey}
      periodKey={periodKey}
      fromMonth={fromValue || null}
      toMonth={toValue || null}
    >
      <DashboardContent fromValue={fromValue} toValue={toValue} />
    </AiAssessmentProvider>
  )
}

type DashboardContentProps = {
  fromValue: string
  toValue: string
}

function DashboardContent({ fromValue, toValue }: DashboardContentProps) {
  const { summary, indicators, goals } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const { messages, sources, sendMessage, isLoading, error, stop, clear } =
    useAiAssessment()

  const monthsByYear = new Map<string, string[]>()
  for (const month of summary.availableMonths) {
    const year = month.slice(0, 4)
    if (!monthsByYear.has(year)) monthsByYear.set(year, [])
    monthsByYear.get(year)!.push(month)
  }

  function monthLabel(value: string) {
    const index = Number(value.slice(5, 7)) - 1
    return MONTH_NAMES[index] ?? value
  }

  function handleFromChange(value: string) {
    let nextTo = toValue
    if (value && nextTo && value > nextTo) nextTo = value
    void navigate({
      to: '/dashboard',
      search: { from: value || undefined, to: nextTo || undefined },
    })
  }

  function handleToChange(value: string) {
    let nextFrom = fromValue
    if (value && nextFrom && value < nextFrom) nextFrom = value
    void navigate({
      to: '/dashboard',
      search: { from: nextFrom || undefined, to: value || undefined },
    })
  }

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [messages, isLoading, hydrated])

  function handleGenerate() {
    if (isLoading) return
    void sendMessage(ASSESSMENT_PROMPT)
  }

  function handleSend(event: React.FormEvent) {
    event.preventDefault()
    const value = input.trim()
    if (!value || isLoading) return
    void sendMessage(value)
    setInput('')
  }

  const qualifiedIncome =
    indicators.income.recurring + indicators.income.other
  const unreliableIncome = indicators.dataQuality.unqualifiedIncomeShare > 0.1

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">De :</span>
          <select
            value={fromValue}
            onChange={(event) => handleFromChange(event.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">—</option>
            {[...monthsByYear.entries()].map(([year, months]) => (
              <optgroup key={year} label={year}>
                {months.map((month) => (
                  <option key={month} value={month}>
                    {monthLabel(month)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="text-muted-foreground">A :</span>
          <select
            value={toValue}
            onChange={(event) => handleToChange(event.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">—</option>
            {[...monthsByYear.entries()].map(([year, months]) => (
              <optgroup key={year} label={year}>
                {months.map((month) => (
                  <option key={month} value={month}>
                    {monthLabel(month)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Opérations</CardDescription>
            <CardTitle>{summary.operationCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Entrées brutes</CardDescription>
            <CardTitle className="text-emerald-600">
              {money.format(summary.totalIncome)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Sorties brutes</CardDescription>
            <CardTitle className="text-destructive">
              {money.format(summary.totalExpenses)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Solde brut</CardDescription>
            <CardTitle
              className={cn(summary.netBalance < 0 && 'text-destructive')}
            >
              {money.format(summary.netBalance)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Récurrents</CardDescription>
            <CardTitle>
              {summary.recurringCount} · {money.format(summary.recurringTotal)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Indicateurs fiables</CardTitle>
          <CardDescription>
            Calculés par le module analytics sur la période affichée. Le coach
            reprend ces valeurs sans les recalculer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Revenus qualifiés</p>
              <p className="text-lg font-semibold text-emerald-600">
                {money.format(qualifiedIncome)}
              </p>
              <p className="text-xs text-muted-foreground">
                récurrents {money.format(indicators.income.recurring)} ·
                ponctuels {money.format(indicators.income.other)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                Revenus non qualifiés
              </p>
              <p className="text-lg font-semibold">
                {money.format(indicators.income.unqualified)}
              </p>
              <p className="text-xs text-muted-foreground">
                {percent.format(indicators.dataQuality.unqualifiedIncomeShare)}{' '}
                des revenus probables
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Épargne observée</p>
              <p
                className={cn(
                  'text-lg font-semibold',
                  indicators.savings.observed < 0 && 'text-destructive',
                )}
              >
                {money.format(indicators.savings.observed)}
              </p>
              <p className="text-xs text-muted-foreground">
                ratio {ratio.format(indicators.savings.rate)}
                {unreliableIncome ? ' · non fiable' : ''}
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">Dépenses par nature</p>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Essentielles</span>
                <span className="tabular-nums">
                  {money.format(indicators.expenses.essential)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Discrétionnaires</span>
                <span className="tabular-nums">
                  {money.format(indicators.expenses.discretionary)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Exceptionnelles</span>
                <span className="tabular-nums">
                  {money.format(indicators.expenses.exceptional)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Non qualifiées</span>
                <span className="tabular-nums">
                  {money.format(indicators.expenses.unqualified)}
                </span>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Total des dépenses : {money.format(indicators.expenses.total)} ·
              remboursements {money.format(indicators.refunds.total)} ·
              remboursements de crédit{' '}
              {money.format(indicators.debtPayments.total)}
            </p>
          </div>

          {indicators.dataQuality.warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-sm font-medium">Qualité des données</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {indicators.dataQuality.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <GoalTracking
        goals={goals}
        period={{ from: fromValue, to: toValue }}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Catégories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.byCategory.map((category) => (
                <div
                  key={category.name}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="truncate">{category.name}</span>
                  <span
                    className={cn(
                      'tabular-nums',
                      category.total < 0 && 'text-destructive',
                      category.total > 0 && 'text-emerald-600',
                    )}
                  >
                    {money.format(category.total)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Mois</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.monthly.map((month) => (
                <div
                  key={month.month}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{month.month}</span>
                  <span
                    className={cn(
                      'tabular-nums',
                      month.total < 0 && 'text-destructive',
                      month.total > 0 && 'text-emerald-600',
                    )}
                  >
                    {money.format(month.total)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Principales dépenses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {summary.topExpenses.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between text-sm"
              >
                <span className="truncate">{item.label}</span>
                <span
                  className={cn(
                    'tabular-nums',
                    item.total < 0 && 'text-destructive',
                    item.total > 0 && 'text-emerald-600',
                  )}
                >
                  {money.format(item.total)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coach financier</CardTitle>
          <CardDescription>
            Qwen3:14b via Ollama · chiffres du module analytics, sans nom de
            commerçant
          </CardDescription>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={isLoading}
            >
              {isLoading && <Spinner data-icon="inline-start" />}
              {isLoading ? 'Génération…' : "Analyser mon budget"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={isLoading || !hydrated || messages.length === 0}
            >
              Réinitialiser
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 text-sm text-destructive">{error.message}</p>
          )}
          <div
            ref={scrollRef}
            className="max-h-[60vh] space-y-4 overflow-y-auto pr-2"
          >
            {hydrated &&
              messages.map((message) => {
                const content = getMessageText(message)
                if (!content) return null
                const isAssistant = message.role === 'assistant'
                return (
                  <div
                    key={message.id}
                    className={cn(
                      'rounded-md px-3 py-2 text-sm',
                      isAssistant
                        ? 'bg-muted prose prose-sm dark:prose-invert max-w-none'
                        : 'bg-primary/10 text-foreground whitespace-pre-wrap',
                    )}
                  >
                    <ReactMarkdown>{content}</ReactMarkdown>
                    {isAssistant && isLoading && (
                      <span className="ml-1 inline-block animate-pulse">▍</span>
                    )}
                  </div>
                )
              })}
            {hydrated && isLoading && messages.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Réflexion…
              </p>
            )}
          </div>

          {hydrated && sources.length > 0 && (
            <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">Sources consultées</p>
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {sources.map((source) => (
                  <li key={source.id}>
                    {source.title} — {source.source}
                    {source.reviewRequired ? ' (à vérifier)' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={handleSend} className="mt-4 flex items-center gap-2">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Poser une question de suivi…"
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="sm" disabled={isLoading || !input.trim()}>
              Envoyer
            </Button>
            {isLoading && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={stop}
              >
                <HugeiconsIcon icon={StopIcon} size={14} />
                Stop
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
