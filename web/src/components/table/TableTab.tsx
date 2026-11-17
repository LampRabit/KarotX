import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Eraser, FileCode2, KeyRound, Lock, MoreHorizontal, Pencil, Plus, RefreshCw, Square, Table2, Trash2, Undo2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { api, ApiError, newId, type Change, type ColumnInfo, type ConnView, type Result, type Value } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { q, selectSql } from '@/lib/ddl'
import { openDialog } from '@/lib/dialogs'
import { useDelayed } from '@/lib/hooks'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { DataGrid, display } from '../grid/DataGrid'
import { ErrorPanel } from '../query/Results'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Kbd } from '../ui/Kbd'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu'
import { Segmented } from '../ui/Segmented'
import { Skeleton } from '../ui/Skeleton'
import { Spinner } from '../ui/Spinner'
import { Tooltip } from '../ui/Tooltip'

type TTab = Extract<Tab, { kind: 'table' }>
const PAGE = 200

export function TableTab({ tab, conn }: { tab: TTab; conn: ConnView }) {
  const refreshConns = useWorkspace((s) => s.refresh)
  const openQuery = useWorkspace((s) => s.openQuery)
  const version = useWorkspace((s) => s.schemaVersion[conn.id] ?? 0)
  const [view, setView] = useState<'data' | 'structure'>('data')
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
  const filterRef = useRef<HTMLInputElement>(null)
  const showSpinner = useDelayed(!!loading, 150)
  const { schema, table } = tab.table

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
      const res = await track(`Loading ${table}`, api.browse(conn.id, { ...tab.table, offset, limit: PAGE, orderBy: sort?.column, desc: sort?.desc, where, queryId: qid }))
      setData(res)
      discard()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(undefined)
      refreshConns()
    }
  }, [conn.id, tab.table, table, offset, sort, where, refreshConns])

  useEffect(() => void load(), [load, version])

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

  function deleteRows(list: number[]) {
    if (!canEdit) return
    const drop = new Set(list)
    setInserts((ins) => ins.filter((_, i) => !drop.has(i + base.length)))
    setDeleted((d) => new Set([...d, ...list.filter((r) => r < base.length)]))
    setSelected(new Set())
  }

  const keyOf = (r: number) => Object.fromEntries(pk.map((k) => [k, base[r][columns.findIndex((c) => c.name === k)]]))
  const changes = (): Change[] => [
    ...[...edits].filter(([r]) => !deleted.has(r)).map(([r, values]) => ({ kind: 'update' as const, key: keyOf(r), values })),
    ...[...deleted].map((r) => ({ kind: 'delete' as const, key: keyOf(r) })),
    ...inserts.map((values) => ({ kind: 'insert' as const, values })),
  ]

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
      toast.success(`Saved ${pending} ${pending === 1 ? 'change' : 'changes'}`, { description: table })
      setReview(undefined)
      load()
    } catch (e) {
      toast.error('Nothing was saved', { description: (e as ApiError).message })
    }
  }

  function applyFilter(w: string) {
    setWhereInput(w)
    setOffset(0)
    setWhere(w)
  }

  const filterBy = (column: string, value: Value) =>
    applyFilter(`${q(conn.driver, column)} ${value === null ? 'IS NULL' : `= '${display(value).replace(/'/g, "''")}'`}`)

  const sortBy = (column: string) => {
    setOffset(0)
    setSort((s) => (s?.column !== column ? { column, desc: false } : !s.desc ? { column, desc: true } : undefined))
  }

  // Tab-level shortcuts: Ctrl+F focuses the filter, Ctrl+S reviews changes, Alt+R reloads.
  function onKey(e: React.KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key === 'f') (e.preventDefault(), setView('data'), setTimeout(() => filterRef.current?.focus()))
    else if (mod && e.key === 's') (e.preventDefault(), pending && openReview())
    else if (e.altKey && e.key.toLowerCase() === 'r') (e.preventDefault(), load())
  }

  return (
    <div className="flex h-full flex-col" onKeyDown={onKey}>
      {/* Title bar */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Table2 size={16} aria-hidden /></span>
        <div className="min-w-0 leading-tight">
          <h2 className="truncate font-semibold">{table}</h2>
          <p className="truncate text-xs text-muted-foreground">{conn.driver === 'sqlite' ? conn.name : `${schema} · ${conn.name}`}</p>
        </div>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'data', label: 'Data' }, { value: 'structure', label: 'Structure' }]} className="ml-3" />
        <div className="ml-auto flex items-center gap-1">
          {!canEdit && data && (
            <Tooltip content={conn.readOnly ? 'This connection is read-only.' : 'This table has no primary key, so rows cannot be edited safely.'}>
              <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"><Lock size={12} aria-hidden /> Read-only</span>
            </Tooltip>
          )}
          <Menu>
            <MenuTrigger aria-label="Table actions" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <MoreHorizontal size={16} />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<FileCode2 />} onSelect={() => openQuery(conn.id, selectSql(conn.driver, schema, table), schema)}>Query in editor</MenuItem>
              <MenuItem icon={<RefreshCw />} onSelect={load}>Reload <Kbd className="ml-auto">Alt R</Kbd></MenuItem>
              {!conn.readOnly && (
                <>
                  <MenuItem icon={<Pencil />} onSelect={() => openDialog({ kind: 'table-designer', connId: conn.id, schema, table })}>Edit structure…</MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Eraser />} danger onSelect={() => openDialog({ kind: 'empty-table', connId: conn.id, ref: tab.table })}>Empty table…</MenuItem>
                  <MenuItem icon={<Trash2 />} danger onSelect={() => openDialog({ kind: 'drop', connId: conn.id, what: 'table', schema, table })}>Delete table…</MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>

      {view === 'structure' ? (
        <Structure conn={conn} tab={tab} version={version} />
      ) : (
        <>
          {/* Filter + actions */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar/50 px-3">
            <form onSubmit={(e) => (e.preventDefault(), applyFilter(whereInput))} className="flex h-8 max-w-2xl flex-1 items-center rounded-lg border bg-background transition focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15">
              <span className="flex h-full items-center rounded-l-lg border-r bg-muted/60 px-2.5 font-mono text-[11px] font-semibold text-muted-foreground">WHERE</span>
              <input
                ref={filterRef}
                value={whereInput}
                onChange={(e) => setWhereInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && whereInput && (e.stopPropagation(), applyFilter(''))}
                placeholder="status = 'active' AND total > 100"
                aria-label="Filter rows with a SQL condition"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[12.5px] outline-none placeholder:text-muted-foreground/70"
              />
              {whereInput && (
                <button type="button" onClick={() => applyFilter('')} aria-label="Clear filter" className="mr-1 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X size={13} /></button>
              )}
              <button type="submit" className={cn('mr-1 h-6 rounded-md px-2 text-xs font-medium transition', whereInput !== where ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>Apply</button>
            </form>
            {where && <span className="hidden text-xs font-medium text-primary md:inline">Filtered</span>}

            <div className="ml-auto flex items-center gap-1">
              {loading && showSpinner ? (
                <Button size="sm" variant="ghost" onClick={() => api.cancel(loading)}>
                  <Spinner size={13} className="text-primary" /> <Square size={10} className="fill-current text-destructive" aria-hidden /> Stop
                </Button>
              ) : (
                <Tooltip content="Reload (Alt+R)">
                  <button onClick={load} aria-label="Reload" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"><RefreshCw size={15} /></button>
                </Tooltip>
              )}
              {canEdit && (
                <>
                  <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                  <Button size="sm" variant="ghost" onClick={() => setInserts((l) => [...l, {}])}><Plus size={14} aria-hidden /> Add row</Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteRows([...selected])} disabled={selected.size === 0}>
                    <Trash2 size={14} aria-hidden /> Delete{selected.size > 0 ? ` ${selected.size}` : ''}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Grid */}
          <div className="relative min-h-0 flex-1">
            {error ? (
              <ErrorPanel message={error} />
            ) : !data ? (
              <div className="space-y-px" role="status" aria-label="Loading rows">
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
                    onDeleteRows={canEdit ? deleteRows : undefined}
                    onFilterBy={filterBy}
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer: paging + pending changes */}
          <footer className="flex h-10 shrink-0 items-center gap-3 border-t bg-sidebar px-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <button disabled={offset === 0 || !!loading} onClick={() => setOffset((o) => Math.max(0, o - PAGE))} aria-label="Previous page" className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"><ChevronLeft size={15} /></button>
              <span className="tabular-nums">{base.length ? `Rows ${(offset + 1).toLocaleString()}–${(offset + base.length).toLocaleString()}` : 'No rows'}</span>
              <button disabled={!data?.truncated || !!loading} onClick={() => setOffset((o) => o + PAGE)} aria-label="Next page" className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"><ChevronRight size={15} /></button>
            </div>
            {data && <span>{data.durationMs.toFixed(1)} ms</span>}
            {canEdit && pending === 0 && data && <span className="hidden lg:inline">Double-click or Enter to edit · Space selects a row · Del deletes · right-click for more</span>}
            <AnimatePresence>
              {pending > 0 && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="ml-auto flex items-center gap-2">
                  <span className="font-medium text-warning">{pending} unsaved {pending === 1 ? 'change' : 'changes'}</span>
                  <Button size="sm" variant="ghost" onClick={discard}><Undo2 size={13} aria-hidden /> Discard</Button>
                  <Button size="sm" onClick={openReview}>Review &amp; save <Kbd className="border-primary-foreground/30 bg-transparent text-primary-foreground">Ctrl S</Kbd></Button>
                </motion.div>
              )}
            </AnimatePresence>
          </footer>
        </>
      )}

      <ReviewDialog statements={review} production={!!conn.production} onClose={() => setReview(undefined)} onSave={save} />
    </div>
  )
}

function Structure({ conn, tab, version }: { conn: ConnView; tab: TTab; version: number }) {
  const [cols, setCols] = useState<ColumnInfo[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    setCols(undefined)
    api.columns(conn.id, tab.table).then(setCols).catch((e) => setError(e.message))
  }, [conn.id, tab.table, version])

  if (error) return <ErrorPanel message={error} />
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border bg-surface">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-medium">{cols ? `${cols.length} columns` : 'Columns'}</p>
          {!conn.readOnly && (
            <Button size="sm" variant="secondary" onClick={() => openDialog({ kind: 'table-designer', connId: conn.id, schema: tab.table.schema, table: tab.table.table })}>
              <Pencil size={13} aria-hidden /> Edit structure
            </Button>
          )}
        </div>
        <table className="w-full text-left text-[13px]">
          <thead className="bg-sidebar text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Column</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Nullable</th>
              <th className="px-4 py-2 font-medium">Default</th>
            </tr>
          </thead>
          <tbody>
            {!cols
              ? [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={4} className="px-4 py-2"><Skeleton className="h-5" /></td></tr>
                ))
              : cols.map((c) => (
                  <tr key={c.name} className="border-t">
                    <td className="px-4 py-2 font-mono">
                      <span className="flex items-center gap-1.5">
                        {c.primaryKey && <KeyRound size={13} className="text-warning" aria-label="Primary key" />}
                        {c.name}
                        {c.autoIncrement && <span className="rounded bg-muted px-1 font-sans text-[10px] text-muted-foreground">auto</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-muted-foreground">{c.type}</td>
                    <td className="px-4 py-2">{c.nullable ? 'Yes' : <span className="text-muted-foreground">No</span>}</td>
                    <td className="px-4 py-2 font-mono text-muted-foreground">{c.default ?? '—'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
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
          <Button variant={production ? 'danger' : 'primary'} loading={busy} disabled={production && !ack} autoFocus={!production}
            onClick={async () => { setBusy(true); try { await onSave() } finally { setBusy(false) } }}>
            Save {statements?.length} {statements?.length === 1 ? 'change' : 'changes'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
