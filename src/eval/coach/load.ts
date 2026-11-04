import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseKnowledgeFiles } from '#/domain/knowledge/parse'
import type { KnowledgeEntry } from '#/domain/knowledge/types'

/**
 * The evaluation is lexical and offline: it reads the Markdown cards only and
 * never the generated `embeddings.json`.
 */
export const KNOWLEDGE_DIR = fileURLToPath(
  new URL('../../content/knowledge/', import.meta.url),
)

export function loadKnowledgeEntries(
  directory = KNOWLEDGE_DIR,
): KnowledgeEntry[] {
  const files: Record<string, string> = {}

  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.md')) continue
    files[file] = readFileSync(join(directory, file), 'utf8')
  }

  return parseKnowledgeFiles(files)
}
