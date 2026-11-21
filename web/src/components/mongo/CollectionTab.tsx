import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Code2, Copy, Layers, MoreHorizontal, Pencil, Plus, RefreshCw, Square, Terminal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, newId, type ConnView, type MongoField, type MongoFindResult, type Value } from '@/lib/api'
import { track } from '@/lib/activity'
import { filterReady, type Filter } from '@/lib/commander'
import { cn } from '@/lib/cn'
import { openDialog } from '@/lib/dialogs'
import { useGuard } from '@/lib/guard'
import { useDelayed } from '@/lib/hooks'
import { filterType, mongoFilter } from '@/lib/mongofilter'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { FilterBar, type Field } from '../builder/FilterBar'
import { DataGrid } from '../grid/DataGrid'
import { ErrorPanel } from '../query/Results'
import { Button } from '../ui/Button'
import { Confirm } from '../ui/Confirm'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu'
import { Segmented } from '../ui/Segmented'
import { Skeleton } from '../ui/Skeleton'
import { Spinner } from '../ui/Spinner'
import { Tooltip } from '../ui/Tooltip'
import { JsonDocDialog } from './JsonDocDialog'

type TTab = Extract<Tab, { kind: 'table' }>
type Doc = Record<string, unknown>
const PAGE = 50

/** Short readable form of a value for the table view. */
function cell(v: unknown): Value {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('$oid' in o) return String(o.$oid)
    if ('$date' in o) return String(typeof o.$date === 'object' ? JSON.stringify(o.$date) : o.$date)
    if ('$numberDecimal' in o) return String(o.$numberDecimal)
    if ('$numberLong' in o) return String(o.$numberLong)
    return JSON.stringify(v)
  }
  return v as Value
}

const pretty = (d: unknown) => JSON.stringify(d, null, 2)

