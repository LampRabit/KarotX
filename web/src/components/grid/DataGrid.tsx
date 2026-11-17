import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import type { Column, Value } from '@/lib/api'
import { cn } from '@/lib/cn'

export type RowState = 'new' | 'deleted' | undefined

type Props = {
  columns: Column[]
  rows: Value[][]
  primaryKey?: string[]
  sort?: { column: string; desc: boolean }
  onSort?: (column: string) => void
  editable?: boolean
  onEdit?: (row: number, col: number, value: Value) => void
  rowState?: (row: number) => RowState
  isEdited?: (row: number, col: number) => boolean
  selected?: Set<number>
  onSelect?: (rows: Set<number>) => void
  rowOffset?: number // number shown in the gutter for row 0
}

const ROW_H = 30
const isNumeric = (t: string) => /int|numeric|decimal|float|double|real|money|serial/.test(t)

export const display = (v: Value) => (v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function initialWidths(columns: Column[], rows: Value[][]) {
  return columns.map((c, i) => {
    let max = Math.max(c.name.length + 4, c.type.length)
    for (let r = 0; r < Math.min(rows.length, 50); r++) max = Math.max(max, display(rows[r][i]).length)
    return Math.min(360, Math.max(90, max * 7.4 + 24))
  })
}

export function DataGrid(p: Props) {
  const { columns, rows } = p
  const scrollRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState(() => initialWidths(columns, rows))
  const [active, setActive] = useState<{ r: number; c: number } | null>(null)
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null)

  // Re-measure when the column set changes (new query / table).
  const colKey = columns.map((c) => c.name).join('\u0000')
  useEffect(() => setWidths(initialWidths(columns, rows)), [colKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 12 })
  const template = useMemo(() => `56px ${widths.map((w) => `${w}px`).join(' ')}`, [widths])
  const totalWidth = 56 + widths.reduce((a, b) => a + b, 0)
  const pk = new Set(p.primaryKey ?? [])

  function move(r: number, c: number) {
    r = Math.max(0, Math.min(rows.length - 1, r))
    c = Math.max(0, Math.min(columns.length - 1, c))
    setActive({ r, c })
    v.scrollToIndex(r, { align: 'auto' })
  }

  function startEdit(r: number, c: number) {
    if (!p.editable || p.rowState?.(r) === 'deleted') return
    const val = rows[r][c]
    setEditing({ r, c, value: val === null ? '' : display(val) })
  }

  function commit(value: Value) {
    if (editing) p.onEdit?.(editing.r, editing.c, value)
    setEditing(null)
    scrollRef.current?.focus()
  }

  function onKey(e: KeyboardEvent) {
    if (editing || !active) return
    const { r, c } = active
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(r + 1, c),
      ArrowUp: () => move(r - 1, c),
      ArrowRight: () => move(r, c + 1),
      ArrowLeft: () => move(r, c - 1),
      Enter: () => startEdit(r, c),
      F2: () => startEdit(r, c),
    }
    if (keys[e.key]) {
      e.preventDefault()
      keys[e.key]()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      navigator.clipboard.writeText(display(rows[r][c])).then(() => toast.success('Copied value', { duration: 1200 }))
    }
  }

  function resize(i: number, e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widths[i]
    const onMove = (ev: globalThis.PointerEvent) =>
      setWidths((w) => w.map((x, j) => (j === i ? Math.max(60, startW + ev.clientX - startX) : x)))
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function toggleRow(r: number, additive: boolean) {
    if (!p.onSelect) return
    const next = new Set(additive ? p.selected : [])
    if (next.has(r)) next.delete(r)
    else next.add(r)
    p.onSelect(next)
  }

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="grid"
      aria-rowcount={rows.length}
      aria-colcount={columns.length}
      onKeyDown={onKey}
      className="relative h-full overflow-auto font-mono text-[12.5px] outline-none"
    >
      <div style={{ width: totalWidth, minWidth: '100%' }}>
        {/* Header */}
        <div role="row" className="sticky top-0 z-10 grid border-b bg-sidebar font-sans" style={{ gridTemplateColumns: template }}>
          <div className="sticky left-0 z-10 border-r bg-sidebar" />
          {columns.map((col, i) => {
            const sorted = p.sort?.column === col.name
            return (
              <div key={col.name + i} role="columnheader" aria-sort={sorted ? (p.sort!.desc ? 'descending' : 'ascending') : undefined} className="relative border-r">
                <button
                  onClick={() => p.onSort?.(col.name)}
                  disabled={!p.onSort}
                  className="flex h-11 w-full flex-col justify-center px-2.5 text-left transition hover:bg-muted disabled:hover:bg-transparent"
                >
                  <span className="flex items-center gap-1 text-[12.5px] font-semibold">
                    {pk.has(col.name) && <KeyRound size={12} className="shrink-0 text-warning" aria-label="Primary key" />}
                    <span className="truncate">{col.name}</span>
                    {sorted && (p.sort!.desc ? <ArrowDown size={12} className="shrink-0 text-primary" /> : <ArrowUp size={12} className="shrink-0 text-primary" />)}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">{col.type || '—'}</span>
                </button>
                <span onPointerDown={(e) => resize(i, e)} aria-hidden className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-primary/30" />
              </div>
            )
          })}
        </div>

        {/* Rows */}
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vr) => {
            const r = vr.index
            const state = p.rowState?.(r)
            const isSel = p.selected?.has(r)
            return (
              <div
                key={vr.key}
                role="row"
                aria-selected={isSel || undefined}
                className={cn(
                  'absolute inset-x-0 grid border-b border-border/60',
                  state === 'new' && 'bg-success/[0.07]',
                  state === 'deleted' && 'bg-destructive/[0.07] text-muted-foreground line-through',
                  isSel && 'bg-primary/10',
                  !state && !isSel && 'hover:bg-muted/50',
                )}
                style={{ top: vr.start, height: ROW_H, gridTemplateColumns: template }}
              >
                <button
                  tabIndex={-1}
                  onClick={(e) => toggleRow(r, e.ctrlKey || e.metaKey || e.shiftKey)}
                  className={cn('sticky left-0 border-r bg-sidebar px-2 text-right font-sans text-[11px] text-muted-foreground tabular-nums', isSel && 'bg-primary/15 text-foreground')}
                  aria-label={`Select row ${r + 1 + (p.rowOffset ?? 0)}`}
                >
                  {state === 'new' ? '+' : r + 1 + (p.rowOffset ?? 0)}
                </button>
                {columns.map((col, c) => {
                  const val = rows[r][c]
                  const isActive = active?.r === r && active?.c === c
                  const edited = p.isEdited?.(r, c)
                  if (editing && editing.r === r && editing.c === c) {
                    return <CellEditor key={c} initial={editing.value} onCommit={commit} onCancel={() => (setEditing(null), scrollRef.current?.focus())} />
                  }
                  return (
                    <div
                      key={c}
                      role="gridcell"
                      onClick={() => setActive({ r, c })}
                      onDoubleClick={() => startEdit(r, c)}
                      title={val !== null && display(val).length > 40 ? display(val).slice(0, 2000) : undefined}
                      className={cn(
                        'flex items-center truncate border-r border-border/60 px-2.5',
                        isNumeric(col.type) && 'justify-end tabular-nums',
                        edited && 'bg-warning/15',
                        isActive && 'outline-2 -outline-offset-2 outline-primary',
                      )}
                    >
                      {val === null ? <span className="font-sans text-[11px] text-muted-foreground/70 italic">NULL</span> : <span className="truncate">{display(val)}</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CellEditor({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: Value) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="relative z-20 flex items-center bg-surface outline-2 -outline-offset-2 outline-primary">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(value)
          if (e.key === 'Escape') onCancel()
          e.stopPropagation()
        }}
        aria-label="Edit value"
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 outline-none"
      />
      <button
        onMouseDown={(e) => (e.preventDefault(), onCommit(null))}
        title="Set to NULL"
        className="mr-1 rounded px-1 font-sans text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        NULL
      </button>
    </div>
  )
}
