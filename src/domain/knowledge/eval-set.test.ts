import { describe, expect, it } from 'vitest'

import { knowledgeEntries } from '#/content/knowledge'
import { KNOWLEDGE_EVAL_SET } from './eval-set'
import { normalizeText } from './search'

/**
 * Guard for the retrieval evaluation set itself: a wrong `expected`, a
 * duplicated question or a card with no question would silently distort every
 * recall measurement.
 */
describe('KNOWLEDGE_EVAL_SET', () => {
  it('contains exactly 50 cases', () => {
    expect(KNOWLEDGE_EVAL_SET).toHaveLength(50)
  })

  it('uses unique, non-empty queries', () => {
    const queries = KNOWLEDGE_EVAL_SET.map(({ query }) => query)

    for (const query of queries) {
      expect(query.trim().length).toBeGreaterThan(0)
    }

    const normalized = queries.map((query) => normalizeText(query.trim()))
    expect(new Set(normalized).size).toBe(queries.length)
  })

  it('targets an id that exists in the parsed corpus', () => {
    const ids = new Set(knowledgeEntries.map((entry) => entry.id))

    for (const { query, expected } of KNOWLEDGE_EVAL_SET) {
      expect(ids.has(expected), `unknown expected id "${expected}" for "${query}"`).toBe(true)
    }
  })

  it('covers every card with at least one question', () => {
    const covered = new Set(KNOWLEDGE_EVAL_SET.map(({ expected }) => expected))

    for (const entry of knowledgeEntries) {
      expect(covered.has(entry.id), `no question for "${entry.id}"`).toBe(true)
    }
  })

  it('never reuses a card title as the query', () => {
    const titles = new Set(
      knowledgeEntries.map((entry) => normalizeText(entry.title)),
    )

    for (const { query } of KNOWLEDGE_EVAL_SET) {
      expect(titles.has(normalizeText(query.trim()))).toBe(false)
    }
  })
})
