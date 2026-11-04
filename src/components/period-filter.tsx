import { useState } from 'react'
import { endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Calendar03Icon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from 'cn'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export type PeriodRange = [from: string, to: string]

type Mode = 'monthly' | 'yearly'

const MONTHS = [
  'Janv.',
  'Févr.',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juil.',
  'Août',
  'Sept.',
  'Oct.',
  'Nov.',
  'Déc.',
]

function isFullYear(value: PeriodRange) {
  return (
    value[0].endsWith('-01-01') &&
    value[1].endsWith('-12-31') &&
    value[0].slice(0, 4) === value[1].slice(0, 4)
  )
}

function isFullMonth(value: PeriodRange) {
  const from = parseISO(value[0])
  return (
    value[0].slice(0, 7) === value[1].slice(0, 7) &&
    value[0] === format(startOfMonth(from), 'yyyy-MM-dd') &&
    value[1] === format(endOfMonth(from), 'yyyy-MM-dd')
  )
}

function formatLabel(value?: PeriodRange) {
  if (!value) return 'Période'
  const from = parseISO(value[0])
  if (isFullYear(value)) return format(from, 'yyyy')
  if (isFullMonth(value)) return `${MONTHS[from.getMonth()]} ${format(from, 'yyyy')}`
  return `${format(from, 'dd/MM/yyyy')} – ${format(parseISO(value[1]), 'dd/MM/yyyy')}`
}

function monthRange(year: number, month: number): PeriodRange {
  const date = new Date(year, month, 1)
  return [
    format(startOfMonth(date), 'yyyy-MM-dd'),
    format(endOfMonth(date), 'yyyy-MM-dd'),
  ]
}

function yearRange(year: number): PeriodRange {
  return [`${year}-01-01`, `${year}-12-31`]
}

export function PeriodFilter({
  value,
  onChange,
  years,
}: {
  value?: PeriodRange
  onChange: (value: PeriodRange | undefined) => void
  years: number[]
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('monthly')
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear())
  const [draft, setDraft] = useState<PeriodRange | undefined>(value)

  const today = new Date()
  const firstYear = years[0] ?? today.getFullYear()
  const lastYear = years[years.length - 1] ?? today.getFullYear()

  function handleOpenChange(next: boolean) {
    if (next) {
      const base = value ? parseISO(value[0]) : today
      setMode(value && isFullYear(value) ? 'yearly' : 'monthly')
      setViewYear(
        Math.min(Math.max(base.getFullYear(), firstYear), lastYear),
      )
      setDraft(value)
    }
    setOpen(next)
  }

  function isFutureMonth(month: number) {
    return (
      viewYear > today.getFullYear() ||
      (viewYear === today.getFullYear() && month > today.getMonth())
    )
  }

  function isFutureYear(year: number) {
    return year > today.getFullYear()
  }

  const draftDate = draft ? parseISO(draft[0]) : undefined
  const draftIsMonth = draft !== undefined && isFullMonth(draft)
  const selectedMonth = draftIsMonth && draftDate ? draftDate.getMonth() : -1
  const selectedMonthYear =
    draftIsMonth && draftDate ? draftDate.getFullYear() : -1
  const selectedYear =
    draft && isFullYear(draft) ? Number(draft[0].slice(0, 4)) : undefined

  function handleApply() {
    if (!draft) return
    onChange(draft)
    setOpen(false)
  }

  function handleClear() {
    setDraft(undefined)
    onChange(undefined)
    setOpen(false)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        className={cn(
          'font-normal',
          value
            ? 'border-primary text-primary hover:bg-primary/10 hover:text-primary'
            : 'text-muted-foreground',
        )}
        onClick={() => handleOpenChange(true)}
      >
        <HugeiconsIcon icon={Calendar03Icon} data-icon="inline-start" />
        {formatLabel(value)}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto">
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-4 right-4"
                aria-label="Fermer"
              />
            }
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} />
          </DialogClose>

          <DialogHeader className="items-center text-center">
            <DialogTitle>Filtrer la période</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-8 border-b mb-4">
            {(
              [
                ['monthly', 'Mensuelle'],
                ['yearly', 'Annuelle'],
              ] as const
            ).map(([nextMode, label]) => (
              <button
                key={nextMode}
                type="button"
                aria-pressed={mode === nextMode}
                onClick={() => setMode(nextMode)}
                className={cn(
                  'relative pb-2 text-sm font-medium transition-colors',
                  mode === nextMode
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
                <span
                  className={cn(
                    'absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary transition-opacity',
                    mode === nextMode ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            ))}
          </div>

          {mode === 'monthly' ? (
            <>
              <div className="flex items-center justify-center gap-8">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Année précédente"
                  disabled={viewYear <= firstYear}
                  onClick={() =>
                    setViewYear((year) => Math.max(firstYear, year - 1))
                  }
                >
                  <HugeiconsIcon icon={ArrowLeftIcon} size={18} />
                </Button>
                <span className="min-w-16 text-center text-md font-semibold tabular-nums">
                  {viewYear}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Année suivante"
                  disabled={viewYear >= lastYear}
                  onClick={() =>
                    setViewYear((year) => Math.min(lastYear, year + 1))
                  }
                >
                  <HugeiconsIcon icon={ArrowRightIcon} size={18} />
                </Button>
              </div>

              <div
                role="group"
                aria-label="Mois"
                className="grid grid-cols-3 gap-2 sm:grid-cols-6 mb-6 mt-4"
              >
                {MONTHS.map((label, month) => {
                  const disabled = isFutureMonth(month)
                  const selected =
                    selectedMonth === month && selectedMonthYear === viewYear
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => setDraft(monthRange(viewYear, month))}
                      className={cn(
                        'h-10 rounded-full border border-border text-sm transition-colors outline-none',
                        'hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        selected && 'border-primary font-medium text-primary',
                        disabled &&
                          'pointer-events-none border-transparent bg-muted text-muted-foreground/50',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <div
              role="group"
              aria-label="Années"
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            >
              {years.map((year) => {
                const disabled = isFutureYear(year)
                const selected = selectedYear === year
                return (
                  <button
                    key={year}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => setDraft(yearRange(year))}
                    className={cn(
                      'h-10 rounded-full border border-border text-sm tabular-nums transition-colors outline-none',
                      'hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      selected && 'border-primary font-medium text-primary',
                      disabled &&
                        'pointer-events-none border-transparent bg-muted text-muted-foreground/50',
                    )}
                  >
                    {year}
                  </button>
                )
              })}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 pt-4 sm:flex-row sm:items-center mt-4">
            {value && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleClear}
                className="sm:mr-auto"
              >
                Effacer
              </Button>
            )}
            <Button
              type="button"
              onClick={handleApply}
              disabled={!draft}
              className="w-full sm:flex-1"
            >
              Appliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
