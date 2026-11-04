import type { KnowledgeVectorStore } from '#/domain/knowledge/embedding'
import { parseKnowledgeFiles } from '#/domain/knowledge/parse'
import type { KnowledgeEntry } from '#/domain/knowledge/types'

/**
 * The knowledge cards are bundled as raw Markdown so the corpus works both in
 * the server runtime and in Vitest, without filesystem access.
 */
const files = import.meta.glob('./*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const knowledgeEntries: KnowledgeEntry[] = parseKnowledgeFiles(files)

/**
 * Generated vectors are optional: a checkout without `pnpm knowledge:embed`
 * still works, and retrieval falls back to the lexical engine.
 */
const vectorFiles = import.meta.glob('./embeddings.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const rawVectorStore = Object.values(vectorFiles)[0]

export const knowledgeVectorStore: KnowledgeVectorStore | null = rawVectorStore
  ? (JSON.parse(rawVectorStore) as KnowledgeVectorStore)
  : null
