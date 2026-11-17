import { useRef, useState } from 'react'
import { ArrowUp, Maximize2, Minimize2, Square } from 'lucide-react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { DriverName } from '@/lib/api'
import { cn } from '@/lib/cn'
import { modKey } from '@/lib/hooks'
import { selectionOr } from '../query/QueryTab'
import { SqlEditor } from '../query/SqlEditor'
import { Tooltip } from '../ui/Tooltip'

type Props = {
  value: string
  onChange: (v: string) => void
  onRun: (sql: string) => void
  onStop: () => void
  running: boolean
  dialect: DriverName
  schema: Record<string, string[]>
  scopeLabel: string
  elapsed: number
}

/**
 * Prompt-style SQL box pinned to the bottom of a database tab. Starts as a
 * single line and grows with its content; drag the top edge or use the
 * expand button for more room.
 */
export function QueryComposer(p: Props) {
  const ref = useRef<ReactCodeMirrorRef>(null)
  const [maxH, setMaxH] = useState(200)
  const big = maxH > 320

  function drag(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY
    const start = maxH
    const onMove = (ev: PointerEvent) => setMaxH(Math.min(window.innerHeight * 0.7, Math.max(60, start + startY - ev.clientY)))
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const run = () => p.onRun(selectionOr(ref, p.value))

  return (
    <div className="shrink-0 px-4 pt-1 pb-3">
      <div className="group relative rounded-2xl border bg-surface shadow-[var(--shadow)] transition focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-primary/15">
        <div
          onPointerDown={drag}
          role="separator"
          aria-label="Drag to resize the query box"
          className="absolute -top-1.5 left-1/2 h-3 w-16 -translate-x-1/2 cursor-row-resize"
        >
          <span className="mx-auto mt-1 block h-1 w-10 rounded-full bg-border opacity-0 transition group-hover:opacity-100" />
        </div>
        <div className="flex items-end gap-2 py-2 pr-2 pl-3">
          <div className="min-w-0 flex-1">
            <SqlEditor
              editorRef={ref}
              value={p.value}
              onChange={p.onChange}
              dialect={p.dialect}
              schema={p.schema}
              onRun={run}
              compact={{ minHeight: big ? `${maxH}px` : '26px', maxHeight: `${maxH}px` }}
              placeholder={`Type SQL to run in ${p.scopeLabel}…`}
            />
          </div>
          <Tooltip content={big ? 'Shrink' : 'Expand'}>
            <button
              onClick={() => setMaxH(big ? 200 : Math.round(window.innerHeight * 0.55))}
              aria-label={big ? 'Shrink query box' : 'Expand query box'}
              className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {big ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </Tooltip>
          {p.running ? (
            <Tooltip content="Stop">
              <button onClick={p.onStop} aria-label="Stop query" className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-85">
                <Square size={12} className="fill-current" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={`Run (${modKey} + Enter)`}>
              <button
                onClick={run}
                disabled={!p.value.trim()}
                aria-label="Run query"
                className={cn('mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:brightness-110 disabled:bg-muted disabled:text-muted-foreground')}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      <p className="mt-1.5 flex items-center gap-3 px-2 text-[11px] text-muted-foreground">
        <span>Runs in <span className="font-mono">{p.scopeLabel}</span></span>
        <span>{modKey}+Enter to run · select text to run just that part</span>
        {p.running && <span className="ml-auto text-primary tabular-nums" role="status">Running… {(p.elapsed / 1000).toFixed(1)}s</span>}
      </p>
    </div>
  )
}
