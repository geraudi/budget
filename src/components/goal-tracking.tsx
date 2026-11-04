import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { cn } from 'cn'

import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { money, percent } from '#/lib/format'
import type { GoalProgress } from '#/application/queries/goals'
import type { GoalStatus } from '#/domain/goals/types'
import {
  createGoal,
  recordCoachRecommendation,
  recordGoalContribution,
  updateGoal,
} from '#/server/goals'

type GoalTrackingProps = {
  goals: GoalProgress[]
  period: { from: string; to: string }
}

const STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'Actif',
  paused: 'En pause',
  achieved: 'Atteint',
  abandoned: 'Abandonné',
}

const REASON_LABELS: Record<string, string> = {
  achieved: 'Objectif atteint',
  'no-qualified-income': 'Aucun revenu qualifié',
  'negative-capacity': 'Capacité d’épargne nulle ou négative',
  'insufficient-history': 'Historique trop court',
  'effort-above-capacity': 'Effort supérieur à la capacité observée',
  overdue: 'Échéance dépassée',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur inconnue'
}

function statusClass(status: GoalStatus): string {
  switch (status) {
    case 'active':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
    case 'paused':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-700'
    case 'achieved':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-700'
    case 'abandoned':
      return 'border-border bg-muted text-muted-foreground'
  }
}

