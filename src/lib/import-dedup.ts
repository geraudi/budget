import {
  fingerprintFromOperationRow,
  fingerprintOperation,
  type OperationFingerprintSource,
  type ParsedOperation,
} from '#/lib/csv.ts'

export type ExistingOperation = OperationFingerprintSource & {
  id: number
  fingerprint: string | null
}

export type ImportPlan = {
  newRows: Array<{ row: ParsedOperation; fingerprint: string }>
  /** rows already represented in the database (or repeated in the file) */
  duplicates: number
  /** stored fingerprints that no longer match the current algorithm */
  staleFingerprints: Array<{ id: number; fingerprint: string }>
}

/**
 * Decides which parsed rows still need to be inserted.
 *
 * A bank reference uniquely identifies an operation, so it is used as the
 * dedup key whenever present. Reference-less operations fall back to their
 * content fingerprint. Existing fingerprints are recomputed from the row
 * itself because stored values can be stale after a fingerprint change.
 *
 * Reference-less operations are matched by count, not by set membership:
 * two identical purchases on the same day (same shop, same amount) are
 * distinct operations and must not collapse into one.
 */
export function planImport(
  rows: Array<ParsedOperation>,
  existingRows: Array<ExistingOperation>,
): ImportPlan {
  const knownReferences = new Set<string>()
  const knownFingerprints = new Map<string, number>()
  const staleFingerprints: Array<{ id: number; fingerprint: string }> = []

  for (const existing of existingRows) {
    const fingerprint = fingerprintFromOperationRow(existing)
    if (existing.reference) {
      knownReferences.add(existing.reference)
    } else {
      knownFingerprints.set(
        fingerprint,
        (knownFingerprints.get(fingerprint) ?? 0) + 1,
      )
    }
    if (existing.fingerprint !== fingerprint) {
      staleFingerprints.push({ id: existing.id, fingerprint })
    }
  }

  const fileReferences = new Set<string>()
  const matchedFingerprints = new Map<string, number>()
  const newRows: ImportPlan['newRows'] = []
  let duplicates = 0

  for (const row of rows) {
    const fingerprint = fingerprintOperation(row)
    let duplicate: boolean

    if (row.reference) {
      duplicate =
        knownReferences.has(row.reference) || fileReferences.has(row.reference)
      fileReferences.add(row.reference)
    } else {
      const seen = matchedFingerprints.get(fingerprint) ?? 0
      matchedFingerprints.set(fingerprint, seen + 1)
      duplicate = seen < (knownFingerprints.get(fingerprint) ?? 0)
    }

    if (duplicate) {
      duplicates += 1
      continue
    }
    newRows.push({ row, fingerprint })
  }

  return { newRows, duplicates, staleFingerprints }
}
