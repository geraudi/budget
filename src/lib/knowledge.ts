import { createServerFn } from '@tanstack/react-start'
import { chat, toServerSentEventsResponse, type ModelMessage } from '@tanstack/ai'
import { ollamaText } from '@tanstack/ai-ollama'

import { formatKnowledgeContext } from '#/domain/knowledge/search'
import type { KnowledgeMatch } from '#/domain/knowledge/types'
import { retrieveKnowledge } from '#/infrastructure/knowledge/retrieval'

const MAX_MESSAGES = 20
const MAX_MESSAGE_LENGTH = 4_000
const DEFAULT_LIMIT = 4

export type KnowledgeChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

/** Shared chat-input validation: bounded history, bounded message length. */
export function parseChatMessages(value: unknown): KnowledgeChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('messages must be a non-empty array')
  }
  if (value.length > MAX_MESSAGES) {
    throw new Error(`messages must contain at most ${MAX_MESSAGES} items`)
  }

  return value.map((message) => {
    if (typeof message !== 'object' || message === null) {
      throw new Error('invalid message')
    }
    const { role, content } = message as Record<string, unknown>
    if (role !== 'user' && role !== 'assistant') {
      throw new Error('invalid message role')
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('invalid message content')
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error('message too long')
    }
    return { role, content: content.trim() }
  })
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_LIMIT
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error('limit must be an integer between 1 and 10')
  }
  return limit
}

export function lastUserMessage(messages: KnowledgeChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') return message.content
  }
  throw new Error('no user message')
}

const SYSTEM_PROMPT = `Tu es un coach financier documentaliste, spécialisé dans la gestion du budget des particuliers en France.

Tu réponds UNIQUEMENT à partir des fiches de connaissances fournies dans le contexte. Ces fiches contiennent un principe, des points d'application et leurs limites.

Règles :
1. Appuie chaque affirmation sur une fiche et cite le nom de la source (par exemple « selon La Finance pour tous »).
2. Si les fiches ne couvrent pas la question, dis-le explicitement et n'invente aucune règle, aucun chiffre et aucune source.
3. Reprends les limites pertinentes : une règle indicative n'est pas une obligation.
4. Ne donne pas de conseil personnalisé en investissement, fiscalité ou droit. Pour ces sujets, indique les limites de ton rôle et oriente vers une source officielle ou un professionnel.
5. Ne prétends pas connaître la situation budgétaire de l'utilisateur : tu n'as aucune donnée personnelle dans cette conversation.
6. Réponds en français, de façon claire et concise (200 à 350 mots). Commence par la réponse directe, puis les nuances utiles.
7. Si une fiche est marquée « à vérifier », précise que l'information peut avoir évolué.`

function toModelMessages(messages: KnowledgeChatMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

export type KnowledgeSearchResult = {
  query: string
  matches: {
    id: string
    title: string
    category: string
    source: string
    score: number
    matchedTerms: string[]
  }[]
}

/**
 * Retrieval over the knowledge cards (hybrid by default). Exposed so the
 * retrieval quality can be inspected and evaluated without calling the model.
 */
export const searchKnowledgeBase = createServerFn({ method: 'GET' })
  .validator((data: { query?: unknown; limit?: unknown } | undefined) => {
    if (!data || typeof data.query !== 'string' || !data.query.trim()) {
      throw new Error('query is required')
    }
    return { query: data.query.trim(), limit: parseLimit(data.limit) }
  })
  .handler(async ({ data }): Promise<KnowledgeSearchResult> => {
    const matches: KnowledgeMatch[] = await retrieveKnowledge(
      data.query,
      { limit: data.limit },
    )
    return {
      query: data.query,
      matches: matches.map((match) => ({
        id: match.entry.id,
        title: match.entry.title,
        category: match.entry.category,
        source: match.entry.source,
        score: Number(match.score.toFixed(3)),
        matchedTerms: match.matchedTerms,
      })),
    }
  })

/**
 * Documentary Q&A: answers a general question from the knowledge base only.
 * It deliberately receives no budget data, so it cannot pretend to know the
 * user's situation.
 */
export const askKnowledge = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      messages?: unknown
      limit?: unknown
    }) => ({
      messages: parseChatMessages(data?.messages),
      limit: parseLimit(data?.limit),
    }),
  )
  .handler(async ({ data }) => {
    const query = lastUserMessage(data.messages)
    const matches = await retrieveKnowledge(query, {
      limit: data.limit,
    })

    const context = formatKnowledgeContext(matches)
    const contextBlock = matches.length > 0
      ? `Fiches de connaissances disponibles :\n\n${context}`
      : "Aucune fiche de connaissances ne correspond à cette question. Dis-le clairement à l'utilisateur."

    const stream = chat({
      adapter: ollamaText('qwen3:14b'),
      messages: toModelMessages(data.messages),
      systemPrompts: [SYSTEM_PROMPT, contextBlock],
      modelOptions: {
        options: {
          temperature: 0.3,
          num_predict: 900,
        },
      },
    })

    return toServerSentEventsResponse(stream)
  })
