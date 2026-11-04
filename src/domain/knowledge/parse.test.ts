import { describe, expect, it } from 'vitest'

import { knowledgeEntries } from '#/content/knowledge'
import {
  KnowledgeParseError,
  parseFrontMatter,
  parseKnowledgeFile,
  parseKnowledgeFiles,
} from './parse'

const VALID = `---
id: budget_test
title: Une fiche de test
category: budget_management
source: Une source
sourceUrl: https://example.com
consultedAt: 2026-10-29
updatedAt: null
reviewRequired: true
tags: budget, test
limitations:
- Première limite
- Deuxième limite
---

## Principe

Un contenu.
`

describe('parseFrontMatter', () => {
  it('reads scalars, comma lists and dash lists', () => {
    const { data, body } = parseFrontMatter(VALID)
    expect(data.id).toBe('budget_test')
    expect(data.updatedAt).toBeNull()
    expect(data.reviewRequired).toBe(true)
    expect(data.tags).toEqual(['budget', 'test'])
    expect(data.limitations).toEqual(['Première limite', 'Deuxième limite'])
    expect(body).toContain('## Principe')
  })

  it('rejects a file without front-matter', () => {
    expect(() => parseFrontMatter('# Titre')).toThrow(KnowledgeParseError)
  })

  it('rejects an unterminated front-matter', () => {
    expect(() => parseFrontMatter('---\nid: x\n')).toThrow(
      /unterminated front-matter/,
    )
  })
})

describe('parseKnowledgeFile', () => {
  it('parses a valid card', () => {
    const entry = parseKnowledgeFile(VALID, 'test.md')
    expect(entry.id).toBe('budget_test')
    expect(entry.category).toBe('budget_management')
    expect(entry.sourceUrl).toBe('https://example.com')
    expect(entry.reviewRequired).toBe(true)
    expect(entry.limitations).toHaveLength(2)
  })

  it('requires at least one limitation', () => {
    const withoutLimits = VALID.replace(
      /limitations:\n- Première limite\n- Deuxième limite\n/,
      '',
    )
    expect(() => parseKnowledgeFile(withoutLimits, 'test.md')).toThrow(
      /limitations/,
    )
  })

  it('rejects an unknown category', () => {
    const invalid = VALID.replace('budget_management', 'astrologie')
    expect(() => parseKnowledgeFile(invalid, 'test.md')).toThrow(
      /unknown category/,
    )
  })

  it('rejects an empty body', () => {
    const empty = VALID.slice(0, VALID.indexOf('## Principe'))
    expect(() => parseKnowledgeFile(empty, 'test.md')).toThrow(/empty body/)
  })
})

describe('parseKnowledgeFiles', () => {
  it('rejects duplicate ids', () => {
    expect(() =>
      parseKnowledgeFiles({ 'a.md': VALID, 'b.md': VALID }),
    ).toThrow(/duplicate id/)
  })
})

describe('the bundled corpus', () => {
  it('contains 20 valid cards with unique ids', () => {
    expect(knowledgeEntries).toHaveLength(20)
    const ids = knowledgeEntries.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(20)
  })

  it('gives every card a source, a date and its limits', () => {
    for (const entry of knowledgeEntries) {
      expect(entry.source).not.toHaveLength(0)
      expect(entry.consultedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.limitations.length).toBeGreaterThan(0)
      expect(entry.tags.length).toBeGreaterThan(0)
      expect(entry.body.length).toBeGreaterThan(100)
    }
  })

  it('flags time-sensitive cards for review', () => {
    const livret = knowledgeEntries.find(
      (entry) => entry.id === 'epargne_livret_a_ldds',
    )
    expect(livret?.reviewRequired).toBe(true)
  })
})
