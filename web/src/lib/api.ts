import type { Mode } from '@/themes'

export type Session = { version: string; authRequired: boolean; authenticated: boolean }
export type AppState = {
  settings: { theme: string; mode: Mode }
  connections: unknown[]
  tabs: unknown[]
  activeTab?: string
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data.error ?? res.statusText)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const api = {
  session: () => request<Session>('GET', '/session'),
  login: (password: string) => request<void>('POST', '/login', { password }),
  logout: () => request<void>('POST', '/logout'),
  state: () => request<AppState>('GET', '/state'),
  saveSettings: (s: Partial<AppState['settings']>) => request<void>('PATCH', '/settings', s),
}