export function GoalTracking({ goals, period }: GoalTrackingProps) {
  const router = useRouter()
  const createFn = useServerFn(createGoal)
  const updateFn = useServerFn(updateGoal)
  const contributionFn = useServerFn(recordGoalContribution)
  const recommendationFn = useServerFn(recordCoachRecommendation)

  const [label, setLabel] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetMonth, setTargetMonth] = useState(period.to)
  const [initialSavedAmount, setInitialSavedAmount] = useState('0')
  const [contributions, setContributions] = useState<
    Record<number, { amount: string; month: string }>
  >({})
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    setTargetMonth(period.to)
  }, [period.to])

  function contributionFor(goalId: number) {
    return contributions[goalId] ?? { amount: '', month: period.to }
  }

  function setContribution(
    goalId: number,
    patch: Partial<{ amount: string; month: string }>,
  ) {
    setContributions((current) => ({
      ...current,
      [goalId]: { ...contributionFor(goalId), ...patch },
    }))
  }

  async function run(key: string, action: () => Promise<unknown>) {
    if (pending) return
    setPending(key)
    setError(undefined)
    setNotice(undefined)
    try {
      await action()
      await router.invalidate()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const amount = Number(targetAmount)
    const initial = Number(initialSavedAmount || '0')

    void run('create', async () => {
      await createFn({
        data: {
          label,
          targetAmount: amount,
          targetMonth,
          startMonth: period.from,
          initialSavedAmount: initial,
        },
      })
      setLabel('')
      setTargetAmount('')
      setInitialSavedAmount('0')
      setTargetMonth(period.to)
      setNotice('Objectif créé.')
    })
  }

  function handleContribution(event: React.FormEvent, goal: GoalProgress) {
    event.preventDefault()
    const values = contributionFor(goal.id)

    void run(`contribution:${goal.id}`, async () => {
      await contributionFn({
        data: {
          id: goal.id,
          amount: Number(values.amount),
          month: values.month,
        },
      })
      setContribution(goal.id, { amount: '', month: period.to })
      setNotice('Contribution enregistrée.')
    })
  }

  function handleStatus(goal: GoalProgress, status: 'active' | 'paused' | 'abandoned') {
    void run(`status:${goal.id}`, async () => {
      await updateFn({ data: { id: goal.id, status } })
      setNotice('Objectif mis à jour.')
    })
  }

  function handleRecommendation(goalId: number | null) {
    void run(`recommendation:${goalId ?? 'global'}`, async () => {
      await recommendationFn({
        data: {
          from: period.from,
          to: period.to,
          goalId,
          kind: goalId === null ? 'assessment' : 'follow_up',
        },
      })
      setNotice('Recommandation enregistrée.')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Objectifs</CardTitle>
            <CardDescription>
              Objectifs enregistrés côté serveur, repris par le coach à chaque
              période.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending !== null}
            onClick={() => handleRecommendation(null)}
          >
            Enregistrer la recommandation
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-emerald-700">{notice}</p>}

        <form
          onSubmit={handleCreate}
          className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Libellé</span>
            <Input
              value={label}
              maxLength={80}
              required
              placeholder="Vacances, épargne de précaution…"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Montant cible (€)</span>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={targetAmount}
              onChange={(event) => setTargetAmount(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Mois cible</span>
            <Input
              type="month"
              required
              min={period.from}
              value={targetMonth}
              onChange={(event) => setTargetMonth(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Déjà épargné (€)</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={initialSavedAmount}
              onChange={(event) => setInitialSavedAmount(event.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button
              type="submit"
              className="w-full"
              disabled={pending !== null}
            >
              {pending === 'create' ? 'Création…' : 'Créer l’objectif'}
            </Button>
          </div>
        </form>

        {goals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun objectif suivi. Créez-en un pour que le coach en tienne
            compte.
          </p>
        ) : (
          <div className="space-y-4">
            {goals.map((goal) => {
              const values = contributionFor(goal.id)
              const unrealistic =
                !goal.realistic && !goal.reasons.includes('achieved')

              return (
                <div
                  key={goal.id}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{goal.label}</span>
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-xs',
                          statusClass(goal.status),
                        )}
                      >
                        {STATUS_LABELS[goal.status]}
                      </span>
                      {unrealistic && (
                        <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                          irréaliste
                        </span>
                      )}
                    </div>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {money.format(goal.savedAmount)} sur{' '}
                      {money.format(goal.targetAmount)}
                    </span>
                  </div>

                  <div
                    role="progressbar"
                    aria-label={`Progression de ${goal.label}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(goal.progress * 100)}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all"
                      style={{ width: `${Math.min(100, goal.progress * 100)}%` }}
                    />
                  </div>

                  <div className="grid gap-2 text-sm sm:grid-cols-3">
                    <p>
                      <span className="text-muted-foreground">
                        Progression :{' '}
                      </span>
                      {percent.format(goal.progress)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        Effort mensuel :{' '}
                      </span>
                      {money.format(goal.monthlyEffort)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        Échéance :{' '}
                      </span>
                      {goal.targetMonth}
                      {goal.monthsRemaining > 0
                        ? ` · ${goal.monthsRemaining} mois`
                        : ' · échéance atteinte'}
                    </p>
                  </div>

                  {unrealistic && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                      <p>
                        Capacité observée :{' '}
                        {money.format(goal.observedMonthlyCapacity)}/mois ·
                        alternative proposée :{' '}
                        {money.format(goal.alternativeMonthlyEffort)}/mois
                      </p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                        {goal.reasons.map((reason) => (
                          <li key={reason}>
                            {REASON_LABELS[reason] ?? reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {goal.savedInPeriod !== 0 && (
                    <p className="text-sm text-muted-foreground">
                      Sur la période affichée :{' '}
                      {money.format(goal.savedInPeriod)} de contributions.
                    </p>
                  )}

                  <form
                    onSubmit={(event) => handleContribution(event, goal)}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">
                        Contribution (€, signée)
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        required
                        className="w-40"
                        value={values.amount}
                        onChange={(event) =>
                          setContribution(goal.id, {
                            amount: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Mois</span>
                      <Input
                        type="month"
                        required
                        className="w-40"
                        value={values.month}
                        onChange={(event) =>
                          setContribution(goal.id, {
                            month: event.target.value,
                          })
                        }
                      />
                    </label>
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={pending !== null}
                    >
                      {pending === `contribution:${goal.id}`
                        ? 'Enregistrement…'
                        : 'Enregistrer la contribution'}
                    </Button>
                  </form>

                  <div className="flex flex-wrap gap-2">
                    {goal.status === 'active' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending !== null}
                        onClick={() => handleStatus(goal, 'paused')}
                      >
                        Mettre en pause
                      </Button>
                    )}
                    {(goal.status === 'paused' ||
                      goal.status === 'abandoned') && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending !== null}
                        onClick={() => handleStatus(goal, 'active')}
                      >
                        Reprendre
                      </Button>
                    )}
                    {goal.status !== 'abandoned' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending !== null}
                        onClick={() => handleStatus(goal, 'abandoned')}
                      >
                        Abandonner
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending !== null}
                      onClick={() => handleRecommendation(goal.id)}
                    >
                      Enregistrer la recommandation
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
