import { createServerFn } from '@tanstack/react-start'
import { chat, toServerSentEventsResponse, type ModelMessage } from '@tanstack/ai'
import { ollamaText } from '@tanstack/ai-ollama'

import { buildCoachContext, parseMonthInput } from '#/application/queries/coach'
import { getContext } from '#/infrastructure/app-context'
import {
  buildCoachPayload,
  buildCoachSystemPrompt,
} from '#/lib/coach-prompt'
import {
  lastUserMessage,
  parseChatMessages,
  type KnowledgeChatMessage,
} from '#/lib/knowledge'

export { buildCoachPayload, buildCoachSystemPrompt }

type CoachChatInput = {
  messages: KnowledgeChatMessage[]
  fromMonth: string | null
  toMonth: string | null
}

function toModelMessages(
  messages: KnowledgeChatMessage[],
): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

/**
 * Financial coach endpoint.
 *
 * The indicator payload and the retrieved cards are rebuilt on every request:
 * the server keeps no state, and the client history can never alter the
 * figures. `knowledgeBlock` is omitted when the question matches no card.
 */
export const askCoach = createServerFn({ method: 'POST' })
  .validator((data: unknown): CoachChatInput => {
    if (!data || typeof data !== 'object') throw new Error('Données invalides')
    const d = data as Record<string, unknown>

    return {
      messages: parseChatMessages(d.messages),
      fromMonth: parseMonthInput(d.fromMonth, 'Mois de début'),
      toMonth: parseMonthInput(d.toMonth, 'Mois de fin'),
    }
  })
  .handler(async ({ data }) => {
    const ctx = getContext()
    const question = lastUserMessage(data.messages)
    const { indicators, goals, knowledgeBlock } = await buildCoachContext(ctx, {
      from: data.fromMonth,
      to: data.toMonth,
      question,
    })

    const stream = chat({
      adapter: ollamaText('qwen3:14b'),
      messages: toModelMessages(data.messages),
      systemPrompts: [
        buildCoachSystemPrompt(indicators, goals),
        knowledgeBlock,
      ].filter((block) => block.length > 0),
      modelOptions: {
        options: {
          temperature: 0.3,
          num_predict: 1400,
        },
      },
    })

    return toServerSentEventsResponse(stream)
  })
