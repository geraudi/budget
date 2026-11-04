import { knowledgeEntries, knowledgeVectorStore } from '#/content/knowledge'
import { hybridSearch, type Vector } from '#/domain/knowledge/embedding'
import { searchKnowledge, type SearchOptions } from '#/domain/knowledge/search'
import {
  DEFAULT_KNOWLEDGE_RETRIEVAL,
  type KnowledgeMatch,
} from '#/domain/knowledge/types'

/**
 * Default retrieval for the application.
 *
 * The evaluation set (`pnpm knowledge:eval --compare`) shows hybrid retrieval
 * ahead of lexical on recall@1, recall@3 and MRR. It is therefore the default
 * when generated vectors are available. Without `embeddings.json`, or when the
 * local embedding server is unreachable, the same call falls back to lexical
 * so the coach and the documentary Q&A keep working.
 */
export const DEFAULT_RETRIEVAL_STRATEGY = DEFAULT_KNOWLEDGE_RETRIEVAL

const HOST = (process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/$/, '')

export type KnowledgeRetriever = (
  query: string,
  options?: SearchOptions,
) => Promise<KnowledgeMatch[]>

async function embedQuery(text: string, model: string): Promise<Vector> {
  const response = await fetch(`${HOST}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: text }),
  })

  if (!response.ok) {
    throw new Error(`Ollama embedding failed (${response.status})`)
  }

  const payload = (await response.json()) as { embeddings?: number[][] }
  const vector = payload.embeddings?.[0]
  if (!vector || vector.length === 0) {
    throw new Error('Ollama returned an empty embedding')
  }
  return vector
}

export const retrieveKnowledge: KnowledgeRetriever = async (
  query,
  options = {},
) => {
  const limit = options.limit ?? 4
  const entries = options.categories
    ? knowledgeEntries.filter((entry) => options.categories!.includes(entry.category))
    : knowledgeEntries

  if (!knowledgeVectorStore) {
    return searchKnowledge(entries, query, { ...options, limit })
  }

  try {
    const queryVector = await embedQuery(query, knowledgeVectorStore.model)
    return hybridSearch({
      entries,
      query,
      store: knowledgeVectorStore,
      queryVector,
      limit,
    })
  } catch {
    // Retrieval must never take the chat down: degrade to the deterministic
    // lexical engine, which has no network dependency.
    return searchKnowledge(entries, query, { ...options, limit })
  }
}

/**
 * Lexical-only retriever for offline tests and the deterministic coach
 * evaluation. It never calls Ollama.
 */
export function createLexicalRetriever(
  entries = knowledgeEntries,
): KnowledgeRetriever {
  return async (query, options = {}) => searchKnowledge(entries, query, options)
}
