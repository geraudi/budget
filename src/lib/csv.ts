import { createHash } from 'node:crypto'

/**
 * Bank statement parsing, French format: `;`-separated, ISO-8859-1
 * encoded, dates `dd/mm/yyyy`, signed amounts with `.` decimals
 * (e.g. `-27.00`, `+15.90`). The matching export lives in `csv-export.ts`.
 */

export type ParsedOperation = {
  dateComptabilisation: string
  libelleSimplifie: string
  libelleOperation: string
  reference: string | null
  infosComplementaires: string | null
  typeOperation: string | null
  categorie: string | null
  sousCategorie: string | null
  debit: number | null
  credit: number | null
  montant: number
  dateOperation: string | null
  dateValeur: string | null
  pointage: number | null
}

/** Parsed result: valid rows plus per-line counters. */
export type CsvParseResult = {
  rows: Array<ParsedOperation>
  ignored: number
}

function splitLine(line: string): Array<string> {
  const fields: Array<string> = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ';') {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields
}

/** `dd/mm/yyyy` → `yyyy-mm-dd`, same semantics as `../make_db.py`. */
export function parseDate(value: string): string | null {
  if (!value.trim()) return null
  return value.trim().split('/').reverse().join('-')
}

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  if (!cleaned) return null
  return cleaned.startsWith('+') || cleaned.startsWith('-')
    ? Number(cleaned)
    : Number('+' + cleaned)
}

function toNum(value: number | null): string {
  return value === null ? '' : String(value)
}

export function parseCsvText(text: string): CsvParseResult {
  const lines = text.split(/\r\n|\r|\n/)
  const rows: Array<ParsedOperation> = []
  let ignored = 0

  for (const line of lines) {
    if (!line.trim()) continue
    const fields = splitLine(line)
    if (fields.length < 13) {
      ignored += 1
      continue
    }
    if (fields[0]!.trim().startsWith('Date de')) continue // header row
    const dateComptabilisation = parseDate(fields[0]!)
    if (!dateComptabilisation) {
      ignored += 1
      continue
    }
    const debit = parseAmount(fields[8]!)
    const credit = parseAmount(fields[9]!)

    const parsed: ParsedOperation = {
      dateComptabilisation,
      libelleSimplifie: fields[1]!.trim(),
      libelleOperation: fields[2]!.trim(),
      reference: fields[3]!.trim() || null,
      infosComplementaires: fields[4]!.trim() || null,
      typeOperation: fields[5]!.trim() || null,
      categorie: fields[6]!.trim() || null,
      sousCategorie: fields[7]!.trim() || null,
      debit,
      credit,
      montant: (debit ?? 0) + (credit ?? 0),
      dateOperation: parseDate(fields[10]!),
      dateValeur: parseDate(fields[11]!),
      pointage:
        /^\d+$/.test(fields[12]!.trim()) ? Number(fields[12]!.trim()) : null,
    }
    rows.push(parsed)
  }

  return { rows, ignored }
}

const FINGERPRINT_SEP = '\u001f'

/**
 * Fields used to identify an operation on re-import. Category data is
 * excluded: it lives in the normalized category tables and changing an
 * operation's category must not make it look like a new operation.
 */
export type OperationFingerprintSource = Omit<
  ParsedOperation,
  'categorie' | 'sousCategorie'
>

export function fingerprintOperation(
  operation: OperationFingerprintSource,
): string {
  const payload = [
    operation.dateComptabilisation,
    operation.libelleSimplifie,
    operation.libelleOperation,
    operation.reference ?? '',
    operation.infosComplementaires ?? '',
    operation.typeOperation ?? '',
    toNum(operation.debit),
    toNum(operation.credit),
    operation.montant,
    operation.dateOperation ?? '',
    operation.dateValeur ?? '',
    toNum(operation.pointage),
  ].join(FINGERPRINT_SEP)
  return createHash('sha256').update(payload).digest('hex')
}

export function fingerprintFromOperationRow(
  row: OperationFingerprintSource,
): string {
  return fingerprintOperation(row)
}
