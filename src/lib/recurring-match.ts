export type MatchMode = 'exact' | 'contains' | 'regex'

export const MATCH_MODES = ['exact', 'contains', 'regex'] as const

export const MATCH_MODE_LABELS: Record<MatchMode, string> = {
  exact: 'Exacte',
  contains: 'Contient',
  regex: 'Expression régulière',
}

export function isMatchMode(value: unknown): value is MatchMode {
  return value === 'exact' || value === 'contains' || value === 'regex'
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matcherSource(
  mode: MatchMode,
  pattern: string | null | undefined,
  label: string,
): string {
  if (mode === 'exact') return `^${escapeRegExp(label)}$`

  const trimmed = pattern?.trim()

  if (mode === 'contains') return escapeRegExp(trimmed || label)

  return pattern && trimmed ? pattern : escapeRegExp(label)
}

export function compileMatcher(
  mode: MatchMode,
  pattern: string | null | undefined,
  label: string,
): RegExp {
  return new RegExp(matcherSource(mode, pattern, label), 'iu')
}

export function tryCompileMatcher(
  mode: MatchMode,
  pattern: string | null | undefined,
  label: string,
): RegExp | null {
  try {
    return compileMatcher(mode, pattern, label)
  } catch {
    return null
  }
}

export function matchesLabel(
  mode: MatchMode,
  pattern: string | null | undefined,
  label: string,
  candidate: string,
): boolean {
  return tryCompileMatcher(mode, pattern, label)?.test(candidate) ?? false
}
