import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createFileRoute,
  useHydrated,
  useRouter,
} from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_inDateRange,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Delete02Icon,
  Download04Icon,
  Edit01Icon,
  HistoryIcon,
  Search01Icon,
  UploadIcon,
} from '@hugeicons/core-free-icons'
import { cn } from 'cn'

import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { PeriodFilter, type PeriodRange } from '#/components/period-filter'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  deleteOperation,
  getOperationHistory,
  getOperations,
  getSimilarOperations,
  setOperationPointage,
  updateOperation,
  type Operation,
  type OperationHistoryEntry,
  type SimilarOperation,
  type UpdateOperationInput,
} from '#/server/operations'
import { getCategories } from '#/server/categories'
import {
  encodeLatin1,
  serializeOperationsCsv,
} from '#/lib/csv-export'
import { importOperationsCsv, type ImportResult } from '#/server/import'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [operations, categories] = await Promise.all([
      getOperations(),
      getCategories(),
    ])
    return { operations, categories }
  },
  component: OperationsPage,
})

const features = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { inDateRange: filterFn_inDateRange, includesString: filterFn_includesString },
  globalFilteringFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
})

const helper = createColumnHelper<typeof features, Operation>()

const money = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

const HISTORY_EVENT_LABELS: Record<string, string> = {
  OperationImported: 'Importation',
  OperationDetailsUpdated: 'Modification',
  OperationCategorized: 'Catégorisation',
  OperationClassified: 'Classement',
  OperationPointageChanged: 'Pointage',
  OperationDeleted: 'Suppression',
}

const HISTORY_SOURCE_LABELS: Record<string, string> = {
  'csv-import': 'Import CSV',
  ui: 'Interface',
  backfill: 'Reprise historique',
  system: 'Système',
}

