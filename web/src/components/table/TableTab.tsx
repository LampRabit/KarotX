import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Filter, Lock, Plus, RefreshCw, Square, Trash2, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { api, ApiError, newId, type Change, type ConnView, type Result, type Value } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { useDelayed } from '@/lib/hooks'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { DataGrid } from '../grid/DataGrid'
import { ErrorPanel } from '../query/QueryTab'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Skeleton } from '../ui/Skeleton'
import { Spinner } from '../ui/Spinner'
import { Tooltip } from '../ui/Tooltip'

type TTab = Extract<Tab, { kind: 'table' }>
const PAGE = 200

export function TableTab({ tab, conn }: { tab: TTab; conn: ConnView }) {
  const refreshConns = useWorkspace((s) => s.refresh)
  const [data, setData] = useState<Result>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<string>() // query id
  const [offset, setOffset] = useState(0)
  const [sort, setSort] = useState<{ column: string; desc: boolean }>()
  const [whereInput, setWhereInput] = useState('')
  const [where, setWhere] = useState('')
  const [edits, setEdits] = useState<Map<number, Record<string, Value>>>(new Map())
  const [deleted, setDeleted] = useState<Set<number>>(new Set())
  const [inserts, setInserts] = useState<Record<string, Value>[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [review, setReview] = useState<string[]>()
  const showSpinner = useDelayed(!!loading, 150)

  const pending = edits.size + deleted.size + inserts.length
  const columns = data?.columns ?? []
  const base = data?.rows ?? []
  const pk = data?.primaryKey ?? []
  const canEdit = !conn.readOnly && pk.length > 0

  const discard = () => (setEdits(new Map()), setDeleted(new Set()), setInserts([]), setSelected(new Set()))

  const load = useCallback(async () => {
    const qid = newId()
    setLoading(qid)
    setError('')
    try {
      const res = await track(`Loading ${tab.table.table}`, api.browse(conn.id, {
        ...tab.table, offset, limit: PAGE, orderBy: sort?.column, desc: sort?.desc, where, queryId: qid,
      }))
      setData(res)
      discard()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(undefined)
      refreshConns()
    }
  }, [conn.id, tab.table, offset, sort, where, refreshConns])

  useEffect(() => void load(), [load])

  const rows = useMemo(
    () => [
      ...base.map((row, r) => {
        const e = edits.get(r)
        return e ? row.map((v, c) => (columns[c].name in e ? e[columns[c].name] : v)) : row
      }),
      ...inserts.map((ins) => columns.map((c) => ins[c.name] ?? null)),
    ],
    [base, edits, inserts, columns],
  )

  function onEdit(r: number, c: number, value: Value) {
    const col = columns[c].name
    if (r >= base.length) {
      setInserts((list) => list.map((ins, i) => (i === r - base.length ? { ...ins, [col]: value } : ins)))
      return
    }
    setEdits((prev) => {
      const next = new Map(prev)
      const rowEdits = { ...next.get(r) }
      // Compare as text: the grid edits strings, the database returned typed values.
      if (String(value) === String(base[r][c]) && (value === null) === (base[r][c] === null)) delete rowEdits[col]
      else rowEdits[col] = value
      if (Object.keys(rowEdits).length) next.set(r, rowEdits)
      else next.delete(r)
      return next
    })
  }

  function deleteSelected() {
    const drop = [...selected]
    setInserts((list) => list.filter((_, i) => !selected.has(i + base.length)))
    setDeleted((d) => new Set([...d, ...drop.filter((r) => r < base.length)]))
    setSelected(new Set())
  }

  const keyOf = (r: number) => Object.fromEntries(pk.map((k) => [k, base[r][columns.findIndex((c) => c.name === k)]]))

  function changes(): Change[] {
    return [
      ...[...edits].filter(([r]) => !deleted.has(r)).map(([r, values]) => ({ kind: 'update' as const, key: keyOf(r), values })),
      ...[...deleted].map((r) => ({ kind: 'delete' as const, key: keyOf(r) })),
      ...inserts.map((values) => ({ kind: 'insert' as const, values })),
    ]
  }

  async function openReview() {
    try {
      setReview(await track('Preparing changes', api.apply(conn.id, tab.table, changes(), true)))
    } catch (e) {
      toast.error('Could not prepare the changes', { description: (e as Error).message })
    }
  }

  async function save() {
    try {
      await track('Saving changes', api.apply(conn.id, tab.table, changes(), false, conn.production))
      toast.success(`Saved ${pending} ${pending === 1 ? 'change' : 'changes'}`, { description: `${tab.table.table}` })
      setReview(undefined)
      load()
    } catch (e) {
      toast.error('Nothing was saved', { description: (e as ApiError).message })
    }
  }

  const sortBy = (column: string) => {
    setOffset(0)
    setSort((s) => (s?.column !== column ? { column, desc: false } : !s.desc ? { column, desc: true } : undefined))
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Tooltip content="Reload">
          <button onClick={load} aria-label="Reload" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
            {showSpinner ? <Spinner size={15} className="text-primary" /> : <RefreshCw size={15} />}
          </button>
        </Tooltip>
        {loading && showSpinner && (
          <Button size="sm" variant="ghost" onClick={() => api.cancel(loading)}>
            <Square size={12} className="fill-current text-destructive" aria-hidden /> Stop
          </Button>
        )}
        <form onSubmit={(e) => (e.preventDefault(), setOffset(0), setWhere(whereInput))} className="relative max-w-md flex-1">
          <Filter size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={whereInput}
            onChange={(e) => setWhereInput(e.target.value)}
            placeholder="Filter rows, e.g. status = 'active'  (press Enter)"
            aria-label="Filter rows (SQL condition)"
            className={cn('h-8 w-full rounded-lg border bg-background pr-2 pl-8 font-mono text-[12.5px] outline-none transition focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 focus-visible:outline-none', where && 'border-primary/50')}
          />
        </form>

        <div className="ml-auto flex items-center gap-1.5">
          {!canEdit && data && (
            <Tooltip content={conn.readOnly ? 'This connection is read-only.' : 'This table has no primary key, so rows cannot be edited safely.'}>
              <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"><Lock size={12} aria-hidden /> Read-only</span>
            </Tooltip>
          )}
          {canEdit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setInserts((l) => [...l, {}])}><Plus size={14} aria-hidden /> Row</Button>
              <Button size="sm" variant="ghost" onClick={deleteSelected} disabled={selected.size === 0}><Trash2 size={14} aria-hidden /> Delete{selected.size > 0 ? ` (${selected.size})` : ''}</Button>
            </>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="relative min-h-0 flex-1">
        {error ? (
          <ErrorPanel message={error} />
        ) : !data ? (
          <div className="space-y-px p-0" role="status" aria-label="Loading rows">
            <Skeleton className="h-11 rounded-none" />
            {[...Array(14)].map((_, i) => <Skeleton key={i} className="h-[30px] rounded-none opacity-70" />)}
          </div>
        ) : (
          <div className={cn('h-full transition-opacity duration-200', loading && 'opacity-60')}>
            {rows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
                <p className="font-medium text-foreground">No rows</p>
                <p className="text-[13px]">{where ? 'Nothing matches this filter.' : 'This table is empty.'}</p>
              </div>
            ) : (
              <DataGrid
                columns={columns}
                rows={rows}
                primaryKey={pk}
                sort={sort}
                onSort={sortBy}
                editable={canEdit}
                onEdit={onEdit}
                rowState={(r) => (r >= base.length ? 'new' : deleted.has(r) ? 'deleted' : undefined)}
                isEdited={(r, c) => !!edits.get(r) && columns[c].name in edits.get(r)!}
                selected={selected}
                onSelect={setSelected}
                rowOffset={offset}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer: paging + pending changes */}
      <footer className="flex h-10 shrink-0 items-center gap-3 border-t bg-sidebar px-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <button disabled={offset === 0 || !!loading} onClick={() => setOffset((o) => Math.max(0, o - PAGE))} aria-label="Previous page" className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40">
            <ChevronLeft size={15} />
          </button>
          <span className="tabular-nums">{base.length ? `Rows ${(offset + 1).toLocaleString()}–${(offset + base.length).toLocaleString()}` : 'No rows'}</span>
          <button disabled={!data?.truncated || !!loading} onClick={() => setOffset((o) => o + PAGE)} aria-label="Next page" className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40">
            <ChevronRight size={15} />
          </button>
        </div>
        {data && <span>{data.durationMs.toFixed(1)} ms</span>}
        {canEdit && pending === 0 && data && <span className="hidden md:inline">Double-click a cell to edit</span>}

        <AnimatePresence>
          {pending > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="ml-auto flex items-center gap-2">
              <span className="font-medium text-warning">{pending} unsaved {pending === 1 ? 'change' : 'changes'}</span>
              <Button size="sm" variant="ghost" onClick={discard}><Undo2 size={13} aria-hidden /> Discard</Button>
              <Button size="sm" onClick={openReview}>Review &amp; save</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </footer>

      <ReviewDialog statements={review} production={!!conn.production} onClose={() => setReview(undefined)} onSave={save} />
    </div>
  )
}

function ReviewDialog({ statements, production, onClose, onSave }: { statements?: string[]; production: boolean; onClose: () => void; onSave: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState(false)
  useEffect(() => setAck(false), [statements])
  return (
    <Dialog open={!!statements} onOpenChange={(o) => !o && !busy && onClose()} title="Review changes" className="max-w-2xl">
      <div className="space-y-4 p-6">
        <div>
          <h2 className="text-[15px] font-semibold">Review changes</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">These statements run in one transaction. If any of them fails, nothing is saved.</p>
        </div>
        <pre className="max-h-80 overflow-auto rounded-xl border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {statements?.map((s) => s + ';').join('\n')}
        </pre>
        {production && (
          <label className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3 text-[13px]">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[var(--destructive)]" />
            <span><span className="font-medium text-destructive">This is a production database.</span> I have checked these changes.</span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={production ? 'danger' : 'primary'}
            loading={busy}
            disabled={production && !ack}
            onClick={async () => { setBusy(true); try { await onSave() } finally { setBusy(false) } }}
          >
            Save {statements?.length} {statements?.length === 1 ? 'change' : 'changes'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
