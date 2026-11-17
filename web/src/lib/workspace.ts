import { create } from 'zustand'
import { toast } from 'sonner'
import { api, newId, type ConnView, type TableRef, type TreeNode } from './api'
import { track } from './activity'

export type Tab =
  | { id: string; kind: 'table'; connId: string; title: string; table: TableRef; sql?: string }
  | { id: string; kind: 'query'; connId: string; title: string; sql: string; schema?: string }
  | { id: string; kind: 'database'; connId: string; title: string; schema?: string; sql?: string }

type TreeEntry = { nodes?: TreeNode[]; loading: boolean; error?: string }

type Workspace = {
  connections: ConnView[]
  loaded: boolean
  trees: Record<string, TreeEntry>
  expanded: Record<string, boolean>
  tabs: Tab[]
  activeTab: string // '' = Home
  /** Bumped after DDL so open views reload their schema. */
  schemaVersion: Record<string, number>

  init: (tabs: unknown[], activeTab?: string) => void
  refresh: () => Promise<void>
  connect: (id: string) => Promise<boolean>
  /** Connect if needed and expand the connection's schema in the sidebar. */
  openConnection: (id: string) => Promise<void>
  disconnect: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  loadTree: (connId: string, path: string[], force?: boolean) => Promise<void>
  toggle: (key: string, open?: boolean) => void

  openTable: (connId: string, ref: TableRef) => void
  openQuery: (connId: string, sql?: string, schema?: string) => void
  openDatabase: (connId: string, schema?: string) => void
  closeTab: (id: string) => void
  closeTabs: (ids: string[]) => void
  schemaChanged: (connId: string, schema?: string) => void
  closeConnectionTabs: (connId: string) => void
  setActive: (id: string) => void
  updateTab: (id: string, patch: Partial<Tab>) => void
}

export const treeKey = (connId: string, path: string[]) => [connId, ...path].join('\u0000')

export const useWorkspace = create<Workspace>((set, get) => ({
  connections: [],
  loaded: false,
  trees: {},
  expanded: {},
  tabs: [],
  activeTab: '',
  schemaVersion: {},

  init: (tabs, activeTab) => {
    const valid = (tabs as Tab[]).filter((t) => t && t.id && t.connId && ['table', 'query', 'database'].includes(t.kind))
    set({ tabs: valid, activeTab: valid.some((t) => t.id === activeTab) ? activeTab! : '' })
  },

  refresh: async () => {
    const connections = await api.connections()
    set({ connections, loaded: true })
  },

  connect: async (id) => {
    const name = get().connections.find((c) => c.id === id)?.name ?? 'database'
    set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, status: 'connecting', error: undefined } : c)) }))
    try {
      await track(`Connecting to ${name}`, api.connect(id))
      return true
    } catch (e) {
      toast.error(`Couldn't connect to ${name}`, { description: (e as Error).message })
      return false
    } finally {
      await get().refresh()
    }
  },

  openConnection: async (id) => {
    const { toggle, connect, loadTree } = get()
    toggle(id, true)
    const c = get().connections.find((x) => x.id === id)
    if (c?.status !== 'connected' && !(await connect(id))) return toggle(id, false)
    loadTree(id, [])
  },

  disconnect: async (id) => {
    await track('Disconnecting', api.disconnect(id))
    set((s) => ({
      trees: Object.fromEntries(Object.entries(s.trees).filter(([k]) => !k.startsWith(id + '\u0000') && k !== id)),
    }))
    await get().refresh()
  },

  remove: async (id) => {
    await track('Deleting connection', api.deleteConnection(id))
    get().closeConnectionTabs(id)
    await get().refresh()
  },

  loadTree: async (connId, path, force) => {
    const key = treeKey(connId, path)
    const cur = get().trees[key]
    if (cur && (cur.loading || (cur.nodes && !force))) return
    set((s) => ({ trees: { ...s.trees, [key]: { ...cur, loading: true, error: undefined } } }))
    try {
      const nodes = await track('Loading schema', api.tree(connId, path))
      set((s) => ({ trees: { ...s.trees, [key]: { nodes, loading: false } } }))
    } catch (e) {
      set((s) => ({ trees: { ...s.trees, [key]: { loading: false, error: (e as Error).message } } }))
    }
    if (path.length === 0) get().refresh() // status may have changed (connected / error)
  },

  toggle: (key, open) => set((s) => ({ expanded: { ...s.expanded, [key]: open ?? !s.expanded[key] } })),

  openTable: (connId, table) => {
    const existing = get().tabs.find((t) => t.kind === 'table' && t.connId === connId && t.table.schema === table.schema && t.table.table === table.table)
    if (existing) return set({ activeTab: existing.id })
    const tab: Tab = { id: newId(), kind: 'table', connId, title: table.table, table }
    set((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id }))
  },

  openQuery: (connId, sql = '', schema) => {
    const n = get().tabs.filter((t) => t.kind === 'query').length + 1
    const tab: Tab = { id: newId(), kind: 'query', connId, title: `Query ${n}`, sql, schema }
    set((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id }))
  },

  openDatabase: (connId, schema) => {
    const existing = get().tabs.find((t) => t.kind === 'database' && t.connId === connId && (!schema || t.schema === schema))
    if (existing) return set({ activeTab: existing.id })
    const name = get().connections.find((c) => c.id === connId)?.name ?? 'Database'
    const tab: Tab = { id: newId(), kind: 'database', connId, title: schema ?? name, schema }
    set((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id }))
  },

  closeTabs: (ids) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => !ids.includes(t.id))
      return { tabs, activeTab: tabs.some((t) => t.id === s.activeTab) ? s.activeTab : (tabs[tabs.length - 1]?.id ?? '') }
    }),

  schemaChanged: (connId, schema) => {
    set((s) => ({ schemaVersion: { ...s.schemaVersion, [connId]: (s.schemaVersion[connId] ?? 0) + 1 } }))
    get().loadTree(connId, [], true)
    if (schema) get().loadTree(connId, [schema], true)
  },

  closeTab: (id) =>
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeTab = s.activeTab === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? '') : s.activeTab
      return { tabs, activeTab }
    }),

  closeConnectionTabs: (connId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.connId !== connId)
      return { tabs, activeTab: tabs.some((t) => t.id === s.activeTab) ? s.activeTab : '' }
    }),

  setActive: (id) => set({ activeTab: id }),
  updateTab: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) })),
}))

// Persist open tabs (debounced) so reopening KarotX restores them.
let saveTimer: ReturnType<typeof setTimeout> | undefined
useWorkspace.subscribe((s, prev) => {
  if (s.tabs === prev.tabs && s.activeTab === prev.activeTab) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => api.saveWorkspace(s.tabs, s.activeTab).catch(() => {}), 600)
})
