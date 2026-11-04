import { mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { AppContext } from '#/infrastructure/context'
import type { StoredEvent } from '#/domain/events/envelope'
import type { GoalEvent } from '#/domain/goals/events'
import type { OperationEvent } from '#/domain/operations/events'

const PROD_MARKER = 'budget.prod.db'

export type DatabaseUrlOptions = {
  /** Explicit opt-in required to target `.db/budget.prod.db`. */
  allowProd?: boolean
}

/** Returns the target database, refusing the production file by default. */
export function resolveDatabaseUrl(
  options: DatabaseUrlOptions = {},
): string {
  const url = process.env.DATABASE_URL ?? '.db/budget.dev.db'
  if (!options.allowProd && url.includes(PROD_MARKER)) {
    throw new Error(
      `Refus d’écrire dans la base de production : ${url}. ` +
        'Relancez avec `--allow-prod` (ou `ALLOW_PROD=1`) après sauvegarde.',
    )
  }
  if (options.allowProd && url.includes(PROD_MARKER)) {
    console.warn(`⚠️  Base de production ciblée : ${url}`)
  }
  return url
}

/** Reads the explicit production opt-in from argv or the environment. */
export function allowProdFromArgs(): boolean {
  return process.argv.includes('--allow-prod') || process.env.ALLOW_PROD === '1'
}

/** Copies the database with `VACUUM INTO` and returns the backup path. */
export function backupDatabase(ctx: AppContext, url: string, label: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = basename(url).replace(/\.db$/, '')
  const directory = join(dirname(url), 'backups')
  mkdirSync(directory, { recursive: true })
  const target = join(directory, `${name}-${label}-${stamp}.db`)
  ctx.sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  return target
}

/** Replays every event in global order through the matching projector. */
export function replayAll(ctx: AppContext): number {
  let position = 0
  let count = 0
  for (;;) {
    const all = ctx.events.readAll(position, 5000)
    if (all.length === 0) break

    const operationEvents = all.filter(
      (event): event is StoredEvent<OperationEvent> =>
        event.streamType === 'operation',
    )
    const goalEvents = all.filter(
      (event): event is StoredEvent<GoalEvent> =>
        event.streamType === 'goal',
    )

    if (operationEvents.length > 0) ctx.projector.apply(operationEvents)
    if (goalEvents.length > 0) ctx.goalProjector.apply(goalEvents)

    position = all[all.length - 1]!.globalPosition
    count += all.length
  }
  ctx.events.saveCheckpoint('operations', position)
  ctx.events.saveCheckpoint('goals', position)
  return count
}
