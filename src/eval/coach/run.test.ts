import { beforeAll, describe, expect, it } from 'vitest'

import type { KnowledgeEntry } from '#/domain/knowledge/types'
import { loadKnowledgeEntries } from './load'
import { runScenario } from './run'
import { SCENARIOS } from './scenarios'

let entries: KnowledgeEntry[]

beforeAll(() => {
  entries = loadKnowledgeEntries()
})

describe('coach scenarios §8', () => {
  it.each(SCENARIOS)('$id', (scenario) => {
    const result = runScenario(scenario, entries)

    expect(result.failures).toEqual([])
  })
})
