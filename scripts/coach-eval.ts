import { execFileSync } from 'node:child_process'

import { loadKnowledgeEntries } from '#/eval/coach/load'
import { buildScenarioPrompt, runScenario } from '#/eval/coach/run'
import { SCENARIOS } from '#/eval/coach/scenarios'

/**
 * Offline coach evaluation.
 *
 *   pnpm test:coach                            # 10 scenarios + privacy audit
 *   pnpm test:coach -- --scenario=budget-equilibre
 *   pnpm test:coach -- --live                  # manual Ollama inspection
 *
 * The default run needs neither Ollama nor a database file. `--live` sends the
 * exact prompt to Ollama and prints the answer: it is an inspection mode, never
 * an assertion, and it is not part of the unit-test suite.
 */

const HOST = (process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(
  /\/$/,
  '',
)
const MODEL = 'qwen3:14b'

function readArg(name: string): string | null {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function printHelp(): void {
  console.log(`Évaluation déterministe du coach financier.

Usage :
  pnpm test:coach [options]

Options :
  --scenario=<id>   Exécute un seul scénario (voir la liste ci-dessous).
  --live            Après l'éval hors ligne, envoie chaque prompt à Ollama
                    (${MODEL}) et affiche la réponse. Inspection manuelle,
                    aucune assertion sémantique.
  --help            Affiche cette aide.

Scénarios :
${SCENARIOS.map((scenario) => `  ${scenario.id.padEnd(24)} ${scenario.title}`).join('\n')}

Sans --live, aucun appel réseau ni accès à une base de données.
`)
}

/**
 * The privacy audit needs the Vite `import.meta.glob` knowledge loader, which
 * `tsx` cannot execute. It is therefore run through Vitest, as a blocking gate
 * before the scenarios: a leak fails `pnpm test:coach` even when every prompt
 * scenario is green.
 */
function runPrivacyGate(): boolean {
  console.log('\nAudit confidentialité (test Vitest bloquant)…')

  try {
    execFileSync(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        'src/eval/coach/privacy.test.ts',
        '--reporter=dot',
      ],
      { stdio: 'inherit' },
    )
    return true
  } catch {
    console.error('\n✗ Audit confidentialité : ÉCHEC')
    return false
  }
}

async function liveAnswer(
  scenario: (typeof SCENARIOS)[number],
  entries: ReturnType<typeof loadKnowledgeEntries>,
): Promise<string> {
  const { full } = buildScenarioPrompt(scenario, entries)

  let response: Response
  try {
    response = await fetch(`${HOST}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        options: { temperature: 0.3, num_predict: 600 },
        messages: [
          { role: 'system', content: full },
          { role: 'user', content: scenario.question },
        ],
      }),
    })
  } catch (error: unknown) {
    throw new Error(
      `Ollama est injoignable sur ${HOST}. Lancez le serveur Ollama puis réessayez. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    )
  }

  if (!response.ok) {
    throw new Error(
      `Ollama a répondu ${response.status}. Vérifiez que le serveur est lancé (${HOST}) et que le modèle ${MODEL} est disponible.`,
    )
  }

  const payload = (await response.json()) as {
    message?: { content?: string }
  }
  const content = payload.message?.content?.trim()
  if (!content) {
    throw new Error('Réponse Ollama vide')
  }
  return content
}

async function main(): Promise<void> {
  if (hasFlag('help')) {
    printHelp()
    return
  }

  const scenarioId = readArg('scenario')
  const live = hasFlag('live')
  const entries = loadKnowledgeEntries()
  const selected = scenarioId
    ? SCENARIOS.filter((scenario) => scenario.id === scenarioId)
    : SCENARIOS

  if (selected.length === 0) {
    console.error(
      `\nScénario inconnu : ${scenarioId}\n` +
        `Disponibles : ${SCENARIOS.map((scenario) => scenario.id).join(', ')}\n`,
    )
    process.exitCode = 1
    return
  }

  if (!runPrivacyGate()) {
    process.exitCode = 1
    return
  }
  console.log(
    '\n✓ Audit confidentialité : aucun libellé bancaire dans le payload ni le journal',
  )

  const results = selected.map((scenario) => runScenario(scenario, entries))
  console.table(
    results.map((result) => ({
      id: result.id,
      scénario: result.title,
      statut: result.ok ? '✓' : '✗',
      'échecs': result.failures.length,
    })),
  )

  let failed = 0
  for (const result of results) {
    if (result.ok) continue
    failed += 1
    console.error(`\n✗ ${result.id} — ${result.title}`)
    for (const failure of result.failures) console.error(`  - ${failure}`)
  }

  const passed = results.length - failed
  console.log(`\n${passed}/${results.length} scénarios OK`)
  if (failed > 0) process.exitCode = 1

  if (!live) return

  console.log(
    `\nMode live — ${HOST}, modèle ${MODEL}. Inspection manuelle, aucune assertion.\n` +
      'qwen3:14b peut prendre plusieurs minutes par scénario.\n',
  )

  for (const scenario of selected) {
    console.log(`\n=== ${scenario.id} — ${scenario.title}`)
    console.log(`Question : ${scenario.question}\n`)
    const answer = await liveAnswer(scenario, entries)
    console.log(answer)
    console.log('')
  }
}

main().catch((error: unknown) => {
  console.error(
    `\n${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
