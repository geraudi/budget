import { describe, expect, it } from 'vitest'

import { detectTransferPairs } from './transfers'

function operation(id: number, date: string, montant: number) {
  return { id, date, montant }
}

describe('detectTransferPairs', () => {
  it('pairs opposite amounts within three days', () => {
    const pairs = detectTransferPairs([
      operation(1, '2026-01-10', -250),
      operation(2, '2026-01-12', 250),
    ])

    expect(pairs).toEqual([
      { creditId: 2, debitId: 1, amount: 250, days: 2 },
    ])
  })

  it('ignores pairs further apart than the window', () => {
    expect(
      detectTransferPairs([
        operation(1, '2026-01-10', -250),
        operation(2, '2026-01-20', 250),
      ]),
    ).toEqual([])
  })

  it('pairs on the closest date first', () => {
    const pairs = detectTransferPairs([
      operation(1, '2026-01-10', -100),
      operation(2, '2026-01-20', 100),
      operation(3, '2026-01-11', 100),
    ])

    expect(pairs).toEqual([
      { creditId: 3, debitId: 1, amount: 100, days: 1 },
    ])
  })

  it('uses each operation at most once', () => {
    const pairs = detectTransferPairs([
      operation(1, '2026-01-10', -100),
      operation(2, '2026-01-10', 100),
      operation(3, '2026-01-11', 100),
    ])

    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.debitId).toBe(1)
  })

  it('requires opposite signs and a matching amount', () => {
    expect(
      detectTransferPairs([
        operation(1, '2026-01-10', 100),
        operation(2, '2026-01-11', 100),
        operation(3, '2026-01-11', 50),
      ]),
    ).toEqual([])
  })

  it('tolerates a one-cent rounding difference', () => {
    expect(
      detectTransferPairs([
        operation(1, '2026-01-10', -100),
        operation(2, '2026-01-11', 100.01),
      ]),
    ).toHaveLength(1)
  })

  it('ignores zero amounts', () => {
    expect(
      detectTransferPairs([
        operation(1, '2026-01-10', 0),
        operation(2, '2026-01-10', 0),
      ]),
    ).toEqual([])
  })
})
