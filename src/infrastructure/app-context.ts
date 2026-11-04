import { db, sqlite } from '#/db'

import { createContext, type AppContext } from './context'

const globalForContext = globalThis as typeof globalThis & {
  __budgetAppContext?: AppContext
}

/**
 * Application-wide context, cached on `globalThis` so Vite HMR does not open
 * a new SQLite connection on every module reload.
 */
export function getContext(): AppContext {
  return (globalForContext.__budgetAppContext ??= createContext({
    db,
    sqlite,
  }))
}
