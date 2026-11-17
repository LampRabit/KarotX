import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Play, Square, TerminalSquare } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { api, ApiError, newId, type ConnView, type Result } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { modKey } from '@/lib/hooks'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { DataGrid } from '../grid/DataGrid'
import { Button } from '../ui/Button'
import { Confirm } from '../ui/Confirm'
import { Kbd } from '../ui/Kbd'
import { Skeleton } from '../ui/Skeleton'
import { SqlEditor } from './SqlEditor'

type QTab = Extract<Tab, { kind: 'query' }>

/** Table → columns from whatever schema the sidebar has loaded, for autocomplete. */
function useSchema(connId: string) {
  const trees = useWorkspace((s) => s.trees)
  return useMemo(() => {
    const schema: Record<string, string[]> = {}
    for (const [key, entry] of Object.entries(trees)) {
      if (!key.startsWith(connId) || !entry.nodes) continue
      for (const n of entry.nodes) {
        if (n.kind === 'table' || n.kind === 'view') schema[n.name] ??= []
        if (n.kind === 'column') (schema[n.path[n.path.length - 2]] ??= []).push(n.name)
      }
    }
    return schema
  }, [trees, connId])
}

function useElapsed(running: boolean) {
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

export function QueryTab({ tab, conn }: { tab: QTab; conn: ConnView }) {
  const updateTab = useWorkspace((s) => s.updateTab)
  const refresh = useWorkspace((s) => s.refresh)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const [results, setResults] = useState<Result[]>()
  const [active, setActive] = useState(0)
  const [error, setError] = useState('')
  const [running, setRunning] = useState<string>() // query id
  const [confirm, setConfirm] = useState<{ sql: string; statements: string[] }>()
  const [split, setSplit] = useState(45) // editor height %
  const elapsed = useElapsed(!!running)
  const schema = useSchema(conn.id)

  const run = useCallback(async (sqlOverride?: string, confirmed = false) => {
    const view = editorRef.current?.view
    const sel = view?.state.selection.main
    const sql = sqlOverride ?? (sel && !sel.empty ? view!.state.sliceDoc(sel.from, sel.to) : tab.sql)
    if (!sql.trim() || running) return
    const qid = newId()
    setRunning(qid)
    setError('')
    try {
      const res = await track('Running query', api.query(conn.id, sql, qid, confirmed))
      setResults(res)
      const firstErr = res.findIndex((r) => r.error)
      setActive(firstErr >= 0 ? firstErr : Math.max(0, res.findLastIndex((r) => r.columns)))
    } catch (e) {
      const err = e as ApiError
      if (err.data?.needsConfirmation) setConfirm({ sql, statements: err.data.statements ?? [] })
      else setError(err.message)
    } finally {
      setRunning(undefined)
      refresh()
    }
  }, [conn.id, tab.sql, running, refresh])

  const onRun = useCallback(() => run(), [run])

  function dragSplit(e: React.PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.parentElement!.getBoundingClientRect()
    const onMove = (ev: PointerEvent) => setSplit(Math.min(80, Math.max(15, ((ev.clientY - box.top) / box.height) * 100)))
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const r = results?.[active]

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => api.cancel(running)}>
            <Square size={13} className="fill-current text-destructive" aria-hidden /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={onRun} disabled={!tab.sql.trim()}>
            <Play size={13} className="fill-current" aria-hidden /> Run
          </Button>
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Kbd>{modKey}</Kbd><Kbd>Enter</Kbd> runs the selection, or everything
        </span>
        <AnimatePresence>
          {running && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="status" className="ml-auto text-xs text-muted-foreground tabular-nums">
              Running… {(elapsed / 1000).toFixed(1)}s
            </motion.span>
          )}
        </AnimatePresence>
        {conn.production && <span className="ml-auto rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">PRODUCTION{conn.readOnly ? ' · READ-ONLY' : ''}</span>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div style={{ height: `${split}%` }} className="min-h-0">
          <SqlEditor
            editorRef={editorRef}
            value={tab.sql}
            onChange={(sql) => updateTab(tab.id, { sql })}
            dialect={conn.driver}
            schema={schema}
            onRun={onRun}
          />
        </div>
        <div onPointerDown={dragSplit} role="separator" aria-orientation="horizontal" aria-label="Resize editor" className="h-1.5 shrink-0 cursor-row-resize border-y bg-sidebar transition hover:bg-primary/30" />

        <div className="flex min-h-0 flex-1 flex-col">
          {results && results.length > 1 && (
            <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
              {results.map((res, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === active}
                  onClick={() => setActive(i)}
                  className={cn('flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap transition', i === active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60')}
                >
                  {res.error ? <AlertCircle size={13} className="text-destructive" /> : <CheckCircle2 size={13} className="text-success" />}
                  {res.columns ? `Result ${i + 1}` : `Statement ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {running && !results ? (
              <div className="space-y-2 p-4" aria-label="Running query" role="status">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-5" />)}
              </div>
            ) : error ? (
              <ErrorPanel message={error} />
            ) : !r ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <TerminalSquare size={28} aria-hidden />
                <p>Results will appear here.</p>
              </div>
            ) : r.error ? (
              <ErrorPanel message={r.error} statement={r.statement} />
            ) : r.columns ? (
              <div className={cn('h-full transition-opacity', running && 'opacity-50')}>
                <DataGrid columns={r.columns} rows={r.rows ?? []} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-success">
                <CheckCircle2 size={18} aria-hidden />
                <span>{r.rowsAffected !== undefined ? `${r.rowsAffected.toLocaleString()} ${r.rowsAffected === 1 ? 'row' : 'rows'} affected` : 'Done'}</span>
              </div>
            )}
          </div>

          {r && !r.error && (
            <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
              {r.columns && <span>{(r.rows?.length ?? 0).toLocaleString()} rows{r.truncated ? ' (first 1,000 shown)' : ''}</span>}
              <span>{r.durationMs.toFixed(1)} ms</span>
              <span className="ml-auto truncate font-mono" title={r.statement}>{r.statement.split('\n')[0]}</span>
            </footer>
          )}
        </div>
      </div>

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
    </div>
  )
}

export function ErrorPanel({ message, statement }: { message: string; statement?: string }) {
  return (
    <div role="alert" className="m-4 rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4">
      <p className="flex items-center gap-2 font-medium text-destructive"><AlertCircle size={16} aria-hidden /> The query failed</p>
      <p className="mt-1.5 font-mono text-[13px] break-words whitespace-pre-wrap">{message}</p>
      {statement && <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-background p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{statement}</pre>}
    </div>
  )
}
