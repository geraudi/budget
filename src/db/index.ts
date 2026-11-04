import { createDatabase } from './create'

/**
 * Application singleton. Server functions share this connection; scripts and
 * tests use `createDatabase`/`createContext` directly.
 */
export const { db, sqlite } = createDatabase()

export type { AppDb, SqliteHandle } from './create'
