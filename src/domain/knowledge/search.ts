import type { KnowledgeEntry, KnowledgeMatch } from './types'

/**
 * Lexical retrieval is the deterministic baseline: with ~20 short cards, a
 * well tuned BM25 over title/tags/body is strong, fast and dependency-free. It
 * stays the offline fallback; the application default (hybrid) is selected in
 * `src/infrastructure/knowledge/retrieval.ts` and measured with
 * `pnpm knowledge:eval --compare`.
 */

const STOPWORDS = new Set([
  'a', 'ai', 'as', 'au', 'aux', 'avec', 'ce', 'ces', 'cet', 'cette', 'dans',
  'de', 'des', 'du', 'elle', 'en', 'est', 'et', 'eu', 'fait', 'faire', 'il',
  'ils', 'je', 'la', 'le', 'les', 'leur', 'lui', 'ma', 'mais', 'me', 'mes',
  'moi', 'mon', 'ne', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'pas', 'pour',
  'qu', 'que', 'quel', 'quelle', 'qui', 'sa', 'se', 'ses', 'si', 'son', 'sont',
  'sur', 'ta', 'te', 'tes', 'toi', 'ton', 'tu', 'un', 'une', 'vos', 'votre',
  'vous', 'y', 'plus', 'moins', 'tres', 'trop', 'peu', 'comment', 'combien',
  'pourquoi', 'quand', 'quoi', 'dois', 'doit', 'peux', 'peut', 'faut',
])

/** Light French stemming: a 5-character prefix groups épargne/épargner, etc. */
const STEM_LENGTH = 5

const SYNONYMS: Record<string, string[]> = {
  matelas: ['precaution'],
  imprevu: ['precaution'],
  imprevus: ['precaution'],
  economie: ['epargne'],
  economies: ['epargne'],
  economiser: ['epargne'],
  epargner: ['epargne'],
  loyer: ['logement'],
  courses: ['alimentation'],
  salaire: ['revenu'],
  rembourser: ['remboursement'],
  surendettement: ['dette'],
  taeg: ['credit'],
  virer: ['virement'],
  acheter: ['achat'],
  aider: ['aide'],
  abonnement: ['abonnements'],
  budgetaire: ['budget'],
}

const FIELD_WEIGHTS = {
  title: 3,
  tags: 2.5,
  id: 2,
  body: 1,
} as const

type Field = keyof typeof FIELD_WEIGHTS

const BM25_K1 = 1.2
const BM25_B = 0.75

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
}

function stem(token: string): string | null {
  return token.length > STEM_LENGTH ? token.slice(0, STEM_LENGTH) : null
}

/** Expands a token into itself plus its stem, so both forms are indexed. */
function expand(token: string): string[] {
  const prefix = stem(token)
  return prefix ? [token, prefix] : [token]
}

type FieldIndex = Map<string, number>

type IndexedEntry = {
  entry: KnowledgeEntry
  fields: Record<Field, FieldIndex>
  bodyLength: number
}

export type KnowledgeIndex = {
  entries: IndexedEntry[]
  documentFrequency: Map<string, number>
  averageBodyLength: number
}

function indexField(text: string): { index: FieldIndex; length: number } {
  const tokens = tokenize(text)
  const index: FieldIndex = new Map()
  for (const token of tokens) {
    for (const term of expand(token)) {
      index.set(term, (index.get(term) ?? 0) + 1)
    }
  }
  return { index, length: tokens.length }
}

export function buildKnowledgeIndex(entries: KnowledgeEntry[]): KnowledgeIndex {
  const indexed: IndexedEntry[] = entries.map((entry) => {
    const title = indexField(entry.title)
    const tags = indexField(entry.tags.join(' '))
    const id = indexField(entry.id.replace(/_/g, ' '))
    const body = indexField(entry.body)

    return {
      entry,
      fields: {
        title: title.index,
        tags: tags.index,
        id: id.index,
        body: body.index,
      },
      bodyLength: body.length,
    }
  })

  const documentFrequency = new Map<string, number>()
  for (const doc of indexed) {
    const terms = new Set<string>()
    for (const index of Object.values(doc.fields)) {
      for (const term of index.keys()) terms.add(term)
    }
    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }

  const totalLength = indexed.reduce((sum, doc) => sum + doc.bodyLength, 0)

  return {
    entries: indexed,
    documentFrequency,
    averageBodyLength: indexed.length > 0 ? totalLength / indexed.length : 0,
  }
}