function formatDate(value: string | null) {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.split('-').reverse().join('/')
  }
  return value
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([encodeLatin1(content)], {
    type: 'text/csv;charset=iso-8859-1',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking it synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function toNumOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const num = Number(trimmed)
  if (!Number.isFinite(num)) return null
  return num
}

function emptyForm(): UpdateOperationInput {
  return {
    id: 0,
    dateComptabilisation: '',
    libelleSimplifie: '',
    libelleOperation: '',
    reference: null,
    infosComplementaires: null,
    typeOperation: null,
    categoryId: null,
    subCategoryId: null,
    debit: null,
    credit: null,
    montant: 0,
    dateOperation: null,
    dateValeur: null,
    pointage: null,
  }
}

function OperationsPage() {
  const { operations: loadedOperations, categories } = Route.useLoaderData()
  const [operations, setOperations] = useState(loadedOperations)
  const router = useRouter()
  const hydrated = useHydrated()
  const importFn = useServerFn(importOperationsCsv)
  const updateFn = useServerFn(updateOperation)
  const deleteFn = useServerFn(deleteOperation)
  const pointageFn = useServerFn(setOperationPointage)
  const similarFn = useServerFn(getSimilarOperations)
  const historyFn = useServerFn(getOperationHistory)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult>()
  const [importError, setImportError] = useState<string>()
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'dateOperation', desc: true },
  ])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [excludeRecurring, setExcludeRecurring] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Operation | null>(null)
  const [saving, setSaving] = useState(false)
  const [checkingSimilar, setCheckingSimilar] = useState(false)
  const [similarPending, setSimilarPending] = useState<{
    libelleSimplifie: string
    operations: SimilarOperation[]
  } | null>(null)
  const [editError, setEditError] = useState<string>()
  const [form, setForm] = useState<UpdateOperationInput>(emptyForm())

  const [deleteTarget, setDeleteTarget] = useState<Operation | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()

  const [historyTarget, setHistoryTarget] = useState<Operation | null>(null)
  const [historyEntries, setHistoryEntries] = useState<
    OperationHistoryEntry[] | null
  >(null)
  const [historyError, setHistoryError] = useState<string>()

  const [pendingPointageIds, setPendingPointageIds] = useState<
    ReadonlySet<number>
  >(new Set())
  const [pointageError, setPointageError] = useState<string>()

  // Resync rows only when the loader actually refetches (CSV import, delete),
  // not on every inline edit, so the table keeps its page and scroll position.
  useEffect(() => {
    setOperations(loadedOperations)
  }, [loadedOperations])

  function openEdit(op: Operation) {
    setEditing(op)
    setForm({
      id: op.id,
      dateComptabilisation: op.dateComptabilisation,
      libelleSimplifie: op.libelleSimplifie,
      libelleOperation: op.libelleOperation,
      reference: op.reference,
      infosComplementaires: op.infosComplementaires,
      typeOperation: op.typeOperation,
      categoryId: op.categoryId,
      subCategoryId: op.subCategoryId,
      debit: op.debit,
      credit: op.credit,
      montant: op.montant,
      dateOperation: op.dateOperation,
      dateValeur: op.dateValeur,
      pointage: op.pointage,
    })
    setEditError(undefined)
    setSimilarPending(null)
    setDialogOpen(true)
  }

  function handleDeleteDialogOpenChange(open: boolean) {
    if (!open) {
      setDeleteError(undefined)
      setDeleteTarget(null)
    }
  }

  async function openHistory(operation: Operation) {
    setHistoryTarget(operation)
    setHistoryEntries(null)
    setHistoryError(undefined)
    try {
      setHistoryEntries(await historyFn({ data: { id: operation.id } }))
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : 'Historique indisponible',
      )
    }
  }

  function handleHistoryDialogOpenChange(open: boolean) {
    if (!open) {
      setHistoryTarget(null)
      setHistoryEntries(null)
      setHistoryError(undefined)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deletePending) return
    setDeletePending(true)
    setDeleteError(undefined)
    try {
      await deleteFn({ data: { id: deleteTarget.id } })
      setDeleteTarget(null)
      await router.invalidate({ sync: true })
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Suppression impossible',
      )
    } finally {
      setDeletePending(false)
    }
  }

  async function handleTogglePointage(operation: Operation, checked: boolean) {
    if (pendingPointageIds.has(operation.id)) return
    const pointage = checked ? 1 : 0
    setPointageError(undefined)
    setPendingPointageIds((ids) => new Set(ids).add(operation.id))
    setOperations((rows) =>
      rows.map((row) => (row.id === operation.id ? { ...row, pointage } : row)),
    )
    try {
      await pointageFn({ data: { id: operation.id, pointage } })
    } catch (error) {
      setOperations((rows) =>
        rows.map((row) =>
          row.id === operation.id
            ? { ...row, pointage: operation.pointage }
            : row,
        ),
      )
      setPointageError(
        error instanceof Error ? error.message : 'Mise à jour impossible',
      )
    } finally {
      setPendingPointageIds((ids) => {
        const next = new Set(ids)
        next.delete(operation.id)
        return next
      })
    }
  }

  async function handleFile(file: File) {
    setImporting(true)
    setImportError(undefined)
    try {
      const formData = new FormData()
      formData.set('file', file)
      const result = await importFn({ data: formData })
      setImportResult(result)
      await router.invalidate({ sync: true })
    } catch (error) {
      setImportResult(undefined)
      setImportError(error instanceof Error ? error.message : 'Import impossible')
    } finally {
      setImporting(false)
    }
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open)
    if (!open) {
      setSimilarPending(null)
      setEditError(undefined)
    }
  }

  async function persistOperation(applyToSimilar: boolean) {
    if (!editing) return
    setSaving(true)
    setEditError(undefined)
    try {
      const result = await updateFn({
        data: { ...form, id: editing.id, applyToSimilar },
      })
      const category = categories.find((item) => item.id === result.categoryId)
      const subCategory = category?.subCategories.find(
        (item) => item.id === result.subCategoryId,
      )
      const categorie = category?.name ?? null
      const sousCategorie = subCategory?.name ?? null
      setOperations((rows) =>
        rows.map((row) => {
          if (row.id === editing.id) {
            return {
              ...row,
              ...form,
              categoryId: result.categoryId,
              subCategoryId: result.subCategoryId,
              categorie,
              sousCategorie,
              isRecurring: result.isRecurring,
            }
          }
          if (result.updatedSimilarIds.includes(row.id)) {
            return {
              ...row,
              categoryId: result.categoryId,
              subCategoryId: result.subCategoryId,
              categorie,
              sousCategorie,
            }
          }
          return row
        }),
      )
      setSimilarPending(null)
      setDialogOpen(false)
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : 'Enregistrement impossible',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || saving || checkingSimilar) return

    const categoryChanged =
      form.categoryId !== editing.categoryId ||
      form.subCategoryId !== editing.subCategoryId

    if (!categoryChanged) {
      await persistOperation(false)
      return
    }

    setCheckingSimilar(true)
    setEditError(undefined)
    try {
      const result = await similarFn({ data: { id: editing.id } })
      const changed = result.operations.some(
        (operation) =>
          operation.categoryId !== form.categoryId ||
          operation.subCategoryId !== form.subCategoryId,
      )

      if (changed) {
        setSimilarPending(result)
      } else {
        await persistOperation(false)
      }
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : 'Recherche impossible',
      )
    } finally {
      setCheckingSimilar(false)
    }
  }

  const columns = helper.columns([
    helper.accessor('dateOperation', {
      header: 'Date',
      sortFn: 'alphanumeric',
      filterFn: 'inDateRange',
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDate(getValue())}
        </span>
      ),
    }),
    helper.accessor('libelleSimplifie', {
      header: 'Libellé simplifié',
      sortFn: 'alphanumeric',
      cell: ({ getValue }) => (
        <span className="block max-w-40 truncate lg:max-w-56" title={getValue()}>
          {getValue()}
        </span>
      ),
    }),
    helper.accessor('libelleOperation', {
      header: 'Libellé opération',
      sortFn: 'alphanumeric',
      cell: ({ getValue }) => (
        <span className="block max-w-sm truncate lg:max-w-md" title={getValue()}>
          {getValue()}
        </span>
      ),
    }),
    helper.accessor('categorie', {
      header: 'Catégorie',
      cell: ({ getValue }) => getValue() ?? '—',
    }),
    helper.accessor('sousCategorie', {
      header: 'Sous-cat.',
      cell: ({ getValue }) => getValue() ?? '—',
    }),
    helper.accessor('montant', {
      header: 'Montant',
      cell: ({ getValue }) => {
        const value = getValue()
        return (
          <span
            className={cn(
              'block text-right font-medium tabular-nums',
              value < 0 && 'text-destructive',
            )}
          >
            {money.format(value)}
          </span>
        )
      },
    }),
    helper.accessor('pointage', {
      header: 'Point.',
      enableSorting: false,
      cell: ({ row, getValue }) => {
        const id = row.original.id
        return (
          <span className="flex justify-center">
            <Checkbox
              checked={!!getValue()}
              disabled={pendingPointageIds.has(id)}
              onCheckedChange={(checked) =>
                void handleTogglePointage(row.original, checked)
              }
              aria-label={`Pointé — ${row.original.libelleOperation}`}
              className="cursor-pointer disabled:cursor-progress"
            />
          </span>
        )
      },
    }),
    helper.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => openEdit(row.original)}
            aria-label="Modifier"
          >
            <HugeiconsIcon icon={Edit01Icon} size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void openHistory(row.original)}
            aria-label="Historique"
          >
            <HugeiconsIcon icon={HistoryIcon} size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setDeleteError(undefined)
              setDeleteTarget(row.original)
            }}
            aria-label="Supprimer"
          >
            <HugeiconsIcon icon={Delete02Icon} size={16} />
          </Button>
        </div>
      ),
    }),
  ])

  const visibleData = excludeRecurring
    ? operations.filter((operation) => !operation.isRecurring)
    : operations

  const table = useTable({
    features,
    columns,
    data: visibleData,
    getRowId: (row) => String(row.id),
    initialState: { pagination: { pageIndex: 0, pageSize: 100 } },
    // Row updates replace the data array; keep the current page instead of
    // jumping back to page 1 on every inline edit.
    autoResetPageIndex: false,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'includesString',
  })

  const dateRange = columnFilters.find(
    (filter) => filter.id === 'dateOperation',
  )?.value as PeriodRange | undefined

  // Years offered by the period picker: only years that actually contain
  // operations, capped at the current year (future periods are not selectable).
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const years = new Set<number>()
    for (const operation of operations) {
      const date = operation.dateOperation ?? operation.dateComptabilisation
      const year = date ? Number(date.slice(0, 4)) : Number.NaN
      if (Number.isInteger(year) && year <= currentYear) years.add(year)
    }
    if (years.size === 0) years.add(currentYear)
    return [...years].sort((a, b) => a - b)
  }, [operations])

  function handlePeriodChange(value: PeriodRange | undefined) {
    setColumnFilters((filters) => [
      ...filters.filter((filter) => filter.id !== 'dateOperation'),
      ...(value ? [{ id: 'dateOperation', value }] : []),
    ])
    table.setPageIndex(0)
  }

  // Totals follow the active filters (date range, search, recurring exclusion),
  // not the whole dataset.
  const filteredRows = table.getFilteredRowModel().rows
  const filteredCount = filteredRows.length
  const solde = filteredRows.reduce((sum, row) => sum + row.original.montant, 0)

  // Export what the table shows: every filtered row (all pages) in the
  // current sort order.
  function handleExport() {
    const rows = table.getSortedRowModel().rows.map((row) => row.original)
    downloadCsv(
      `operations-${format(new Date(), 'yyyy-MM-dd')}.csv`,
      serializeOperationsCsv(rows),
    )
  }

  const selectedCategory = categories.find(
    (category) => category.id === form.categoryId,
  )
  const selectedSubCategory = selectedCategory?.subCategories.find(
    (subCategory) => subCategory.id === form.subCategoryId,
  )
  const categoryItems = [
    { value: null as number | null, label: '— Aucune —' },
    ...categories.map((category) => ({
      value: category.id as number | null,
      label: category.name,
    })),
  ]
  const subCategoryItems = [
    { value: null as number | null, label: '— Aucune —' },
    ...(selectedCategory?.subCategories ?? []).map((subCategory) => ({
      value: subCategory.id as number | null,
      label: subCategory.name,
    })),
  ]
  const similarChangedCount = similarPending
    ? similarPending.operations.filter(
        (operation) =>
          operation.categoryId !== form.categoryId ||
          operation.subCategoryId !== form.subCategoryId,
      ).length
    : 0

  return (
    <main
      className="mx-auto w-full max-w-6xl px-4 py-10"
      data-hydrated={hydrated || undefined}
    >
      <Card>
        <CardHeader>
          <CardTitle>Opérations</CardTitle>
          <CardDescription>
            {filteredCount} opération{filteredCount === 1 ? '' : 's'} · Solde{' '}
            <span className={cn('tabular-nums', solde < 0 && 'text-destructive')}>
              {money.format(solde)}
            </span>
          </CardDescription>
          <CardAction>
            <div className="flex flex-col items-end gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleFile(file)
                  event.target.value = ''
                }}
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <PeriodFilter
                  value={dateRange}
                  onChange={handlePeriodChange}
                  years={availableYears}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={importing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <HugeiconsIcon icon={UploadIcon} data-icon="inline-start" />
                  {importing ? 'Import en cours…' : 'Importer CSV'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filteredCount === 0}
                  onClick={handleExport}
                >
                  <HugeiconsIcon
                    icon={Download04Icon}
                    data-icon="inline-start"
                  />
                  Exporter CSV
                </Button>
              </div>
              {importResult && (
                <span className="text-xs text-muted-foreground">
                  {importResult.inserted} ajoutée{importResult.inserted === 1 ? '' : 's'}
                  {' · '}
                  {importResult.duplicates + importResult.ignored} ignorée
                  {importResult.duplicates + importResult.ignored === 1 ? '' : 's'}
                </span>
              )}
              {importError && (
                <span className="text-xs text-destructive">{importError}</span>
              )}
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <HugeiconsIcon icon={Search01Icon} className="text-muted-foreground" />
            <Input
              type="search"
              placeholder="Rechercher…"
              value={globalFilter ?? ''}
              onChange={(event) => {
                setGlobalFilter(event.target.value)
                table.setPageIndex(0)
              }}
              className="max-w-sm"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={excludeRecurring}
                onCheckedChange={(checked) => {
                  setExcludeRecurring(checked)
                  table.setPageIndex(0)
                }}
              />
              Exclure les récurrentes
            </label>
          </div>
          {pointageError && (
            <p className="mb-2 text-xs text-destructive">{pointageError}</p>
          )}
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            disabled={!header.column.getCanSort()}
                            className={cn(
                              'flex w-full select-none items-center gap-1 whitespace-nowrap font-medium',
                              header.column.id === 'montant' && 'justify-end',
                              header.column.id === 'pointage' && 'justify-center',
                              header.column.id === 'actions' &&
                                'justify-end',
                            )}
                          >
                            <table.FlexRender header={header} />
                            <span className="text-muted-foreground">
                              {header.column.getIsSorted() === 'asc'
                                ? '↑'
                                : header.column.getIsSorted() === 'desc'
                                  ? '↓'
                                  : ''}
                            </span>
                          </button>
                        </div>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-sm text-muted-foreground">
            Page {table.state.pagination.pageIndex + 1} sur{' '}
            {Math.max(1, table.getPageCount())}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Page précédente"
            >
              <HugeiconsIcon icon={ArrowLeftIcon} size={16} />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Page suivante"
            >
              <HugeiconsIcon icon={ArrowRightIcon} size={16} />
            </Button>
          </div>
        </CardFooter>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {similarPending
                ? 'Opérations similaires'
                : "Modifier l'opération"}
            </DialogTitle>
            <DialogDescription>
              {similarPending
                ? `${similarPending.operations.length} opération${similarPending.operations.length === 1 ? '' : 's'} partage${similarPending.operations.length === 1 ? '' : 'nt'} le libellé « ${similarPending.libelleSimplifie} »`
                : editing
                  ? `ID ${editing.id}`
                  : ''}
            </DialogDescription>
          </DialogHeader>
          {similarPending ? (
            <div className="space-y-4">
              <p className="text-sm">
                Appliquer{' '}
                <span className="font-medium">
                  {selectedCategory?.name ?? 'Aucune catégorie'}
                  {selectedSubCategory ? ` / ${selectedSubCategory.name}` : ''}
                </span>{' '}
                aux opérations surlignées ? Seules la catégorie et la
                sous-catégorie seront modifiées.
              </p>
              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Libellé opération</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead>Catégorie actuelle</TableHead>
                      <TableHead>Sous-cat.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {similarPending.operations.map((operation) => {
                      const willChange =
                        operation.categoryId !== form.categoryId ||
                        operation.subCategoryId !== form.subCategoryId
                      return (
                        <TableRow
                          key={operation.id}
                          className={willChange ? 'bg-muted/60' : undefined}
                        >
                          <TableCell className="tabular-nums">
                            {formatDate(operation.dateOperation)}
                          </TableCell>
                          <TableCell>
                            <span
                              className="block max-w-56 truncate"
                              title={operation.libelleOperation}
                            >
                              {operation.libelleOperation}
                            </span>
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums',
                              operation.montant < 0 && 'text-destructive',
                            )}
                          >
                            {money.format(operation.montant)}
                          </TableCell>
                          <TableCell>
                            {operation.categorie ?? '—'}
                          </TableCell>
                          <TableCell>
                            {operation.sousCategorie ?? '—'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Les lignes surlignées seront mises à jour ; les autres ont
                déjà la catégorie choisie.
              </p>
              {editError && (
                <p className="text-sm text-destructive">{editError}</p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSimilarPending(null)
                    setEditError(undefined)
                  }}
                  disabled={saving}
                >
                  Retour
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void persistOperation(false)}
                  disabled={saving}
                >
                  Enregistrer uniquement
                </Button>
                <Button
                  type="button"
                  onClick={() => void persistOperation(true)}
                  disabled={saving}
                >
                  {saving
                    ? 'Enregistrement…'
                    : `Enregistrer et appliquer à ${similarChangedCount} opération${similarChangedCount === 1 ? '' : 's'}`}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span>Date de comptabilisation</span>
                <Input
                  type="date"
                  required
                  value={form.dateComptabilisation}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      dateComptabilisation: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Libellé simplifié</span>
                <Input
                  type="text"
                  required
                  value={form.libelleSimplifie}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, libelleSimplifie: e.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span>Libellé opération</span>
                <Input
                  type="text"
                  required
                  value={form.libelleOperation}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, libelleOperation: e.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Référence</span>
                <Input
                  type="text"
                  value={form.reference ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, reference: e.target.value || null }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Type d'opération</span>
                <Input
                  type="text"
                  value={form.typeOperation ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, typeOperation: e.target.value || null }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Catégorie</span>
                <Select
                  items={categoryItems}
                  value={form.categoryId}
                  onValueChange={(categoryId) => {
                    setForm((f) => {
                      const category = categories.find(
                        (item) => item.id === categoryId,
                      )
                      const subCategoryId =
                        category?.subCategories.some(
                          (subCategory) => subCategory.id === f.subCategoryId,
                        )
                          ? f.subCategoryId
                          : null
                      return { ...f, categoryId, subCategoryId }
                    })
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="— Aucune —" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryItems.map((item) => (
                      <SelectItem key={item.value ?? 'none'} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Sous-catégorie</span>
                <Select
                  items={subCategoryItems}
                  value={form.subCategoryId}
                  disabled={form.categoryId === null}
                  onValueChange={(subCategoryId) =>
                    setForm((f) => ({ ...f, subCategoryId }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="— Aucune —" />
                  </SelectTrigger>
                  <SelectContent>
                    {subCategoryItems.map((item) => (
                      <SelectItem key={item.value ?? 'none'} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Débit</span>
                <Input
                  type="number"
                  step="0.01"
                  value={form.debit ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, debit: toNumOrNull(e.target.value) }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Crédit</span>
                <Input
                  type="number"
                  step="0.01"
                  value={form.credit ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, credit: toNumOrNull(e.target.value) }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Montant</span>
                <Input
                  type="number"
                  step="0.01"
                  required
                  value={form.montant}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, montant: Number(e.target.value) }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Date opération</span>
                <Input
                  type="date"
                  value={form.dateOperation ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dateOperation: e.target.value || null }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Date de valeur</span>
                <Input
                  type="date"
                  value={form.dateValeur ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dateValeur: e.target.value || null }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <Checkbox
                  checked={!!form.pointage}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, pointage: checked ? 1 : 0 }))
                  }
                />
                <span>Pointé</span>
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span>Informations complémentaires</span>
                <textarea
                  value={form.infosComplementaires ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      infosComplementaires: e.target.value || null,
                    }))
                  }
                  className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>
            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleDialogOpenChange(false)}
                disabled={saving || checkingSimilar}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={saving || checkingSimilar}>
                {checkingSimilar
                  ? 'Recherche…'
                  : saving
                    ? 'Enregistrement…'
                    : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={historyTarget !== null}
        onOpenChange={handleHistoryDialogOpenChange}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Historique de l'opération</DialogTitle>
            <DialogDescription>
              {historyTarget
                ? `ID ${historyTarget.id} — ${historyTarget.libelleOperation}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {historyError && (
            <p className="text-sm text-destructive">{historyError}</p>
          )}
          {historyEntries === null && !historyError ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : historyEntries && historyEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun événement enregistré.
            </p>
          ) : (
            <ol className="max-h-96 space-y-3 overflow-auto pr-1">
              {historyEntries?.map((entry) => (
                <li
                  key={entry.eventId}
                  className="rounded-md border bg-muted/30 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      {HISTORY_EVENT_LABELS[entry.type] ?? entry.type}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      v{entry.streamVersion}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      {format(new Date(entry.occurredAt), 'dd/MM/yyyy HH:mm')}
                    </span>
                    <span>
                      {HISTORY_SOURCE_LABELS[entry.source] ?? entry.source}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleHistoryDialogOpenChange(false)}
            >
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={handleDeleteDialogOpenChange}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer l'opération ?</DialogTitle>
            <DialogDescription>
              Cette action est définitive et ne peut pas être annulée.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground tabular-nums">
                  {formatDate(deleteTarget.dateOperation)}
                </span>
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    deleteTarget.montant < 0 && 'text-destructive',
                  )}
                >
                  {money.format(deleteTarget.montant)}
                </span>
              </div>
              <p className="mt-1 font-medium">{deleteTarget.libelleSimplifie}</p>
              <p
                className="truncate text-muted-foreground"
                title={deleteTarget.libelleOperation}
              >
                {deleteTarget.libelleOperation}
              </p>
            </div>
          )}
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDeleteDialogOpenChange(false)}
              disabled={deletePending}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deletePending}
            >
              {deletePending ? 'Suppression…' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}