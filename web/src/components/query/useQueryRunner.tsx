import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, newId, type ConnView, type Result } from '@/lib/api'
import { track } from '@/lib/activity'
import { useWorkspace } from '@/lib/workspace'
import { Confirm } from '../ui/Confirm'

/**
 * Runs SQL against a connection: tracks progress, supports Stop, and asks
 * for confirmation on production connections. Render `confirmDialog`.
 */
export function useQueryRunner(conn: ConnView, schema?: string) {
  const refresh = useWorkspace((s) => s.refresh)
  const schemaChanged = useWorkspace((s) => s.schemaChanged)
  const [results, setResults] = useState<Result[]>()
  const [active, setActive] = useState(0)
  const [error, setError] = useState('')
  const [running, setRunning] = useState<string>()
  const [confirm, setConfirm] = useState<{ sql: string; statements: string[] }>()

  const run = useCallback(async (sql: string, confirmed = false) => {
    if (!sql.trim() || running) return
    const qid = newId()
    setRunning(qid)
    setError('')
    try {
      const res = await track('Running query', api.query(conn.id, sql, qid, confirmed, schema))
      setResults(res)
      const firstErr = res.findIndex((r) => r.error)
      setActive(firstErr >= 0 ? firstErr : Math.max(0, res.findLastIndex((r) => r.columns)))
      // DDL changes the schema: refresh the sidebar and open views.
      if (/\b(create|alter|drop|rename|truncate)\b/i.test(sql)) schemaChanged(conn.id, schema)
    } catch (e) {
      const err = e as ApiError
      if (err.data?.needsConfirmation) setConfirm({ sql, statements: err.data.statements ?? [] })
      else setError(err.message)
    } finally {
      setRunning(undefined)
      refresh()
    }
  }, [conn.id, schema, running, refresh, schemaChanged])

  const stop = useCallback(() => running && api.cancel(running), [running])
  const clear = useCallback(() => (setResults(undefined), setError('')), [])

  const confirmDialog = (
    <Confirm
      open={!!confirm}
      onOpenChange={(o) => !o && setConfirm(undefined)}
      title="Run on production?"
      confirmLabel="Run anyway"
      danger
      onConfirm={() => run(confirm!.sql, true)}
    >
      <p>{conn.name} is marked as production. These statements change or remove data:</p>
      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">{confirm?.statements.join(';\n\n')}</pre>
    </Confirm>
  )

  return { run, stop, clear, results, active, setActive, error, running, confirmDialog }
}

export function useElapsed(running: boolean) {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    if (!running) return
    const start = performance.now()
    setMs(0)
    const t = setInterval(() => setMs(performance.now() - start), 100)
    return () => clearInterval(t)
  }, [running])
  return ms
}
