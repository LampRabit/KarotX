import type { Mode } from '@/themes'

export type Session = {
  version: string
  addr: string
  statePath: string
  authRequired: boolean
  authenticated: boolean
  local: boolean // request comes from the machine running KarotX
}

export type DriverName = 'postgres' | 'mysql' | 'sqlite'
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
  tls: { mode?: TLSMode; caFile?: string; certFile?: string; keyFile?: string }
  ssh?: { hops: SSHHop[] }
  production?: boolean
  readOnly?: boolean
}

export type Info = { dialect: DriverName; serverVersion: string; database: string }
export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'error'
export type ConnView = Connection & { status: ConnStatus; error?: string; info?: Info; hasPassword: boolean }
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
export type TableRef = { schema: string; table: string }
export type Change = { kind: 'insert' | 'update' | 'delete'; key?: Record<string, Value>; values?: Record<string, Value> }

export type HostKeyPrompt = { hop: number; host: string; fingerprint: string; changed: boolean }

export type AppState = {
  settings: { theme: string; mode: Mode }
  connections: Connection[]
  tabs: unknown[]
  activeTab?: string
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
  saveWorkspace: (tabs: unknown[], activeTab: string) => request<void>('PUT', '/workspace', { tabs, activeTab }),

  connections: () => request<ConnView[]>('GET', '/connections'),
  saveConnection: (connection: Connection, secrets: SecretsInput) =>
    connection.id
      ? request<Connection>('PUT', `/connections/${connection.id}`, { connection, secrets })
      : request<Connection>('POST', '/connections', { connection, secrets }),
  deleteConnection: (id: string) => request<void>('DELETE', `/connections/${id}`),
  testConnection: (connection: Connection, secrets: SecretsInput) =>
    request<Info>('POST', '/connections/test', { connection, secrets }),
  connect: (id: string) => request<Info>('POST', `/connections/${id}/connect`),
  disconnect: (id: string) => request<void>('POST', `/connections/${id}/disconnect`),
  tree: (id: string, path: string[]) =>
    request<TreeNode[]>('GET', `/connections/${id}/tree?${path.map((p) => `path=${enc(p)}`).join('&')}`),
  query: (id: string, sql: string, queryId: string, confirmed = false) =>
    request<Result[]>('POST', `/connections/${id}/query`, { sql, queryId, confirmed, maxRows: 1000 }),
  browse: (id: string, req: TableRef & { offset: number; limit: number; orderBy?: string; desc?: boolean; where?: string; queryId?: string }) =>
    request<Result>('POST', `/connections/${id}/browse`, req),
  apply: (id: string, ref: TableRef, changes: Change[], dryRun: boolean, confirmed = false) =>
    request<string[]>('POST', `/connections/${id}/apply`, { ...ref, changes, dryRun, confirmed }),
  cancel: (queryId: string) => request<void>('POST', `/queries/${queryId}/cancel`),
}

export const newId = () => Math.random().toString(36).slice(2, 10)
