import {
  KNOWLEDGE_CATEGORIES,
  type KnowledgeCategory,
  type KnowledgeEntry,
} from './types'

const REQUIRED_KEYS = ['id', 'title', 'category', 'source', 'consultedAt'] as const

type FrontMatterValue = string | boolean | string[] | null

export class KnowledgeParseError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`)
    this.name = 'KnowledgeParseError'
  }
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function parseScalar(raw: string): FrontMatterValue {
  const value = stripQuotes(raw.trim())
  if (value === '' || value === 'null' || value === '~') return null
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

/**
 * Parses the deliberately small front-matter subset used by the knowledge
 * cards: `key: scalar`, `key: a, b` (comma list) and `key:` followed by
 * `- item` lines. Anything else is rejected instead of being silently ignored.
 */
export function parseFrontMatter(
  raw: string,
  file = '<inline>',
): { data: Record<string, FrontMatterValue>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    throw new KnowledgeParseError(file, 'missing front-matter (---)')
  }

  const end = normalized.indexOf('\n---', 3)
  if (end === -1) {
    throw new KnowledgeParseError(file, 'unterminated front-matter')
  }

  const header = normalized.slice(4, end)
  const body = normalized.slice(end + 4).replace(/^\n+/, '')

  const data: Record<string, FrontMatterValue> = {}
  let listKey: string | null = null

  for (const line of header.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('- ')) {
      if (!listKey) {
        throw new KnowledgeParseError(file, `list item without a key: ${trimmed}`)
      }
      const current = data[listKey]
      const item = stripQuotes(trimmed.slice(2).trim())
      if (Array.isArray(current)) current.push(item)
      else data[listKey] = [item]
      continue
    }

    const separator = trimmed.indexOf(':')
    if (separator <= 0) {
      throw new KnowledgeParseError(file, `invalid front-matter line: ${trimmed}`)
    }

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()

    if (key in data) {
      throw new KnowledgeParseError(file, `duplicate key: ${key}`)
    }

    if (value === '') {
      listKey = key
      data[key] = []
      continue
    }

    listKey = null
    if (key === 'tags') {
      data[key] = stripQuotes(value)
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    } else {
      data[key] = parseScalar(value)
    }
  }

  return { data, body: body.trim() }
}

function requireString(
  data: Record<string, FrontMatterValue>,
  key: string,
  file: string,
): string {
  const value = data[key]
  if (typeof value !== 'string' || !value) {
    throw new KnowledgeParseError(file, `missing or invalid "${key}"`)
  }
  return value
}

function optionalString(
  data: Record<string, FrontMatterValue>,
  key: string,
  file: string,
): string | null {
  const value = data[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new KnowledgeParseError(file, `invalid "${key}"`)
  }
  return value
}

function requireStringList(
  data: Record<string, FrontMatterValue>,
  key: string,
  file: string,
): string[] {
  const value = data[key]
  if (!Array.isArray(value) || value.length === 0) {
    throw new KnowledgeParseError(file, `missing or empty "${key}"`)
  }
  return value
}

function parseCategory(
  data: Record<string, FrontMatterValue>,
  file: string,
): KnowledgeCategory {
  const value = requireString(data, 'category', file)
  if (!KNOWLEDGE_CATEGORIES.includes(value as KnowledgeCategory)) {
    throw new KnowledgeParseError(file, `unknown category: ${value}`)
  }
  return value as KnowledgeCategory
}

/**
 * Parses one knowledge card. Cards must carry their limits: a recommendation
 * without limits is the main failure mode of a financial coach.
 */
export function parseKnowledgeFile(raw: string, file = '<inline>'): KnowledgeEntry {
  const { data, body } = parseFrontMatter(raw, file)

  for (const key of REQUIRED_KEYS) {
    requireString(data, key, file)
  }

  if (!body) {
    throw new KnowledgeParseError(file, 'empty body')
  }

  const id = requireString(data, 'id', file)
  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new KnowledgeParseError(file, `invalid id: ${id}`)
  }

  return {
    id,
    title: requireString(data, 'title', file),
    category: parseCategory(data, file),
    source: requireString(data, 'source', file),
    sourceUrl: optionalString(data, 'sourceUrl', file),
    consultedAt: requireString(data, 'consultedAt', file),
    updatedAt: optionalString(data, 'updatedAt', file),
    reviewRequired: data.reviewRequired === true,
    tags: requireStringList(data, 'tags', file),
    limitations: requireStringList(data, 'limitations', file),
    body,
  }
}

/**
 * Parses a set of cards and rejects duplicate ids.
 */
export function parseKnowledgeFiles(
  files: Record<string, string>,
): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = []
  const seen = new Map<string, string>()

  for (const [file, raw] of Object.entries(files)) {
    const entry = parseKnowledgeFile(raw, file)
    const previous = seen.get(entry.id)
    if (previous) {
      throw new KnowledgeParseError(
        file,
        `duplicate id "${entry.id}" (also in ${previous})`,
      )
    }
    seen.set(entry.id, file)
    entries.push(entry)
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id))
}
