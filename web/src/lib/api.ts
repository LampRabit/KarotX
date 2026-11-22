import type { Mode } from '@/themes'

export type Session = {
  version: string
  addr: string
  statePath: string
  authRequired: boolean
  authenticated: boolean
  local: boolean // request comes from the machine running KarotX
}

export type DriverName = 'postgres' | 'mysql' | 'sqlite' | 'redis' | 'mongodb'
export type SqlDriver = 'postgres' | 'mysql' | 'sqlite'
export const isSql = (d: DriverName): d is SqlDriver => d === 'postgres' || d === 'mysql' || d === 'sqlite'
export type TLSMode = 'off' | 'prefer' | 'require' | 'verify'
export type SSHAuth = 'password' | 'key' | 'agent'
export type SSHHop = { host: string; port?: number; user: string; auth: SSHAuth; keyFile?: string; hostKey?: string }

export type Connection = {
  id: string
  name: string
  driver: DriverName
  preset?: string
  color?: string
  host?: string
  port?: number
  user?: string
  database?: string
  file?: string
  /** MongoDB: host is a DNS seed list (mongodb+srv://). */
  srv?: boolean
  /** Extra driver options, e.g. MongoDB URI options (authSource, replicaSet, …). */
  params?: Record<string, string>
  tls: { mode?: TLSMode; caFile?: string; certFile?: string; keyFile?: string }
  ssh?: { hops: SSHHop[] }
  production?: boolean
  readOnly?: boolean
}

export type Info = { dialect: DriverName; serverVersion: string; database: string }
export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'error'
export type ConnView = Connection & {
  status: ConnStatus; error?: string; info?: Info; hasPassword: boolean
  /** From the LampRabit services file: can't be edited or deleted here. */
  managed?: boolean
  /** Why it can't be opened (stopped, or type not supported yet). */
  unavailable?: string
}
/** `null` keeps the stored secret, a string replaces it. */
export type SecretsInput = { password: string | null; ssh: (string | null)[] }

export type TreeNode = {
  name: string
  kind: 'database' | 'schema' | 'table' | 'view' | 'column'
  path: string[]
  hasChildren: boolean
  detail?: string
  primaryKey?: boolean
}

export type Column = { name: string; type: string }
export type Value = string | number | boolean | null
export type Result = {
  statement: string
  columns?: Column[]
  rows?: Value[][]
  rowsAffected?: number
  truncated?: boolean
  durationMs: number
  primaryKey?: string[]
  error?: string
}
/** `database` picks another database on the same server (Postgres); omitted = the connection's own. */
export type TableRef = { database?: string; schema: string; table: string }
export type TableInfo = { name: string; kind: 'table' | 'view'; rows?: number; bytes?: number }
export type ColumnInfo = { name: string; type: string; nullable: boolean; default: string | null; primaryKey: boolean; autoIncrement: boolean; primaryKeyName?: string }
export type ForeignKey = { name: string; table: string; columns: string[]; refTable: string; refColumns: string[] }
export type RedisKey = { key: string; type: string; ttl: number }
export type RedisKeyPage = { keys: RedisKey[]; cursor: string }
export type ZMember = { member: string; score: number }
export type StreamEntry = { id: string; fields: Record<string, string> }
export type RedisKeyData = {
  key: string
  type: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | string
  ttl: number // ms, -1 = no expiry
  length: number
  value: string | [string, string][] | string[] | ZMember[] | StreamEntry[] | null
  truncated: boolean
  binary: boolean
}
export type MongoFindResult = { docs: Record<string, unknown>[]; total: number; estimated: boolean; durationMs: number }
export type MongoField = { path: string; type: string }

export type FsEntry = { name: string; path: string; dir: boolean; size: number; modified: string }
export type FsListing = { path: string; parent: string; home: string; roots: string[]; entries: FsEntry[] }
export type Change = { kind: 'insert' | 'update' | 'delete'; key?: Record<string, Value>; values?: Record<string, Value> }

export type HostKeyPrompt = { hop: number; host: string; fingerprint: string; changed: boolean }

