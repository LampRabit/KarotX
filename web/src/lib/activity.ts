import { useSyncExternalStore } from 'react'

/** Global registry of in-flight operations, shown in the status bar and top progress bar. */
export type Operation = { id: number; label: string; started: number }

let ops: Operation[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function track<T>(label: string, work: Promise<T>): Promise<T> {
  const op = { id: nextId++, label, started: Date.now() }
  ops = [...ops, op]
  emit()
  return work.finally(() => {
    ops = ops.filter((o) => o.id !== op.id)
    emit()
  })
}

export function useActivity(): Operation[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => ops,
  )
}
