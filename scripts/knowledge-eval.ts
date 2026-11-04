import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  embeddingSearch,
  hybridSearch,
  type KnowledgeVectorStore,
} from '#/domain/knowledge/embedding'
import { KNOWLEDGE_EVAL_SET } from '#/domain/knowledge/eval-set'
import { parseKnowledgeFiles } from '#/domain/knowledge/parse'
import { searchKnowledge } from '#/domain/knowledge/search'
import {
  DEFAULT_KNOWLEDGE_RETRIEVAL,
  type KnowledgeEntry,
  type KnowledgeMatch,
  type KnowledgeRetrievalStrategy,
} from '#/domain/knowledge/types'

/**
 * Retrieval evaluation for the knowledge base.
 *
 *   pnpm knowledge:eval                          # application default
 *   pnpm knowledge:eval --strategy=lexical       # lexical (no model needed)
 *   pnpm knowledge:eval --strategy=embedding     # vectors only
 *   pnpm knowledge:eval --strategy=hybrid        # BM25 + vectors, fused
 *   pnpm knowledge:eval --compare                # all three, side by side
 *
 * Embedding strategies need `pnpm knowledge:embed` to have run and Ollama to
 * be reachable (bge-m3).
 *
 * Quality gate (single strategy only): recall@3 ≥ 90 % and recall@5 ≥ 95 %.
 * The coach injects the top 4 cards, so a miss at rank 3 still leaves one slot
 * of tolerance, while a miss beyond rank 5 means the card was effectively
 * unavailable. The thresholds are deliberately visible and are not adjusted to
 * make a run pass: a residual failure is reported, not hidden.
 */

const KNOWLEDGE_DIR = fileURLToPath(new URL('../src/content/knowledge/', import.meta.url))
const STORE_PATH = join(KNOWLEDGE_DIR, 'embeddings.json')
const HOST = (process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/$/, '')
const MAX_RANK = 5

/** Minimum share of questions whose expected card is in the top 3 / top 5. */
const MIN_RECALL_AT_3 = 0.9
const MIN_RECALL_AT_5 = 0.95

type Strategy = KnowledgeRetrievalStrategy

const STRATEGIES: Strategy[] = ['lexical', 'embedding', 'hybrid']

