import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { knowledgeEntries } from '#/content/knowledge'
import {
  contentHash,
  cosineSimilarity,
  embeddingSearch,
  embeddingText,
  hybridSearch,
  reciprocalRankFusion,
  type KnowledgeVectorStore,
} from './embedding'
import { searchKnowledge } from './search'
import type { KnowledgeEntry, KnowledgeMatch } from './types'

const KNOWLEDGE_DIR = fileURLToPath(new URL('../../content/knowledge/', import.meta.url))
const STORE_PATH = join(KNOWLEDGE_DIR, 'embeddings.json')

function entry(id: string, title: string, body = 'corps de la fiche'): KnowledgeEntry {
  return {
    id,
    title,
    category: 'budget_management',
    source: 'Test',
    sourceUrl: null,
    consultedAt: '2026-10-29',
    updatedAt: null,
    reviewRequired: false,
    tags: ['test'],
    limitations: ['une limite'],
    body,
  }
}

function match(value: KnowledgeEntry): KnowledgeMatch {
  return { entry: value, score: 1, matchedTerms: [] }
}

describe('contentHash', () => {
  it('is stable and changes with the content', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'))
    expect(contentHash('abc')).not.toBe(contentHash('abd'))
  })
})

describe('embeddingText', () => {
  it('includes the title, the tags and the body', () => {
    const text = embeddingText(entry('a', 'Titre'))
    expect(text).toContain('Titre')
    expect(text).toContain('test')
    expect(text).toContain('corps de la fiche')
  })
})

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns 0 on a dimension mismatch', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('returns 0 for a zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('embeddingSearch', () => {
  const store: KnowledgeVectorStore = {
    model: 'test',
    dimension: 2,
    generatedAt: '2026-10-29T00:00:00.000Z',
    entries: {
      a: { hash: 'a', vector: [1, 0] },
      b: { hash: 'b', vector: [0.9, 0.1] },
      c: { hash: 'c', vector: [0, 1] },
    },
  }
  const entries = [entry('a', 'A'), entry('b', 'B'), entry('c', 'C')]

  it('ranks by cosine similarity and drops unrelated cards', () => {
    const results = embeddingSearch(entries, store, [1, 0], { limit: 3 })
    expect(results.map((result) => result.entry.id)).toEqual(['a', 'b'])
  })

  it('skips cards without a vector', () => {
    const results = embeddingSearch(entries, store, [1, 0], { limit: 3 })
    expect(results).toHaveLength(2)
    const partial = embeddingSearch(
      entries,
      { ...store, entries: { a: store.entries.a } },
      [1, 0],
    )
    expect(partial.map((result) => result.entry.id)).toEqual(['a'])
  })

  it('respects the category filter', () => {
    const results = embeddingSearch(entries, store, [1, 0], {
      limit: 3,
      categories: ['savings'],
    })
    expect(results).toEqual([])
  })
})

describe('reciprocalRankFusion', () => {
  it('merges rankings and rewards cards present in both', () => {
    const a = entry('a', 'A')
    const b = entry('b', 'B')
    const c = entry('c', 'C')

    const fused = reciprocalRankFusion([
      [match(a), match(b)],
      [match(b), match(c)],
    ])

    expect(fused[0].entry.id).toBe('b')
    expect(fused.map((item) => item.entry.id)).toEqual(['b', 'a', 'c'])
  })

  it('is deterministic on ties', () => {
    const a = entry('a', 'A')
    const b = entry('b', 'B')
    const fused = reciprocalRankFusion([[match(a)], [match(b)]])
    expect(fused.map((item) => item.entry.id)).toEqual(['a', 'b'])
  })
})

describe('hybridSearch', () => {
  it('combines lexical and semantic results', () => {
    const store: KnowledgeVectorStore = {
      model: 'test',
      dimension: 2,
      generatedAt: '2026-10-29T00:00:00.000Z',
      entries: {
        budget_50_30_20: { hash: 'x', vector: [1, 0] },
        epargne_livret_a_ldds: { hash: 'y', vector: [0, 1] },
      },
    }

    const results = hybridSearch({
      entries: knowledgeEntries,
      query: 'règle 50/30/20',
      store,
      queryVector: [1, 0],
      limit: 2,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.some((result) => result.entry.id === 'budget_50_30_20')).toBe(true)
  })
})

describe.skipIf(!existsSync(STORE_PATH))('the generated vector store', () => {
  const store = JSON.parse(
    readFileSync(STORE_PATH, 'utf8'),
  ) as KnowledgeVectorStore

  it('covers every card with a matching hash', () => {
    for (const card of knowledgeEntries) {
      const stored = store.entries[card.id]
      expect(stored, `missing vector for ${card.id}`).toBeDefined()
      expect(stored.hash).toBe(contentHash(embeddingText(card)))
      expect(stored.vector).toHaveLength(store.dimension)
    }
  })

  it('has no orphan vectors', () => {
    const ids = new Set(knowledgeEntries.map((card) => card.id))
    for (const id of Object.keys(store.entries)) {
      expect(ids.has(id), `orphan vector for ${id}`).toBe(true)
    }
  })

  it('keeps the lexical baseline available', () => {
    expect(searchKnowledge(knowledgeEntries, 'épargne')).not.toHaveLength(0)
  })
})
