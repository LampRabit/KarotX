import { create } from 'zustand'
import type { TableRef } from './api'

/** App-wide dialogs that can be opened from anywhere (tree, tabs, menus, palette). */
export type DialogState =
  | { kind: 'table-designer'; connId: string; schema: string; table?: string }
  | { kind: 'create-database'; connId: string }
  | { kind: 'drop'; connId: string; what: 'table' | 'view' | 'database'; schema: string; table?: string }
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