function readArg(name: string): string | null {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function loadEntries(): KnowledgeEntry[] {
  const files: Record<string, string> = {}
  for (const file of readdirSync(KNOWLEDGE_DIR)) {
    if (!file.endsWith('.md')) continue
    files[file] = readFileSync(join(KNOWLEDGE_DIR, file), 'utf8')
  }
  return parseKnowledgeFiles(files)
}

function loadStore(): KnowledgeVectorStore {
  if (!existsSync(STORE_PATH)) {
    throw new Error(
      'embeddings.json is missing. Run `pnpm knowledge:embed` first.',
    )
  }
  return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as KnowledgeVectorStore
}

async function embedQueries(queries: string[]): Promise<number[][]> {
  const model = loadStore().model
  const response = await fetch(`${HOST}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: queries }),
  })
  if (!response.ok) {
    throw new Error(
      `Ollama embedding failed (${response.status}). Is Ollama running?`,
    )
  }
  const payload = (await response.json()) as { embeddings: number[][] }
  return payload.embeddings
}

function rankOf(matches: KnowledgeMatch[], expected: string): number {
  return matches.findIndex((match) => match.entry.id === expected) + 1
}

function recall(ranks: number[], at: number): number {
  const hits = ranks.filter((rank) => rank >= 1 && rank <= at).length
  return ranks.length === 0 ? 0 : hits / ranks.length
}

/** Mean reciprocal rank: 1 for rank 1, 1/2 for rank 2, 0 when not retrieved. */
function meanReciprocalRank(ranks: number[]): number {
  if (ranks.length === 0) return 0
  const sum = ranks.reduce((total, rank) => total + (rank > 0 ? 1 / rank : 0), 0)
  return sum / ranks.length
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)} %`
}

function milliseconds(value: number): string {
  return `${value.toFixed(1)} ms`
}

function meetsThreshold(ranks: number[]): boolean {
  return recall(ranks, 3) >= MIN_RECALL_AT_3 && recall(ranks, 5) >= MIN_RECALL_AT_5
}

async function main() {
  const entries = loadEntries()
  const compare = process.argv.includes('--compare')
  const requested = readArg('strategy')

  if (requested && !STRATEGIES.includes(requested as Strategy)) {
    throw new Error(`unknown strategy: ${requested} (expected ${STRATEGIES.join(', ')})`)
  }

  const strategies: Strategy[] = compare
    ? STRATEGIES
    : [(requested as Strategy | null) ?? DEFAULT_KNOWLEDGE_RETRIEVAL]

  const needsVectors = strategies.some((strategy) => strategy !== 'lexical')
  const store = needsVectors ? loadStore() : null
  let queryVectors: number[][] = []
  let embeddingPerQuery = 0

  if (needsVectors) {
    const startedAt = performance.now()
    queryVectors = await embedQueries(
      KNOWLEDGE_EVAL_SET.map((item) => item.query),
    )
    // The batch is one HTTP call divided by the number of questions: a close
    // enough estimate of the per-query vectorisation cost, without paying 50
    // network round-trips.
    embeddingPerQuery =
      (performance.now() - startedAt) / KNOWLEDGE_EVAL_SET.length
  }

  const ranksByStrategy = new Map<Strategy, number[]>()
  const retrievalByStrategy = new Map<Strategy, number>()

  for (const strategy of strategies) {
    const startedAt = performance.now()
    const ranks = KNOWLEDGE_EVAL_SET.map(({ query, expected }, index) => {
      const options = { limit: MAX_RANK }
      const matches =
        strategy === 'lexical'
          ? searchKnowledge(entries, query, options)
          : strategy === 'embedding'
            ? embeddingSearch(entries, store!, queryVectors[index], options)
            : hybridSearch({
                entries,
                query,
                store: store!,
                queryVector: queryVectors[index],
                limit: MAX_RANK,
              })
      return rankOf(matches, expected)
    })
    const elapsed = performance.now() - startedAt
    ranksByStrategy.set(strategy, ranks)
    retrievalByStrategy.set(strategy, elapsed / KNOWLEDGE_EVAL_SET.length)
  }

  console.log(`\nCorpus : ${entries.length} fiches — ${KNOWLEDGE_EVAL_SET.length} questions`)
  console.log(
    `Seuil : recall@3 ≥ ${percent(MIN_RECALL_AT_3)} et recall@5 ≥ ${percent(MIN_RECALL_AT_5)}`,
  )

  const rows = KNOWLEDGE_EVAL_SET.map(({ query, expected }, index) => {
    const row: Record<string, string> = {
      query,
      expected,
    }
    for (const strategy of strategies) {
      const rank = ranksByStrategy.get(strategy)![index]
      row[strategy] = rank === 0 ? '—' : String(rank)
    }
    return row
  })

  console.table(rows)

  console.log('')
  for (const strategy of strategies) {
    const ranks = ranksByStrategy.get(strategy)!
    const retrieval = retrievalByStrategy.get(strategy)!
    const vectorisation = strategy === 'lexical' ? 0 : embeddingPerQuery
    console.log(
      `${strategy.padEnd(10)} recall@1 ${percent(recall(ranks, 1))}  ` +
        `recall@3 ${percent(recall(ranks, 3))}  ` +
        `recall@5 ${percent(recall(ranks, 5))}  ` +
        `MRR ${meanReciprocalRank(ranks).toFixed(3)}  ` +
        `~${milliseconds(retrieval + vectorisation)}/question  ` +
        `seuil ${meetsThreshold(ranks) ? 'OK' : 'ÉCHEC'}`,
    )
  }
  console.log(
    'Temps : recherche + vectorisation de la requête (bge-m3, lot divisé par question).',
  )
  console.log('')

  for (const strategy of strategies) {
    const ranks = ranksByStrategy.get(strategy)!
    const misses = KNOWLEDGE_EVAL_SET
      .map(({ query, expected }, index) => ({
        query,
        expected,
        rank: ranks[index],
      }))
      .filter(({ rank }) => rank === 0 || rank > 3)

    console.log(`Échecs recall@3 — ${strategy} (${misses.length})`)
    if (misses.length === 0) {
      console.log('  aucun')
    } else {
      for (const { query, expected, rank } of misses) {
        console.log(`  rang ${rank === 0 ? '—' : rank}  ${query} → ${expected}`)
      }
    }
  }
  console.log('')

  if (compare) {
    if (!strategies.some((strategy) => meetsThreshold(ranksByStrategy.get(strategy)!))) {
      process.exitCode = 1
    }
  } else {
    const strategy = strategies[0]
    const ranks = ranksByStrategy.get(strategy)!
    if (!meetsThreshold(ranks)) process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