export function CollectionTab({ tab, conn }: { tab: TTab; conn: ConnView }) {
  const { schema: db, table: coll } = tab.table
  const version = useWorkspace((s) => s.schemaVersion[conn.id] ?? 0)
  const [view, setView] = useState<'table' | 'json'>('table')
  const [data, setData] = useState<MongoFindResult>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<string>()
  const [skip, setSkip] = useState(0)
  const [sort, setSort] = useState<{ column: string; desc: boolean }>()
  const [fields, setFields] = useState<MongoField[]>([])
  const [filters, setFilters] = useState<Filter[]>([])
  const [match, setMatch] = useState<'all' | 'any'>('all')
  const [rawMode, setRawMode] = useState(false)
  const [raw, setRaw] = useState('{}')
  const [rawApplied, setRawApplied] = useState('{}')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<{ doc?: Doc } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Doc[]>()
  const [consoleOut, setConsoleOut] = useState<{ title: string; docs: unknown[] }>()
  const showSpinner = useDelayed(!!loading, 150)
  const { guard, dialog } = useGuard(conn.name)
  const ro = conn.readOnly

  useEffect(() => {
    api.mongo.fields(conn.id, db, coll).then(setFields).catch(() => setFields([]))
  }, [conn.id, db, coll, version])

  const typeOf = useCallback((p: string) => fields.find((f) => f.path === p)?.type ?? 'string', [fields])
  const filter = useMemo(() => {
    if (rawMode) {
      try {
        return JSON.parse(rawApplied || '{}')
      } catch {
        return {}
      }
    }
    return mongoFilter(filters, match, typeOf, filterReady)
  }, [rawMode, rawApplied, filters, match, typeOf])
  const filterKey = JSON.stringify(filter)

  const load = useCallback(async () => {
    const qid = newId()
    setLoading(qid)
    setError('')
    try {
      const res = await track(`Loading ${coll}`, api.mongo.find(conn.id, db, coll, {
        filter: JSON.parse(filterKey), sort: sort ? { [sort.column]: sort.desc ? -1 : 1 } : undefined, skip, limit: PAGE, queryId: qid,
      }))
      setData(res)
      setSelected(new Set())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(undefined)
    }
  }, [conn.id, db, coll, filterKey, sort, skip])

  useEffect(() => {
    const t = setTimeout(load, 200) // filter chips apply shortly after a change
    return () => clearTimeout(t)
  }, [load, version])

  const docs = (data?.docs ?? []) as Doc[]
  const columns = useMemo(() => {
    const keys: string[] = []
    for (const d of docs) for (const k of Object.keys(d)) if (!keys.includes(k)) keys.push(k)
    keys.sort((a, b) => (a === '_id' ? -1 : b === '_id' ? 1 : 0))
    return keys.map((k) => ({ name: k, type: fields.find((f) => f.path === k)?.type ?? '' }))
  }, [docs, fields])
  const rows = useMemo(() => docs.map((d) => columns.map((c) => cell(d[c.name]))), [docs, columns])
  const filterFields: Field[] = useMemo(
    () => fields.filter((f) => f.type !== 'object' && f.type !== 'array').map((f) => ({ ref: { table: coll, column: f.path }, type: filterType(f.type), label: f.path })),
    [fields, coll],
  )

  async function saveDoc(doc: unknown) {
    try {
      if (editing?.doc) {
        // `true` distinguishes "saved" from "cancelled at the production prompt" (undefined).
        const saved = await guard(async (confirmed) => (await track('Saving document', api.mongo.replace(conn.id, db, coll, editing.doc!._id, doc, confirmed)), true))
        if (!saved) return false
        toast.success('Document saved')
      } else {
        await track('Inserting document', api.mongo.insert(conn.id, db, coll, [doc]))
        toast.success('Document inserted')
      }
      load()
      return true
    } catch (e) {
      toast.error('Nothing was saved', { description: (e as Error).message })
      return false
    }
  }

  async function deleteDocs(list: Doc[]) {
    try {
      const r = await guard((confirmed) => track('Deleting documents', api.mongo.delete(conn.id, db, coll, list.map((d) => d._id), confirmed)))
      if (r) toast.success(`Deleted ${r.deleted} ${r.deleted === 1 ? 'document' : 'documents'}`)
      load()
    } catch (e) {
      toast.error("Couldn't delete", { description: (e as Error).message })
    }
  }

  function filterBy(column: string, value: Value) {
    setRawMode(false)
    setSkip(0)
    setFilters((fs) => [...fs, { id: newId(), col: { table: coll, column }, op: value === null ? 'null' : 'eq', value: value === null ? '' : String(value) }])
  }

  const total = data?.total ?? 0
  const shownTo = skip + docs.length

  return (
    <div className="flex h-full flex-col">
      {/* One toolbar: collection · view · filters · actions */}
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Layers size={16} aria-hidden /></span>
        <div className="max-w-44 min-w-0 shrink-0 leading-tight">
          <h2 className="truncate font-semibold" title={coll}>{coll}</h2>
          <p className="truncate text-xs text-muted-foreground">{db} · {conn.name}</p>
        </div>
        {consoleOut ? (
          <Button size="sm" variant="secondary" className="ml-1 shrink-0" onClick={() => setConsoleOut(undefined)}><ArrowLeft size={14} aria-hidden /> Back to documents</Button>
        ) : (
          <Segmented label="View" value={view} onChange={setView} options={[{ value: 'table', label: 'Table' }, { value: 'json', label: 'JSON' }]} className="ml-1 shrink-0" />
        )}
        {!consoleOut ? (
          <div className="mx-1 flex min-w-40 flex-1 items-center gap-1.5">
            {rawMode ? (
              <form onSubmit={(e) => (e.preventDefault(), setSkip(0), setRawApplied(raw))} className="flex h-8 min-w-0 flex-1 items-center rounded-lg border bg-background focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15">
                <span className="flex h-full items-center rounded-l-lg border-r bg-muted/60 px-2.5 font-mono text-[11px] font-semibold text-muted-foreground">FILTER</span>
                <input value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} aria-label="Filter as MongoDB query JSON" placeholder='{ "age": { "$gte": 30 } }'
                  className="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[12.5px] outline-none" />
                <button type="submit" className={cn('mr-1 h-6 rounded-md px-2 text-xs font-medium', raw !== rawApplied ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>Apply</button>
              </form>
            ) : (
              <FilterBar fields={filterFields} filters={filters} match={match} onChange={(f, m) => (setFilters(f), setMatch(m), setSkip(0))} dense addLabel="Filter documents" />
            )}
            <Tooltip content={rawMode ? 'Back to the visual filter' : 'Write the filter as JSON instead'}>
              <button type="button" aria-label={rawMode ? 'Switch to visual filter' : 'Switch to JSON filter'}
                onClick={() => { if (!rawMode) { const j = JSON.stringify(filter); setRaw(j); setRawApplied(j) } else { setFilters([]) } setRawMode(!rawMode) }}
                className={cn('ml-auto flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium transition', rawMode ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                <Code2 size={13} aria-hidden /> JSON
              </button>
            </Tooltip>
          </div>
        ) : <div className="flex-1" />}
        <div className="flex shrink-0 items-center gap-0.5">
          {loading && showSpinner ? (
            <Button size="sm" variant="ghost" onClick={() => api.cancel(loading)}><Spinner size={13} className="text-primary" /> <Square size={10} className="fill-current text-destructive" aria-hidden /> Stop</Button>
          ) : (
            <Tooltip content="Reload"><button onClick={load} aria-label="Reload" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"><RefreshCw size={15} /></button></Tooltip>
          )}
          {!ro && (
            <>
              <Tooltip content="Insert a document"><Button size="sm" variant="ghost" aria-label="Insert document" onClick={() => setEditing({})}><Plus size={14} aria-hidden /><span className="hidden xl:inline">Insert</span></Button></Tooltip>
              <Tooltip content="Delete selected documents (Del)">
                <Button size="sm" variant="ghost" aria-label="Delete selected documents" disabled={!selected.size} onClick={() => setConfirmDelete([...selected].map((i) => docs[i]))}>
                  <Trash2 size={14} aria-hidden />{selected.size > 0 && <span>{selected.size}</span>}
                </Button>
              </Tooltip>
            </>
          )}
          <Menu>
            <MenuTrigger aria-label="Collection actions" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"><MoreHorizontal size={16} /></MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<Copy />} onSelect={() => navigator.clipboard.writeText(coll)}>Copy name</MenuItem>
              <MenuItem icon={<RefreshCw />} onSelect={load}>Reload</MenuItem>
              {!ro && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 />} danger onSelect={() => openDialog({ kind: 'mongo-drop', connId: conn.id, db, collection: coll })}>Drop collection…</MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {consoleOut ? (
          <JsonList docs={consoleOut.docs} title={consoleOut.title} />
        ) : error ? (
          <ErrorPanel message={error} />
        ) : !data ? (
          <div className="space-y-px" role="status" aria-label="Loading documents">
            <Skeleton className="h-11 rounded-none" />
            {[...Array(12)].map((_, i) => <Skeleton key={i} className="h-7.5 rounded-none opacity-70" />)}
          </div>
        ) : docs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <p className="font-medium text-foreground">No documents</p>
            <p className="text-[13px]">{filterKey !== '{}' ? 'Nothing matches this filter.' : 'This collection is empty.'}</p>
            {!ro && filterKey === '{}' && <Button size="sm" variant="secondary" onClick={() => setEditing({})}><Plus size={13} aria-hidden /> Insert a document</Button>}
          </div>
        ) : view === 'table' ? (
          <div className={cn('h-full transition-opacity', loading && 'opacity-60')} onDoubleClick={(e) => {
            const r = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')
            if (r && !ro) setEditing({ doc: docs[Number(r.dataset.r)] })
          }}>
            <DataGrid columns={columns} rows={rows} primaryKey={['_id']} sort={sort} onSort={(c) => { setSkip(0); setSort((s) => (s?.column !== c ? { column: c, desc: false } : !s.desc ? { column: c, desc: true } : undefined)) }}
              selected={selected} onSelect={setSelected} rowOffset={skip} onFilterBy={filterBy}
              onDeleteRows={ro ? undefined : (list) => setConfirmDelete(list.map((i) => docs[i]))} />
          </div>
        ) : (
          <div className={cn('h-full overflow-y-auto p-3', loading && 'opacity-60')}>
            <ul className="space-y-2">
              {docs.map((d, i) => (
                <li key={i} className="group rounded-xl border bg-surface">
                  <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                    <span className="font-mono">{String(cell(d._id))}</span>
                    {!ro && (
                      <span className="ml-auto flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ doc: d })}><Pencil size={12} aria-hidden /> Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete([d])}><Trash2 size={12} aria-hidden /> Delete</Button>
                      </span>
                    )}
                  </div>
                  <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">{pretty(d)}</pre>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {!consoleOut && (
        <footer className="flex h-10 shrink-0 items-center gap-3 border-t bg-sidebar px-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <button disabled={skip === 0 || !!loading} onClick={() => setSkip((s) => Math.max(0, s - PAGE))} aria-label="Previous page" className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"><ChevronLeft size={15} /></button>
            <span className="tabular-nums">{docs.length ? `${(skip + 1).toLocaleString()}–${shownTo.toLocaleString()} of ${data?.estimated ? '~' : ''}${total.toLocaleString()}` : 'No documents'}</span>
            <button disabled={shownTo >= total || !!loading} onClick={() => setSkip((s) => s + PAGE)} aria-label="Next page" className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"><ChevronRight size={15} /></button>
          </div>
          {data && <span>{data.durationMs.toFixed(1)} ms</span>}
          {!ro && <span className="hidden lg:inline">Double-click a document to edit · right-click for more</span>}
        </footer>
      )}

      <MongoConsole conn={conn} db={db} coll={coll} guard={guard} onResult={(title, docs) => setConsoleOut({ title, docs })} />

      <JsonDocDialog open={!!editing} title={editing?.doc ? 'Edit document' : `Insert into ${coll}`} saveLabel={editing?.doc ? 'Save' : 'Insert'}
        initial={editing?.doc ? pretty(editing.doc) : '{\n  \n}'} onClose={() => setEditing(null)} onSave={saveDoc} />
      <Confirm open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(undefined)} danger confirmLabel="Delete"
        title={`Delete ${confirmDelete?.length} ${confirmDelete?.length === 1 ? 'document' : 'documents'}?`} onConfirm={() => deleteDocs(confirmDelete!)}>
        They are removed permanently from {coll}.
      </Confirm>
      {dialog}
    </div>
  )
}

function JsonList({ docs, title }: { docs: unknown[]; title: string }) {
  return (
    <div className="h-full overflow-y-auto p-3">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      {docs.length === 0 ? <p className="text-[13px] text-muted-foreground">No results.</p> : (
        <ul className="space-y-2">
          {docs.map((d, i) => <li key={i}><pre className="overflow-x-auto rounded-xl border bg-surface p-3 font-mono text-[12.5px] leading-relaxed">{pretty(d)}</pre></li>)}
        </ul>
      )}
    </div>
  )
}

/**
 * Second choice: run an aggregation pipeline ([ … ]) on this collection, or a
 * database command ({ … }). Results replace the document view until "Back".
 */
function MongoConsole({ conn, db, coll, guard, onResult }: {
  conn: ConnView; db: string; coll: string
  guard: <T>(a: (confirmed: boolean) => Promise<T>) => Promise<T | undefined>
  onResult: (title: string, docs: unknown[]) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    const t = text.trim()
    if (!t || busy) return
    let parsed: unknown
    try {
      parsed = JSON.parse(t)
    } catch (e) {
      return toast.error('That isn’t valid JSON', { description: (e as Error).message })
    }
    setBusy(true)
    try {
      if (Array.isArray(parsed)) {
        const r = await guard((confirmed) => track('Running aggregation', api.mongo.aggregate(conn.id, db, coll, parsed, confirmed)))
        if (r) onResult(`Aggregation · ${r.docs.length} results`, r.docs)
      } else {
        const r = await guard((confirmed) => track('Running command', api.mongo.command(conn.id, db, parsed, confirmed)))
        if (r) onResult('Command result', [r.result])
      }
    } catch (e) {
      toast.error('It didn’t run', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => (e.preventDefault(), run())} className="flex shrink-0 items-center gap-2 border-t bg-sidebar/50 px-3 py-2">
      <Terminal size={15} className="shrink-0 text-muted-foreground" aria-hidden />
      <input value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Aggregation pipeline or command"
        placeholder={'Pipeline [ { "$group": { "_id": "$status", "n": { "$sum": 1 } } } ]  or command { "dbStats": 1 }'}
        className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2.5 font-mono text-[12.5px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20" />
      <Button size="sm" type="submit" loading={busy} disabled={!text.trim()}>Run</Button>
    </form>
  )
}
