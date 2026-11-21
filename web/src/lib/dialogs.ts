import { create } from 'zustand'
import type { TableRef } from './api'

/**
 * App-wide dialogs that can be opened from anywhere (tree, tabs, menus, palette).
 * `database` targets another database on a Postgres server; omitted = the connection's own.
 */
export type DialogState =
  | { kind: 'table-designer'; connId: string; schema: string; table?: string; database?: string }
  /** MySQL: new database. Postgres: new schema inside `database`, or with `server`, a new database. */
  | { kind: 'create-database'; connId: string; database?: string; server?: boolean }
  /** `schema` holds the dropped container's name for what = 'schema' | 'database'. */
  | { kind: 'drop'; connId: string; what: 'table' | 'view' | 'schema' | 'database'; schema: string; table?: string; database?: string }
  | { kind: 'empty-table'; connId: string; ref: TableRef }
  | { kind: 'palette' }
  | { kind: 'shortcuts' }
  | null

export const useDialogs = create<{ dialog: DialogState; open: (d: DialogState) => void; close: () => void }>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}))

export const openDialog = (d: DialogState) => useDialogs.getState().open(d)
