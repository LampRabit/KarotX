import { useCallback, useMemo, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { ConnView } from '@/lib/api'
import { modKey } from '@/lib/hooks'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { Button } from '../ui/Button'
import { Kbd } from '../ui/Kbd'
import { Results } from './Results'
import { SqlEditor } from './SqlEditor'
import { useElapsed, useQueryRunner } from './useQueryRunner'

export { ErrorPanel } from './Results'

type QTab = Extract<Tab, { kind: 'query' }>

/** Table → columns from whatever schema the sidebar has loaded, for autocomplete. */
export function useSchema(connId: string, schema?: string) {
  const trees = useWorkspace((s) => s.trees)
  return useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const [key, entry] of Object.entries(trees)) {
      if (!key.startsWith(connId) || !entry.nodes) continue
      for (const n of entry.nodes) {
        if (schema && n.path[0] !== schema && n.path.length > 1) continue
        if (n.kind === 'table' || n.kind === 'view') out[n.name] ??= []
        if (n.kind === 'column') (out[n.path[n.path.length - 2]] ??= []).push(n.name)
      }
    }
    return out
  }, [trees, connId, schema])
}

/** Run the editor's selection, or the whole text. */
export function selectionOr(ref: React.RefObject<ReactCodeMirrorRef | null>, all: string) {
  const view = ref.current?.view
  const sel = view?.state.selection.main
  return sel && !sel.empty ? view!.state.sliceDoc(sel.from, sel.to) : all
}

export function QueryTab({ tab, conn }: { tab: QTab; conn: ConnView }) {
  const updateTab = useWorkspace((s) => s.updateTab)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const runner = useQueryRunner(conn, tab.schema)
  const [split, setSplit] = useState(45) // editor height %
  const elapsed = useElapsed(!!runner.running)
  const schema = useSchema(conn.id, tab.schema)
  const onRun = useCallback(() => runner.run(selectionOr(editorRef, tab.sql)), [runner, tab.sql])

  function dragSplit(e: React.PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.parentElement!.getBoundingClientRect()
    const onMove = (ev: PointerEvent) => setSplit(Math.min(80, Math.max(15, ((ev.clientY - box.top) / box.height) * 100)))
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {runner.running ? (
          <Button size="sm" variant="secondary" onClick={runner.stop}>
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
        <div className="ml-auto flex items-center gap-2">
          <AnimatePresence>
            {runner.running && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="status" className="text-xs text-muted-foreground tabular-nums">
                Running… {(elapsed / 1000).toFixed(1)}s
              </motion.span>
            )}
          </AnimatePresence>
          {tab.schema && <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">{tab.schema}</span>}
          {conn.production && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">PRODUCTION{conn.readOnly ? ' · READ-ONLY' : ''}</span>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div style={{ height: `${split}%` }} className="min-h-0">
          <SqlEditor editorRef={editorRef} value={tab.sql} onChange={(sql) => updateTab(tab.id, { sql })} dialect={conn.driver} schema={schema} onRun={onRun} />
        </div>
        <div onPointerDown={dragSplit} role="separator" aria-orientation="horizontal" aria-label="Resize editor" className="h-1.5 shrink-0 cursor-row-resize border-y bg-sidebar transition hover:bg-primary/30" />
        <div className="min-h-0 flex-1">
          <Results results={runner.results} active={runner.active} setActive={runner.setActive} error={runner.error} running={!!runner.running} />
        </div>
      </div>
      {runner.confirmDialog}
    </div>
  )
}
