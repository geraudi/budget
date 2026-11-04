import {
  formatKnowledgeContext,
  searchKnowledge,
} from '#/domain/knowledge/search'
import type { KnowledgeEntry, KnowledgeMatch } from '#/domain/knowledge/types'
import {
  buildCoachPayload,
  buildCoachSystemPrompt,
  buildGoalPayload,
} from '#/lib/coach-prompt'
import type { CoachScenario } from './scenarios'

export type ScenarioResult = {
  id: string
  title: string
  ok: boolean
  failures: string[]
  matches: KnowledgeMatch[]
}

export type ScenarioPrompt = {
  matches: KnowledgeMatch[]
  knowledgeBlock: string
  prompt: string
  full: string
}

/**
 * Rebuilds the exact prompt an `askCoach` call would send: system prompt plus
 * retrieved cards. No model, no network, no database.
 */
export function buildScenarioPrompt(
  scenario: CoachScenario,
  entries: KnowledgeEntry[],
): ScenarioPrompt {
  const matches = searchKnowledge(entries, scenario.question, { limit: 4 })
  const knowledgeBlock = formatKnowledgeContext(matches)
  const prompt = buildCoachSystemPrompt(
    scenario.indicators,
    scenario.goals ?? [],
  )
  const full = [prompt, knowledgeBlock].filter((block) => block.length > 0).join('\n\n')

  return { matches, knowledgeBlock, prompt, full }
}

/**
 * Deterministic evaluation of one scenario.
 *
 * It asserts the prompt content (figures, directives, warnings), the retrieved
 * cards and the exact payload injection. Model prose is deliberately not
 * tested: `--live` exists for manual inspection only.
 */
export function runScenario(
  scenario: CoachScenario,
  entries: KnowledgeEntry[],
): ScenarioResult {
  const { matches, prompt, full } = buildScenarioPrompt(scenario, entries)
  const failures: string[] = []

  for (const expected of scenario.expect) {
    if (!full.includes(expected)) {
      failures.push(`Chaîne attendue absente : ${expected}`)
    }
  }

  for (const forbidden of scenario.forbid ?? []) {
    if (full.includes(forbidden)) {
      failures.push(`Chaîne interdite présente : ${forbidden}`)
    }
  }

  if (scenario.expectSourceId) {
    const sourceIds = matches.map((match) => match.entry.id)
    if (!sourceIds.includes(scenario.expectSourceId)) {
      failures.push(
        `Fiche attendue hors du top 4 : ${scenario.expectSourceId} ` +
          `(obtenu : ${sourceIds.join(', ') || 'aucune'})`,
      )
    }
  }

  if (!prompt.includes(buildCoachPayload(scenario.indicators))) {
    failures.push('Le payload des indicateurs n’est pas inclus tel quel dans le prompt')
  }

  const goals = scenario.goals ?? []
  if (goals.length > 0 && !prompt.includes(buildGoalPayload(goals))) {
    failures.push('Le payload des objectifs n’est pas inclus tel quel dans le prompt')
  }

  return {
    id: scenario.id,
    title: scenario.title,
    ok: failures.length === 0,
    failures,
    matches,
  }
}
