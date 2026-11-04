import { useMemo, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Delete02Icon,
  Edit01Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'
import { cn } from 'cn'

import { Button, buttonVariants } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  createRecurringOperation,
  deleteRecurringOperation,
  getRecurringOperations,
  updateRecurringOperation,
  type RecurringOperation,
  type RecurringOperationInput,
} from '#/lib/recurring'
import {
  MATCH_MODES,
  MATCH_MODE_LABELS,
  escapeRegExp,
  tryCompileMatcher,
  type MatchMode,
} from '#/lib/recurring-match'
import {
  MONTHS,
  buildRecurringTable,
  formatMonthLabel,
  formatScheduleSummary,
  getYearBounds,
  type DurationType,
  type RecurringCell,
} from '#/lib/recurring-schedule'

export const Route = createFileRoute('/recurrentes')({
  validateSearch: (search: Record<string, unknown>): { annee?: number } => {
    const annee = Number(search.annee)
    return isAnnée(annee) ? { annee } : {}
  },
  loader: () => getRecurringOperations(),
  component: RecurrentesPage,
})

function isAnnée(value: number): boolean {
  return Number.isInteger(value) && value >= 2000 && value <= 2100
}

const money = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

type FormState = {
  libelleSimplifie: string
  matchMode: MatchMode
  matchPattern: string
  montant: string
  intervalMonths: string
  firstMonth: string
  durationType: DurationType
  endMonth: string
  occurrences: string
}

function emptyForm(currentMonth: string): FormState {
  return {
    libelleSimplifie: '',
    matchMode: 'exact',
    matchPattern: '',
    montant: '',
    intervalMonths: '1',
    firstMonth: currentMonth,
    durationType: 'unlimited',
    endMonth: '',
    occurrences: '',
  }
}

function formFromOperation(operation: RecurringOperation): FormState {
  return {
    libelleSimplifie: operation.libelleSimplifie,
    matchMode: operation.matchMode,
    matchPattern: operation.matchPattern ?? operation.libelleSimplifie,
    montant: String(operation.montant),
    intervalMonths: String(operation.intervalMonths),
    firstMonth: operation.firstMonth,
    durationType: operation.durationType,
    endMonth: operation.endMonth ?? '',
    occurrences:
      operation.occurrences === null ? '' : String(operation.occurrences),
  }
}

function buildInput(form: FormState): RecurringOperationInput {
  return {
    libelleSimplifie: form.libelleSimplifie,
    matchMode: form.matchMode,
    matchPattern: form.matchMode === 'exact' ? null : form.matchPattern,
    montant: Number(form.montant),
    intervalMonths: Number(form.intervalMonths),
    firstMonth: form.firstMonth,
    durationType: form.durationType,
    endMonth: form.durationType === 'until' ? form.endMonth : null,
    occurrences:
      form.durationType === 'count' ? Number(form.occurrences) : null,
  }
}

function matchPatternForMode(
  from: MatchMode,
  to: MatchMode,
  pattern: string,
  label: string,
): string {
  if (to === 'exact') return label
  if (to === from) return pattern
  if (to === 'contains') return label
  if (from === 'contains' && pattern.trim()) return escapeRegExp(pattern)
  return escapeRegExp(label)
}

function renderCell(cell: RecurringCell) {
  switch (cell.kind) {
    case 'actual':
      return money.format(cell.value)
    case 'planned':
      return (
        <span className="italic text-muted-foreground" title="Valeur prévue">
          {money.format(cell.value)}
        </span>
      )
    case 'missing':
      return <span className="text-muted-foreground">-</span>
    case 'out':
      return <span className="text-muted-foreground">—</span>
  }
}

function RecurrentesPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const createFn = useServerFn(createRecurringOperation)
  const updateFn = useServerFn(updateRecurringOperation)
  const deleteFn = useServerFn(deleteRecurringOperation)

  const currentYear = Number(data.currentMonth.slice(0, 4))
  const currentMonthIndex = Number(data.currentMonth.slice(5, 7)) - 1
  const { annee = currentYear } = Route.useSearch()

  const { rows, monthTotals, grandTotal } = useMemo(
    () =>
      buildRecurringTable(
        data.recurring,
        data.actuals,
        annee,
        data.currentMonth,
      ),
    [annee, data.actuals, data.currentMonth, data.recurring],
  )

  const { min, max } = useMemo(
    () => getYearBounds(data.recurring, data.actuals, currentYear),
    [currentYear, data.actuals, data.recurring],
  )

  const linkedLabels = useMemo(() => {
    const linked = new Set<string>()

    for (const operation of data.recurring) {
      const matcher = tryCompileMatcher(
        operation.matchMode,
        operation.matchPattern,
        operation.libelleSimplifie,
      )
      if (!matcher) continue

      for (const label of data.labels) {
        if (matcher.test(label)) linked.add(label)
      }
    }

    return linked
  }, [data.labels, data.recurring])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringOperation | null>(null)
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(data.currentMonth),
  )
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string>()

  const [deleting, setDeleting] = useState<RecurringOperation | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()

  const canCreate = data.labels.some((label) => !linkedLabels.has(label))

  const editingLabels = useMemo(() => {
    if (!editing) return new Set<string>()

    const matcher = tryCompileMatcher(
      editing.matchMode,
      editing.matchPattern,
      editing.libelleSimplifie,
    )

    return new Set(
      matcher ? data.labels.filter((label) => matcher.test(label)) : [],
    )
  }, [data.labels, editing])

  const labelOptions = useMemo(() => {
    const labels = new Set(data.labels)
    if (editing) labels.add(editing.libelleSimplifie)
    return [...labels]
      .filter((label) => !linkedLabels.has(label) || editingLabels.has(label))
      .sort((a, b) => a.localeCompare(b, 'fr'))
  }, [data.labels, editing, editingLabels, linkedLabels])

  const matchPreview = useMemo(() => {
    if (!form.libelleSimplifie) {
      return { labels: [] as string[], invalid: false }
    }

    const matcher = tryCompileMatcher(
      form.matchMode,
      form.matchPattern,
      form.libelleSimplifie,
    )

    if (!matcher) {
      return { labels: [] as string[], invalid: true }
    }

    return {
      labels: data.labels.filter((label) => matcher.test(label)),
      invalid: false,
    }
  }, [data.labels, form.libelleSimplifie, form.matchMode, form.matchPattern])

  function openCreate() {
    const firstAvailable = data.labels.find(
      (label) => !linkedLabels.has(label),
    )
    setEditing(null)
    setForm({
      ...emptyForm(data.currentMonth),
      libelleSimplifie: firstAvailable ?? '',
      matchPattern: firstAvailable ?? '',
    })
    setFormError(undefined)
    setDialogOpen(true)
  }

  function openEdit(operation: RecurringOperation) {
    setEditing(operation)
    setForm(formFromOperation(operation))
    setFormError(undefined)
    setDialogOpen(true)
  }

  function handleLabelChange(libelleSimplifie: string) {
    setForm((current) => {
      const syncPattern =
        !editing &&
        (current.matchMode === 'exact' ||
          !current.matchPattern.trim() ||
          current.matchPattern === current.libelleSimplifie ||
          current.matchPattern === escapeRegExp(current.libelleSimplifie))

      let matchPattern = current.matchPattern
      if (syncPattern) {
        matchPattern =
          current.matchMode === 'regex'
            ? escapeRegExp(libelleSimplifie)
            : libelleSimplifie
      }

      return { ...current, libelleSimplifie, matchPattern }
    })
  }

  function handleMatchModeChange(matchMode: MatchMode) {
    setForm((current) => ({
      ...current,
      matchMode,
      matchPattern: matchPatternForMode(
        current.matchMode,
        matchMode,
        current.matchPattern,
        current.libelleSimplifie,
      ),
    }))
  }

  function handleDurationChange(durationType: DurationType) {
    setForm((current) => ({
      ...current,
      durationType,
      endMonth:
        durationType === 'until' && !current.endMonth
          ? current.firstMonth
          : current.endMonth,
      occurrences:
        durationType === 'count' && !current.occurrences
          ? '12'
          : current.occurrences,
    }))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.libelleSimplifie) {
      setFormError('Sélectionnez une opération à lier.')
      return
    }

    if (form.matchMode !== 'exact' && form.matchPattern.trim() === '') {
      setFormError('Saisissez un motif de correspondance.')
      return
    }

    if (
      form.matchMode === 'regex' &&
      !tryCompileMatcher('regex', form.matchPattern, form.libelleSimplifie)
    ) {
      setFormError('Expression régulière invalide.')
      return
    }

    setSaving(true)
    setFormError(undefined)
    try {
      const input = buildInput(form)
      if (editing) {
        await updateFn({ data: { id: editing.id, ...input } })
      } else {
        await createFn({ data: input })
      }
      setDialogOpen(false)
      await router.invalidate({ sync: true })
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Enregistrement impossible',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setDeletingBusy(true)
    setDeleteError(undefined)
    try {
      await deleteFn({ data: { id: deleting.id } })
      setDeleting(null)
      await router.invalidate({ sync: true })
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Suppression impossible',
      )
    } finally {
      setDeletingBusy(false)
    }
  }

  const prevDisabled = annee <= min
  const nextDisabled = annee >= max
  const hasAnyValue = rows.some((row) => row.hasValue)

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Opérations récurrentes</CardTitle>
          <CardDescription>
            {rows.length} opération{rows.length === 1 ? '' : 's'} récurrente
            {rows.length === 1 ? '' : 's'} · {annee}
          </CardDescription>
          <CardAction>
            <Button
              size="sm"
              onClick={openCreate}
              disabled={!canCreate}
              title={
                canCreate
                  ? undefined
                  : 'Tous les libellés existants sont déjà liés.'
              }
            >
              <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
              Nouvelle opération
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background">
                  Libellé
                </TableHead>
                {MONTHS.map((mois, index) => (
                  <TableHead
                    key={mois}
                    className={cn(
                      'text-right',
                      annee === currentYear &&
                        index === currentMonthIndex &&
                        'font-semibold text-foreground',
                    )}
                  >
                    {mois}
                    {annee === currentYear &&
                      index === currentMonthIndex && (
                        <span className="ml-1 text-primary">•</span>
                      )}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ operation, cells, total, hasValue }) => (
                <TableRow key={operation.id}>
                  <TableCell className="sticky left-0 bg-background font-medium">
                    <span className="block">
                      {operation.libelleSimplifie}
                    </span>
                    <span
                      className="block text-xs text-muted-foreground"
                      title={`Premier mois : ${formatMonthLabel(operation.firstMonth)}`}
                    >
                      {formatScheduleSummary(operation)}
                    </span>
                  </TableCell>
                  {cells.map((cell, index) => (
                    <TableCell
                      key={MONTHS[index]}
                      className="px-3 text-right tabular-nums"
                    >
                      {renderCell(cell)}
                    </TableCell>
                  ))}
                  <TableCell className="px-3 text-right font-medium tabular-nums">
                    {hasValue ? money.format(total) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(operation)}
                        aria-label={`Modifier ${operation.libelleSimplifie}`}
                      >
                        <HugeiconsIcon icon={Edit01Icon} size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setDeleting(operation)
                          setDeleteError(undefined)
                        }}
                        aria-label={`Supprimer ${operation.libelleSimplifie}`}
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={16} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={15}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Aucune opération récurrente. Utilisez « Nouvelle
                    opération » pour en créer une.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background">
                    Total
                  </TableHead>
                  {monthTotals.map((value, index) => (
                    <TableCell
                      key={MONTHS[index]}
                      className={cn(
                        'px-3 text-right font-medium tabular-nums',
                        value === null && 'text-muted-foreground',
                      )}
                    >
                      {value === null ? '—' : money.format(value)}
                    </TableCell>
                  ))}
                  <TableCell className="px-3 text-right font-medium tabular-nums">
                    {hasAnyValue ? money.format(grandTotal) : '—'}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-6 py-3 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">Réel</span> : opération
            bancaire
          </span>
          <span>
            <span className="italic">Prévu</span> : valeur de la récurrence
          </span>
          <span>
            <span className="font-medium">-</span> : réel manquant
          </span>
          <span>
            <span className="font-medium">—</span> : hors échéance
          </span>
        </div>
        <div className="flex items-center justify-between border-t px-6 py-4">
          <Link
            to="/recurrentes"
            search={{ annee: Math.max(min, annee - 1) }}
            disabled={prevDisabled}
            aria-disabled={prevDisabled}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'icon-sm' }),
              prevDisabled && 'pointer-events-none opacity-50',
            )}
          >
            <HugeiconsIcon icon={ArrowLeftIcon} size={16} />
            <span className="sr-only">Année précédente</span>
          </Link>
          <span className="text-sm font-medium tabular-nums">{annee}</span>
          <Link
            to="/recurrentes"
            search={{ annee: Math.min(max, annee + 1) }}
            disabled={nextDisabled}
            aria-disabled={nextDisabled}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'icon-sm' }),
              nextDisabled && 'pointer-events-none opacity-50',
            )}
          >
            <HugeiconsIcon icon={ArrowRightIcon} size={16} />
            <span className="sr-only">Année suivante</span>
          </Link>
        </div>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!saving) setDialogOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Modifier l'opération récurrente"
                : 'Nouvelle opération récurrente'}
            </DialogTitle>
            <DialogDescription>
              Le libellé est le nom affiché ; la correspondance détermine les
              opérations bancaires rattachées.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="flex flex-col gap-1 text-sm">
              <span>Opération liée</span>
              <select
                required
                value={form.libelleSimplifie}
                onChange={(event) => handleLabelChange(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>
                  Sélectionner un libellé…
                </option>
                {labelOptions.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span>Correspondance</span>
                <select
                  value={form.matchMode}
                  onChange={(event) =>
                    handleMatchModeChange(event.target.value as MatchMode)
                  }
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {MATCH_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {MATCH_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </label>

              {form.matchMode !== 'exact' && (
                <label className="flex flex-col gap-1 text-sm">
                  <span>
                    {form.matchMode === 'regex'
                      ? 'Expression régulière'
                      : 'Texte contenu'}
                  </span>
                  <input
                    type="text"
                    required
                    value={form.matchPattern}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        matchPattern: event.target.value,
                      }))
                    }
                    placeholder={
                      form.matchMode === 'regex'
                        ? '^netflix(\\.com)?$'
                        : 'NETFLIX'
                    }
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {form.matchMode === 'exact' &&
                'Correspond au libellé exact, sans tenir compte de la casse.'}
              {form.matchMode === 'contains' &&
                'Correspond aux libellés qui contiennent ce texte, sans tenir compte de la casse.'}
              {form.matchMode === 'regex' &&
                'Expression régulière JavaScript, insensible à la casse.'}
            </p>

            <p
              className={cn(
                'text-xs',
                matchPreview.invalid
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {matchPreview.invalid
                ? 'Expression régulière invalide.'
                : matchPreview.labels.length === 0
                  ? 'Aucun libellé connu ne correspond.'
                  : `Correspond à : ${matchPreview.labels.join(', ')}`}
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span>Montant (€)</span>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={form.montant}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      montant: event.target.value,
                    }))
                  }
                  placeholder="-39.99"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span>Tous les … mois</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={form.intervalMonths}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      intervalMonths: event.target.value,
                    }))
                  }
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span>Premier mois</span>
                <input
                  type="month"
                  min="2000-01"
                  max="2100-12"
                  required
                  value={form.firstMonth}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      firstMonth: event.target.value,
                    }))
                  }
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span>Durée</span>
                <select
                  value={form.durationType}
                  onChange={(event) =>
                    handleDurationChange(event.target.value as DurationType)
                  }
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="unlimited">Illimitée</option>
                  <option value="until">Jusqu'à un mois</option>
                  <option value="count">Nombre d'occurrences</option>
                </select>
              </label>

              {form.durationType === 'until' && (
                <label className="flex flex-col gap-1 text-sm">
                  <span>Dernier mois (inclus)</span>
                  <input
                    type="month"
                    required
                    min={form.firstMonth || undefined}
                    value={form.endMonth}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        endMonth: event.target.value,
                      }))
                    }
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              )}

              {form.durationType === 'count' && (
                <label className="flex flex-col gap-1 text-sm">
                  <span>Nombre d'occurrences</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={form.occurrences}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        occurrences: event.target.value,
                      }))
                    }
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              )}
            </div>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={saving || labelOptions.length === 0}
              >
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deletingBusy) {
            setDeleting(null)
            setDeleteError(undefined)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer l'opération récurrente</DialogTitle>
            <DialogDescription>
              {deleting
                ? `Supprimer la récurrence « ${deleting.libelleSimplifie} » ? Les opérations bancaires existantes ne seront pas modifiées.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={deletingBusy}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deletingBusy}
            >
              {deletingBusy ? 'Suppression…' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
