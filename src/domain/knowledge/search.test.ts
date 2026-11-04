import { describe, expect, it } from 'vitest'

import { knowledgeEntries } from '#/content/knowledge'
import { KNOWLEDGE_EVAL_SET } from './eval-set'
import {
  buildKnowledgeIndex,
  formatKnowledgeContext,
  normalizeText,
  searchKnowledge,
  tokenize,
} from './search'

function recallAt(limit: number): number {
  let hits = 0
  for (const { query, expected } of KNOWLEDGE_EVAL_SET) {
    const results = searchKnowledge(knowledgeEntries, query, { limit })
    if (results.some((match) => match.entry.id === expected)) hits += 1
  }
  return hits / KNOWLEDGE_EVAL_SET.length
}

describe('tokenize', () => {
  it('normalizes accents, case and stopwords', () => {
    expect(normalizeText('Épargne de PRÉCAUTION')).toBe('epargne de precaution')
    expect(tokenize('Comment épargner de l’argent ?')).toEqual([
      'epargner',
      'argent',
    ])
  })
})

describe('buildKnowledgeIndex', () => {
  it('indexes every card', () => {
    const index = buildKnowledgeIndex(knowledgeEntries)
    expect(index.entries).toHaveLength(knowledgeEntries.length)
    expect(index.averageBodyLength).toBeGreaterThan(0)
  })
})

describe('searchKnowledge', () => {
  it('returns nothing for an empty query', () => {
    expect(searchKnowledge(knowledgeEntries, '   ')).toEqual([])
  })

  it('is deterministic', () => {
    const first = searchKnowledge(knowledgeEntries, 'épargne de précaution')
    const second = searchKnowledge(knowledgeEntries, 'épargne de précaution')
    expect(first.map((match) => match.entry.id)).toEqual(
      second.map((match) => match.entry.id),
    )
  })

  it('respects the limit', () => {
    expect(searchKnowledge(knowledgeEntries, 'budget', { limit: 2 })).toHaveLength(2)
  })

  it('filters by category', () => {
    const results = searchKnowledge(knowledgeEntries, 'épargne', {
      categories: ['savings'],
      limit: 10,
    })
    expect(results.length).toBeGreaterThan(0)
    for (const match of results) {
      expect(match.entry.category).toBe('savings')
    }
  })

  it('meets the lexical recall@3 gate on the evaluation set', () => {
    expect(recallAt(3)).toBeGreaterThanOrEqual(0.9)
  })

  it('meets the lexical recall@5 gate on the evaluation set', () => {
    expect(recallAt(5)).toBeGreaterThanOrEqual(0.95)
  })

  it('keeps a stable lexical recall@1 floor', () => {
    expect(recallAt(1)).toBeGreaterThanOrEqual(0.7)
  })
})

describe('formatKnowledgeContext', () => {
  it('includes the title, the source and the limits', () => {
    const [match] = searchKnowledge(knowledgeEntries, 'règle 50/30/20', {
      limit: 1,
    })
    const context = formatKnowledgeContext([match])
    expect(context).toContain(match.entry.title)
    expect(context).toContain(match.entry.source)
    expect(context).toContain('Limites :')
    expect(context).toContain(match.entry.limitations[0])
  })

  it('returns an empty string without matches', () => {
    expect(formatKnowledgeContext([])).toBe('')
  })
})
