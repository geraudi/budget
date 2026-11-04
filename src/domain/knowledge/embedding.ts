import { searchKnowledge, type SearchOptions } from './search'
import type { KnowledgeEntry, KnowledgeMatch } from './types'

export type Vector = number[]

export type KnowledgeVectorStore = {
  model: string
  dimension: number
  generatedAt: string
  entries: Record<string, { hash: string; vector: Vector }>
}

/**
 * Stable content hash used to detect a card that changed since its vector was
 * computed. FNV-1a is enough here: we only need change detection, not
 * cryptographic resistance.
 */
export function contentHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** The text that gets embedded for a card. */
export function embeddingText(entry: KnowledgeEntry): string {
  return [entry.title, entry.tags.join(', '), entry.body].join('\n\n')
}

export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    const valueA = a[index]
    const valueB = b[index]
    dot += valueA * valueB
    normA += valueA * valueA
    normB += valueB * valueB
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Ranks the cards by cosine similarity between the query vector and the stored
 * card vectors. Cards without a vector are ignored.
 */
export function embeddingSearch(
  entries: KnowledgeEntry[],
  store: KnowledgeVectorStore,
  queryVector: Vector,
  options: SearchOptions = {},
): KnowledgeMatch[] {
  const limit = options.limit ?? 4
  const candidates = options.categories
    ? entries.filter((entry) => options.categories!.includes(entry.category))
    : entries

  const matches: KnowledgeMatch[] = []

  for (const entry of candidates) {
    const stored = store.entries[entry.id]
    if (!stored) continue

    const score = cosineSimilarity(queryVector, stored.vector)
    if (score <= 0) continue

    matches.push({ entry, score, matchedTerms: [] })
  }

  return matches
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit)
}

/**
 * Reciprocal Rank Fusion merges rankings without having to normalize scores
 * that live on different scales (BM25 vs cosine). Standard k = 60.
 */
export function reciprocalRankFusion(
  rankings: KnowledgeMatch[][],
  k = 60,
): KnowledgeMatch[] {
  const fused = new Map<string, { match: KnowledgeMatch; score: number }>()

  for (const ranking of rankings) {
    ranking.forEach((match, index) => {
      const contribution = 1 / (k + index + 1)
      const current = fused.get(match.entry.id)
      if (current) current.score += contribution
      else fused.set(match.entry.id, { match, score: contribution })
    })
  }

  return [...fused.values()]
    .map(({ match, score }) => ({ ...match, score }))
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
}

export type HybridSearchInput = {
  entries: KnowledgeEntry[]
  query: string
  store: KnowledgeVectorStore
  queryVector: Vector
  limit?: number
  /** Candidates kept from each ranking before fusion. */
  candidateLimit?: number
}

/**
 * Hybrid retrieval: lexical BM25 and vector search are run independently, then
 * fused with RRF. Neither score scale has to be tuned.
 */
export function hybridSearch({
  entries,
  query,
  store,
  queryVector,
  limit = 4,
  candidateLimit = 10,
}: HybridSearchInput): KnowledgeMatch[] {
  const lexical = searchKnowledge(entries, query, { limit: candidateLimit })
  const semantic = embeddingSearch(entries, store, queryVector, {
    limit: candidateLimit,
  })

  return reciprocalRankFusion([lexical, semantic]).slice(0, limit)
}
