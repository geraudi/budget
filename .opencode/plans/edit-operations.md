# Plan: Edit operation rows in home page table

## Goal
Add an "Modifier" action per operation row on the home page. Clicking it opens a modal dialog (popin) containing a form for all operation fields. Saving persists changes to SQLite via a new server function and refreshes the table.

## Changes

### 1. New UI component: `src/components/ui/dialog.tsx`
Create a shadcn-style Dialog wrapper around `@base-ui/react/dialog`, following the existing `popover.tsx` pattern. Export `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`, `DialogTrigger`.

### 2. Server function: `src/lib/operations.ts`
- Add `updateOperation` (POST) with validator for `UpdateOperationInput`:
  - `id: number`
  - all operation fields (strings/numbers/nullables as in schema)
- Handler: `db.update(operations).set({...}).where(eq(operations.id, id)).run()`, then `syncRecurringOperations()`.
- Export `UpdateOperationInput` type.

### 3. Home page: `src/routes/index.tsx`
- Import Dialog components, `updateOperation`, `Edit01Icon`.
- Add "Actions" column to table with an Edit button per row.
- State: `editing: Operation | null`, `open` boolean, form state initialized from selected operation.
- Controlled `Dialog` with form fields for all operation fields.
- On submit: call `updateOperation`, invalidate router, close dialog.
- Form inputs: text/number/date; checkbox for `pointage` (stored as 0/1/null).
- Reset form when selected operation changes.

### 4. Verification
- `pnpm exec tsc --noEmit` must pass.

## Notes
- No migration needed (read/update existing schema).
- `montant` edited directly; `debit`/`credit` also editable for completeness.
- Date fields use `yyyy-mm-dd` text inputs.
- After update, `syncRecurringOperations()` keeps recurring flags consistent.