function idf(index: KnowledgeIndex, term: string): number {
  const df = index.documentFrequency.get(term) ?? 0
  if (df === 0) return 0
  return Math.log(1 + index.entries.length / df)
}

function saturated(tf: number): number {
  return tf / (tf + 1.5)
}

function bm25Body(
  index: KnowledgeIndex,
  doc: IndexedEntry,
  term: string,
): number {
  const tf = doc.fields.body.get(term) ?? 0
  if (tf === 0) return 0
  const lengthNorm = index.averageBodyLength > 0
    ? doc.bodyLength / index.averageBodyLength
    : 1
  return (tf * (BM25_K1 + 1)) /
    (tf + BM25_K1 * (1 - BM25_B + BM25_B * lengthNorm))
}

export type SearchOptions = {
  limit?: number
  /** Restrict the search to a subset of categories. */
  categories?: KnowledgeEntry['category'][]
}

/**
 * Returns the cards that best match the query, most relevant first.
 * Ties are broken by id so the result is fully deterministic.
 */
export function searchKnowledge(
  entries: KnowledgeEntry[],
  query: string,
  options: SearchOptions = {},
): KnowledgeMatch[] {
  const limit = options.limit ?? 4
  const candidates = options.categories
    ? entries.filter((entry) => options.categories!.includes(entry.category))
    : entries

  const index = buildKnowledgeIndex(candidates)
  const tokens = tokenize(query)
  if (tokens.length === 0) return []

  const originalTerms = [...new Set(tokens)]
  const expandedTerms = new Map<string, number>()
  for (const token of originalTerms) {
    for (const term of expand(token)) {
      expandedTerms.set(term, Math.max(expandedTerms.get(term) ?? 0, 1))
    }
    for (const synonym of SYNONYMS[token] ?? []) {
      for (const term of expand(synonym)) {
        expandedTerms.set(term, Math.max(expandedTerms.get(term) ?? 0, 0.6))
      }
    }
  }

  const phrase = originalTerms.join(' ')

  const matches: KnowledgeMatch[] = []

  for (const doc of index.entries) {
    let score = 0
    const matched = new Set<string>()

    for (const [term, weight] of expandedTerms) {
      const termIdf = idf(index, term)
      if (termIdf === 0) continue

      const titleTf = doc.fields.title.get(term) ?? 0
      const tagsTf = doc.fields.tags.get(term) ?? 0
      const idTf = doc.fields.id.get(term) ?? 0
      const bodyScore = bm25Body(index, doc, term)

      const fieldScore =
        FIELD_WEIGHTS.title * saturated(titleTf) +
        FIELD_WEIGHTS.tags * saturated(tagsTf) +
        FIELD_WEIGHTS.id * saturated(idTf) +
        FIELD_WEIGHTS.body * bodyScore

      if (fieldScore === 0) continue

      score += weight * termIdf * fieldScore

      for (const token of originalTerms) {
        if (expand(token).includes(term)) matched.add(token)
      }
    }

    if (score === 0) continue

    const coverage = matched.size / originalTerms.length
    score *= 0.4 + 0.6 * coverage

    const normalizedTitle = normalizeText(doc.entry.title)
    if (phrase && normalizedTitle.includes(phrase)) score += 4

    const normalizedTags = normalizeText(doc.entry.tags.join(' '))
    if (phrase && normalizedTags.includes(phrase)) score += 2

    matches.push({
      entry: doc.entry,
      score,
      matchedTerms: [...matched],
    })
  }

  return matches
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit)
}

/**
 * Formats the retrieved cards as a compact prompt block. Only what the model
 * needs: principle, key points, limits and the source.
 */
export function formatKnowledgeContext(matches: KnowledgeMatch[]): string {
  if (matches.length === 0) return ''

  return matches
    .map((match) => {
      const { entry } = match
      const source = entry.sourceUrl
        ? `${entry.source} (${entry.sourceUrl})`
        : entry.source
      return [
        `### ${entry.title}`,
        `Source : ${source}`,
        `Consultée le : ${entry.consultedAt}`,
        ...(entry.reviewRequired
          ? ['Statut : à vérifier, l’information peut avoir évolué']
          : []),
        '',
        entry.body,
        '',
        'Limites :',
        ...entry.limitations.map((limit) => `- ${limit}`),
      ].join('\n')
    })
    .join('\n\n---\n\n')
}
