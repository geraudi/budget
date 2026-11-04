import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  contentHash,
  embeddingText,
  type KnowledgeVectorStore,
} from '#/domain/knowledge/embedding'
import { parseKnowledgeFiles } from '#/domain/knowledge/parse'

/**
 * Computes the embedding of every knowledge card and stores them in
 * `src/content/knowledge/embeddings.json`.
 *
 *   pnpm knowledge:embed          # only re-embeds changed cards
 *   pnpm knowledge:embed --force  # re-embeds everything
 *
 * Requires a local Ollama with the embedding model pulled:
 *   ollama pull bge-m3
 */

const KNOWLEDGE_DIR = fileURLToPath(new URL('../src/content/knowledge/', import.meta.url))
const STORE_PATH = join(KNOWLEDGE_DIR, 'embeddings.json')
const MODEL = process.env.EMBEDDING_MODEL ?? 'bge-m3'
const HOST = (process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/$/, '')
const FORCE = process.argv.includes('--force')

type OllamaEmbedResponse = {
  embeddings: number[][]
}

async function embed(inputs: string[]): Promise<number[][]> {
  const response = await fetch(`${HOST}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  })

  if (!response.ok) {
    throw new Error(
      `Ollama embedding failed (${response.status}): ${await response.text()}`,
    )
  }

  const payload = (await response.json()) as OllamaEmbedResponse
  if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== inputs.length) {
    throw new Error('Ollama returned an unexpected number of embeddings')
  }
  return payload.embeddings
}

function round(vector: number[], precision = 5): number[] {
  return vector.map((value) => Number(value.toFixed(precision)))
}

function readStore(): KnowledgeVectorStore | null {
  if (!existsSync(STORE_PATH)) return null
  return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as KnowledgeVectorStore
}

const files: Record<string, string> = {}
for (const file of readdirSync(KNOWLEDGE_DIR)) {
  if (!file.endsWith('.md')) continue
  files[file] = readFileSync(join(KNOWLEDGE_DIR, file), 'utf8')
}

const entries = parseKnowledgeFiles(files)
const previous = readStore()

const pending = entries.filter((entry) => {
  if (FORCE) return true
  const stored = previous?.entries[entry.id]
  if (!stored) return true
  return stored.hash !== contentHash(embeddingText(entry))
})

console.log(
  `\n${entries.length} fiches — ${pending.length} à recalculer, ${entries.length - pending.length} réutilisées`,
)

const vectors = new Map<string, { hash: string; vector: number[] }>()

if (pending.length > 0) {
  const startedAt = Date.now()
  const embeddings = await embed(pending.map(embeddingText))
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)

  pending.forEach((entry, index) => {
    vectors.set(entry.id, {
      hash: contentHash(embeddingText(entry)),
      vector: round(embeddings[index]),
    })
  })

  console.log(`Embeddings calculés en ${elapsed}s (${MODEL})`)
}

for (const entry of entries) {
  if (vectors.has(entry.id)) continue
  const stored = previous?.entries[entry.id]
  if (stored) vectors.set(entry.id, stored)
}

const store: KnowledgeVectorStore = {
  model: MODEL,
  dimension: vectors.values().next().value?.vector.length ?? 0,
  generatedAt: new Date().toISOString(),
  entries: Object.fromEntries(
    entries.map((entry) => [entry.id, vectors.get(entry.id)!]),
  ),
}

const missing = entries.filter((entry) => !store.entries[entry.id])
if (missing.length > 0) {
  throw new Error(`Missing vectors for: ${missing.map((entry) => entry.id).join(', ')}`)
}

writeFileSync(STORE_PATH, `${JSON.stringify(store)}\n`)
console.log(`Écrit ${STORE_PATH} (${store.dimension} dimensions)\n`)
