import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { localStoragePersistence, useChat } from '@tanstack/ai-react'
import type { UIMessage } from '@tanstack/ai-client'

import type { CoachSource } from '#/application/queries/coach'
import { askCoach } from '#/lib/coach'
import { getCoachSources } from '#/server/coach'

const PERSISTENCE = localStoragePersistence({ keyPrefix: 'budget-app:' })

type AiAssessmentContextValue = {
  messages: UIMessage[]
  sources: CoachSource[]
  isLoading: boolean
  error: Error | undefined
  sendMessage: (content: string) => Promise<void>
  stop: () => void
  clear: () => void
}

const AiAssessmentContext = createContext<AiAssessmentContextValue | null>(null)

export function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; content: string } => part.type === 'text')
    .map((part) => part.content)
    .join('')
}

function readMonth(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export type AiAssessmentProviderProps = {
  children: ReactNode
  /** Stable period identity (`from:to`); a change remounts the provider. */
  periodKey: string
  fromMonth: string | null
  toMonth: string | null
}

export function AiAssessmentProvider({
  children,
  periodKey,
  fromMonth,
  toMonth,
}: AiAssessmentProviderProps) {
  const [sources, setSources] = useState<CoachSource[]>([])

  const { messages, sendMessage, isLoading, error, stop, clear } = useChat({
    // One transcript per period: switching period must not replay the history
    // of another range. The dashboard remounts this provider with a new key.
    threadId: `budget-coach:${periodKey}`,
    persistence: PERSISTENCE,
    fetcher: ({ messages: chatMessages, data }, { signal }) =>
      askCoach({
        data: {
          messages: chatMessages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: getMessageText(message),
          })),
          fromMonth: readMonth(data?.fromMonth),
          toMonth: readMonth(data?.toMonth),
        },
        signal,
      }),
  })

  const sendCoachMessage = useCallback(
    async (content: string) => {
      setSources([])

      // Retrieval only: it never blocks or alters the streamed answer.
      const sourcesPromise = getCoachSources({
        data: { question: content, from: fromMonth, to: toMonth },
      }).catch(() => [] as CoachSource[])

      try {
        await sendMessage(content, {
          body: { fromMonth, toMonth },
        })
      } finally {
        setSources(await sourcesPromise)
      }
    },
    [sendMessage, fromMonth, toMonth],
  )

  const clearCoach = useCallback(() => {
    setSources([])
    clear()
  }, [clear])

  const value = useMemo(
    () => ({
      messages,
      sources,
      isLoading,
      error,
      sendMessage: sendCoachMessage,
      stop,
      clear: clearCoach,
    }),
    [messages, sources, isLoading, error, sendCoachMessage, stop, clearCoach],
  )

  return (
    <AiAssessmentContext.Provider value={value}>
      {children}
    </AiAssessmentContext.Provider>
  )
}

export function useAiAssessment(): AiAssessmentContextValue {
  const context = useContext(AiAssessmentContext)
  if (!context) {
    throw new Error(
      'useAiAssessment must be used within an AiAssessmentProvider',
    )
  }
  return context
}