export type AppState = {
  settings: { theme: string; mode: Mode }
  connections: Connection[]
  tabs: unknown[]
  activeTab?: string
  expanded?: string[]
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: { hostKey?: HostKeyPrompt; needsConfirmation?: boolean; statements?: string[] } = {},
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the KarotX server. Is it still running?')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data.error ?? res.statusText, data)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

const enc = encodeURIComponent

export const api = {
  session: () => request<Session>('GET', '/session'),
  login: (password: string) => request<void>('POST', '/login', { password }),
  logout: () => request<void>('POST', '/logout'),
  setPassword: (current: string, password: string) => request<void>('PUT', '/password', { current, password }),
  removePassword: (current: string) => request<void>('DELETE', '/password', { current }),
  state: () => request<AppState>('GET', '/state'),
  saveSettings: (s: Partial<AppState['settings']>) => request<void>('PATCH', '/settings', s),
  saveWorkspace: (tabs: unknown[], activeTab: string, expanded: string[]) => request<void>('PUT', '/workspace', { tabs, activeTab, expanded }),

  connections: () => request<ConnView[]>('GET', '/connections'),
  saveConnection: (connection: Connection, secrets: SecretsInput) =>
    connection.id
      ? request<Connection>('PUT', `/connections/${connection.id}`, { connection, secrets })
      : request<Connection>('POST', '/connections', { connection, secrets }),
  deleteConnection: (id: string) => request<void>('DELETE', `/connections/${id}`),
  testConnection: (connection: Connection, secrets: SecretsInput) =>
    request<Info>('POST', '/connections/test', { connection, secrets }),
  connect: (id: string) => request<Info>('POST', `/connections/${id}/connect`),
  /** Without `db`, closes every session of the connection; with it, only that database's. */
  disconnect: (id: string, db?: string) => request<void>('POST', `/connections/${id}/disconnect${db ? `?db=${enc(db)}` : ''}`),
  tree: (id: string, path: string[], db?: string) =>
    request<TreeNode[]>('GET', `/connections/${id}/tree?${[db ? `db=${enc(db)}` : '', ...path.map((p) => `path=${enc(p)}`)].filter(Boolean).join('&')}`),
  query: (id: string, sql: string, queryId: string, confirmed = false, schema?: string, database?: string) =>
    request<Result[]>('POST', `/connections/${id}/query`, { sql, queryId, confirmed, schema, database, maxRows: 1000 }),
  tables: (id: string, schema: string, db?: string) =>
    request<TableInfo[]>('GET', `/connections/${id}/tables?schema=${enc(schema)}${db ? `&db=${enc(db)}` : ''}`),
  columns: (id: string, ref: TableRef) =>
    request<ColumnInfo[]>('GET', `/connections/${id}/columns?schema=${enc(ref.schema)}&table=${enc(ref.table)}${ref.database ? `&db=${enc(ref.database)}` : ''}`),
  foreignKeys: (id: string, schema: string, db?: string) =>
    request<ForeignKey[]>('GET', `/connections/${id}/foreignkeys?schema=${enc(schema)}${db ? `&db=${enc(db)}` : ''}`),
  redis: {
    keys: (id: string, db: number, pattern: string, cursor: string, type = '', count = 200) =>
      request<RedisKeyPage>('GET', `/connections/${id}/redis/keys?db=${db}&pattern=${enc(pattern)}&cursor=${enc(cursor)}&type=${enc(type)}&count=${count}`),
    key: (id: string, db: number, key: string) => request<RedisKeyData>('GET', `/connections/${id}/redis/key?db=${db}&key=${enc(key)}`),
    dbsize: (id: string, db: number) => request<{ keys: number }>('GET', `/connections/${id}/redis/dbsize?db=${db}`),
    /** One command: `args` from the UI, or `line` typed in the console. */
    command: (id: string, db: number, cmd: { args?: string[]; line?: string }, confirmed = false) =>
      request<{ result: unknown }>('POST', `/connections/${id}/redis/command`, { db, ...cmd, confirmed }),
  },
  mongo: {
    find: (id: string, db: string, collection: string, q: { filter?: unknown; sort?: unknown; skip: number; limit: number; queryId?: string }) =>
      request<MongoFindResult>('POST', `/connections/${id}/mongo/find`, { db, collection, ...q }),
    fields: (id: string, db: string, collection: string) =>
      request<MongoField[]>('GET', `/connections/${id}/mongo/fields?db=${enc(db)}&collection=${enc(collection)}`),
    /** `clear` deletes every document first (import "replace"). */
    insert: (id: string, db: string, collection: string, docs: unknown[], clear = false, confirmed = false) =>
      request<{ inserted: number }>('POST', `/connections/${id}/mongo/insert`, { db, collection, docs, clear, confirmed }),
    replace: (id: string, db: string, collection: string, docId: unknown, doc: unknown, confirmed = false) =>
      request<void>('POST', `/connections/${id}/mongo/replace`, { db, collection, id: docId, doc, confirmed }),
    delete: (id: string, db: string, collection: string, ids: unknown[], confirmed = false) =>
      request<{ deleted: number }>('POST', `/connections/${id}/mongo/delete`, { db, collection, ids, confirmed }),
    aggregate: (id: string, db: string, collection: string, pipeline: unknown, confirmed = false) =>
      request<{ docs: Record<string, unknown>[] }>('POST', `/connections/${id}/mongo/aggregate`, { db, collection, pipeline, confirmed }),
    command: (id: string, db: string, command: unknown, confirmed = false) =>
      request<{ result: unknown }>('POST', `/connections/${id}/mongo/command`, { db, command, confirmed }),
    createCollection: (id: string, db: string, collection: string) => request<void>('POST', `/connections/${id}/mongo/collection`, { db, collection }),
    /** Drops a collection, or the whole database when `collection` is empty. */
    drop: (id: string, db: string, collection = '', confirmed = false) => request<void>('POST', `/connections/${id}/mongo/drop`, { db, collection, confirmed }),
  },
  fs: (path: string) => request<FsListing>('GET', `/fs?path=${enc(path)}`),
  createSqlite: (dir: string, name: string) => request<{ path: string }>('POST', '/fs/sqlite', { dir, name }),
  browse: (id: string, req: TableRef & { offset: number; limit: number; orderBy?: string; desc?: boolean; where?: string; queryId?: string }) =>
    request<Result>('POST', `/connections/${id}/browse`, req),
  apply: (id: string, ref: TableRef, changes: Change[], dryRun: boolean, confirmed = false) =>
    request<string[]>('POST', `/connections/${id}/apply`, { ...ref, changes, dryRun, confirmed }),
  cancel: (queryId: string) => request<void>('POST', `/queries/${queryId}/cancel`),
  /** Inserts rows in one transaction; `clear` empties the table first (same transaction). */
  importRows: (id: string, ref: TableRef, columns: string[], rows: unknown[][], clear = false, confirmed = false) =>
    request<{ inserted: number }>('POST', `/connections/${id}/import/rows`, { ...ref, columns, rows, clear, confirmed }),
  /** Writes dumped Redis keys; existing keys are skipped unless `replace`. */
  redisImport: (id: string, db: number, items: unknown[], replace: boolean, confirmed = false) =>
    request<{ written: number; skipped: number }>('POST', `/connections/${id}/redis/import`, { db, items, replace, confirmed }),
}

export const newId = () => Math.random().toString(36).slice(2, 10)
