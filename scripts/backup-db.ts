import { mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import Database from 'better-sqlite3'

import { allowProdFromArgs, resolveDatabaseUrl } from './db-utils'

const url = resolveDatabaseUrl({ allowProd: allowProdFromArgs() })
const sqlite = new Database(url, { readonly: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const name = basename(url).replace(/\.db$/, '')
const directory = join(dirname(url), 'backups')
mkdirSync(directory, { recursive: true })
const target = join(directory, `${name}-backup-${stamp}.db`)

sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
sqlite.close()

console.log(`Sauvegarde : ${target}`)
