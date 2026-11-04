import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { runPrivacyAudit, type PrivacyAuditResult } from './privacy-audit'

let audit: PrivacyAuditResult
let sourcedAudit: PrivacyAuditResult

beforeAll(async () => {
  audit = await runPrivacyAudit()
  sourcedAudit = await runPrivacyAudit({
    question: 'Comment auditer mes abonnements ?',
  })
})

describe('coach privacy audit', () => {
  it('does not leak bank details into the payload, prompt or journal', () => {
    expect(audit.leaks).toEqual([])
    expect(sourcedAudit.leaks).toEqual([])
  })

  it('keeps only aggregates and category names in the prompt', () => {
    expect(audit.prompt).toContain('"essential": 800')
    expect(audit.prompt).toContain('"monthsAvailable": 1')
    expect(audit.prompt).toContain('Santé')
  })

  it('stores only the documented recommendation contract', () => {
    expect(Object.keys(audit.recommendation).sort()).toEqual(
      [
        'goals',
        'indicators',
        'period',
        'rationale',
        'recommendedMonthlyEffort',
        'schemaVersion',
      ].sort(),
    )
    expect(Object.keys(audit.recommendation.indicators).sort()).toEqual(
      ['dataQuality', 'expenses', 'income', 'savings'].sort(),
    )
    expect(audit.recommendation.goals[0]).toMatchObject({
      label: 'Vacances',
    })
    expect(audit.journal).toEqual(audit.recommendation)
  })

  it('exposes only the citation fields of retrieved sources', () => {
    expect(sourcedAudit.sources.length).toBeGreaterThan(0)
    for (const source of sourcedAudit.sources) {
      expect(Object.keys(source).sort()).toEqual(
        ['id', 'reviewRequired', 'source', 'title'].sort(),
      )
    }
  })

  it('does not log coach payloads or messages in the server path', () => {
    const files = [
      '../../lib/coach.ts',
      '../../application/queries/coach.ts',
      '../../server/goals.ts',
    ]

    for (const file of files) {
      const content = readFileSync(
        fileURLToPath(new URL(file, import.meta.url)),
        'utf8',
      )
      expect(content).not.toMatch(
        /console\.(log|error|warn|info|debug)\s*\(/,
      )
    }
  })
})
