/**
 * CSV export for the operations table. Reuses the bank statement format
 * accepted by `parseCsvText` (`;`-separated, ISO-8859-1, `dd/mm/yyyy`
 * dates, separate debit/credit columns) so an exported file can be
 * re-imported without changes.
 *
 * Kept free of Node-only imports: this module runs in the browser.
 */

export const CSV_HEADER = [
  'Date de comptabilisation',
  'Libelle simplifie',
  'Libelle operation',
  'Reference',
  'Informations complementaires',
  'Type operation',
  'Categorie',
  'Sous categorie',
  'Debit',
  'Credit',
  'Date operation',
  'Date de valeur',
  'Pointage operation',
]

/** The operation fields written to the CSV, `montant` being recomputed on import. */
export type CsvExportOperation = {
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
  dateOperation: string | null
  dateValeur: string | null
  pointage: number | null
}

/** `yyyy-mm-dd` (database) → `dd/mm/yyyy` (CSV), the reverse of `parseDate`. */
function formatDate(value: string | null): string {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.split('-').reverse().join('/')
  }
  return value
}

function formatAmount(value: number | null): string {
  return value === null ? '' : String(value)
}

function escapeField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function serializeOperationsCsv(
  rows: ReadonlyArray<CsvExportOperation>,
): string {
  const lines = [CSV_HEADER.join(';')]
  for (const row of rows) {
    lines.push(
      [
        formatDate(row.dateComptabilisation),
        row.libelleSimplifie,
        row.libelleOperation,
        row.reference ?? '',
        row.infosComplementaires ?? '',
        row.typeOperation ?? '',
        row.categorie ?? '',
        row.sousCategorie ?? '',
        formatAmount(row.debit),
        formatAmount(row.credit),
        formatDate(row.dateOperation),
        formatDate(row.dateValeur),
        row.pointage === null ? '' : String(row.pointage),
      ]
        .map(escapeField)
        .join(';'),
    )
  }
  return lines.join('\r\n')
}

/**
 * ISO-8859-1 bytes, matching the encoding the import decodes. Characters
 * outside the charset are replaced by `?` rather than corrupting the file.
 */
export function encodeLatin1(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    bytes[index] = code <= 0xff ? code : 0x3f
  }
  return bytes
}
