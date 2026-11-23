import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Expand, Link2, Pencil, Plus, RefreshCw, Share2, Square, Terminal, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, newId, type ConnView, type GraphNode, type GraphRel, type GraphResult, type Value } from '@/lib/api'
import { track } from '@/lib/activity'
import { filterReady, type Filter } from '@/lib/commander'
import { cn } from '@/lib/cn'
import * as cy from '@/lib/cypher'
import { useGuard } from '@/lib/guard'
import { useDelayed } from '@/lib/hooks'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { FilterBar, type Field } from '../builder/FilterBar'
import { DataGrid } from '../grid/DataGrid'
import { JsonDocDialog } from '../mongo/JsonDocDialog'
import { ErrorPanel } from '../query/Results'
import { Button } from '../ui/Button'
import { Confirm } from '../ui/Confirm'
import { Input } from '../ui/Input'
import { Segmented } from '../ui/Segmented'
import { Skeleton } from '../ui/Skeleton'
import { Spinner } from '../ui/Spinner'
import { Tooltip } from '../ui/Tooltip'
import { GraphCanvas, type Selection } from './GraphCanvas'

type GTab = Extract<Tab, { kind: 'graph' }>
type Graph = { nodes: GraphNode[]; rels: GraphRel[] }
const PAGE = 50
const pretty = (v: unknown) => JSON.stringify(v, null, 2)
const propsHint = 'Properties as JSON: text, numbers, true/false, or lists of those.'

/** A result cell as short text: nodes by caption, relationships by type. */
function cellOf(v: unknown, g: Graph): Value {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return v as Value
  const o = v as Record<string, unknown>
  if (typeof o.$node === 'string') {
    const n = g.nodes.find((x) => x.id === o.$node)
    return n ? `(:${n.labels.join(':')} ${cy.caption(n)})` : '(node)'
  }
  if (typeof o.$rel === 'string') return `[:${g.rels.find((x) => x.id === o.$rel)?.type ?? 'REL'}]`
  if (Array.isArray(o.$path)) return `path of ${(o.$path.length - 1) / 2} relationships`
  return JSON.stringify(v)
}

/**
 * Neo4j: a label's nodes, a relationship type, or a sample of the database,
 * drawn as a graph or listed as a table. Everything (filter, edit, connect,
 * delete, expand) works from the UI; the Cypher console is the fallback.
 */
export function GraphTab({ tab, conn }: { tab: GTab; conn: ConnView }) {
  const { db, label, rel } = tab
  const version = useWorkspace((s) => s.schemaVersion[conn.id] ?? 0)
  const schemaChanged = useWorkspace((s) => s.schemaChanged)
  const [view, setView] = useState<'graph' | 'table'>('graph')
  const [graph, setGraph] = useState<Graph>()
  const [total, setTotal] = useState<number>()
  const [ms, setMs] = useState<number>()
  const [pageSize, setPageSize] = useState(0) // items on this page (expanding adds nodes, not page items)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<string>()
  const [skip, setSkip] = useState(0)
  const [types, setTypes] = useState<Map<string, string>>(new Map())
  const [filters, setFilters] = useState<Filter[]>([])
  const [match, setMatch] = useState<'all' | 'any'>('all')
  const [sel, setSel] = useState<Selection>()
  const [rows, setRows] = useState<Set<number>>(new Set())
  const [pending, setPending] = useState<string>() // "connect" started from this node
  const [editing, setEditing] = useState<{ kind: 'new' } | { kind: 'node'; node: GraphNode } | { kind: 'rel'; rel: GraphRel } | { kind: 'connect'; from: string; to: string }>()
  const [labelsText, setLabelsText] = useState('')
  const [relType, setRelType] = useState('')
  const [confirm, setConfirm] = useState<{ nodes?: string[]; rel?: string }>()
  const [result, setResult] = useState<GraphResult>() // console output, shown until "Back"
  const showSpinner = useDelayed(!!loading, 150)
  const { guard, dialog } = useGuard(conn.name)
  const ro = conn.readOnly
  const typeOf = useCallback((p: string) => types.get(p) ?? 'text', [types])
  const ready = useMemo(() => filters.filter(filterReady), [filters])
  const filterKey = JSON.stringify([ready, match])

  /** Runs a read query (no guard needed). */
  const read = useCallback((q: cy.Cypher, what: string, qid?: string) => track(what, api.graph.run(conn.id, db, q.query, q.params, false, qid)), [conn.id, db])

  // Property names and types for the filter bar, from a sample of the label.
  useEffect(() => {
    if (!label) return
    read({ query: `MATCH (n:${cy.cq(label)}) WITH n LIMIT 200 RETURN n`, params: {} }, 'Sampling properties').then((r) => setTypes(cy.propTypes(r.nodes))).catch(() => {})
  }, [label, read, version])

  const load = useCallback(async () => {
    const qid = newId()
    setLoading(qid)
    setError('')
    try {
      const q = label ? cy.labelPage(label, ready, match, typeOf, skip, PAGE) : rel ? cy.relPage(rel, skip, PAGE) : cy.overview(100)
      const count = label ? cy.labelCount(label, ready, match, typeOf) : rel ? cy.relCount(rel) : undefined
      const [res, n] = await Promise.all([read(q, `Loading ${label ?? rel ?? db}`, qid), count ? read(count, 'Counting') : undefined])
      setGraph({ nodes: res.nodes, rels: res.rels })
      setPageSize(label ? res.nodes.length : res.rels.length)
      setMs(res.durationMs)
      setTotal(n ? Number(n.rows[0]?.[0] ?? 0) : undefined)
      setRows(new Set())
      setSel((s) => (s && (s.kind === 'node' ? res.nodes : res.rels).some((x) => x.id === s.id) ? s : undefined))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(undefined)
    }
  }, [label, rel, db, skip, filterKey, read]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(load, 200) // filter chips apply shortly after a change
    return () => clearTimeout(t)
  }, [load, version])

  const shown: Graph | undefined = result ?? graph
  const node = sel?.kind === 'node' ? shown?.nodes.find((n) => n.id === sel.id) : undefined
  const relSel = sel?.kind === 'rel' ? shown?.rels.find((r) => r.id === sel.id) : undefined

  /** Runs a write through the read-only/production guards; refreshes after. */
  async function write(q: cy.Cypher, what: string, done: string) {
    try {
      const r = await guard((confirmed) => track(what, api.graph.run(conn.id, db, q.query, q.params, confirmed)))
      if (!r) return false
      toast.success(done, { description: r.summary || undefined })
      setResult(undefined)
      schemaChanged(conn.id, undefined, db)
      return true
    } catch (e) {
      toast.error(`Couldn't ${what.toLowerCase()}`, { description: (e as Error).message })
      return false
    }
  }

  async function expand(id: string) {
    try {
      const r = await read(cy.expand(id), 'Showing neighbours')
      if (result) setResult({ ...result, ...cy.mergeGraph(result, r) })
      else setGraph((g) => cy.mergeGraph(g ?? { nodes: [], rels: [] }, r))
      if (view === 'table') setView('graph')
      if (!r.rels.length) toast.info('This node has no relationships')
    } catch (e) {
      toast.error("Couldn't load neighbours", { description: (e as Error).message })
    }
  }

  function select(s: Selection) {
    if (pending && s?.kind === 'node' && s.id !== pending) {
      setRelType('')
      setEditing({ kind: 'connect', from: pending, to: s.id })
      setPending(undefined)
      return
    }
    setSel(s)
  }

  // Table: one row per node, a column per property.
  const nodesList = shown?.nodes ?? []
  const tableCols = useMemo(() => {
    const keys: string[] = []
    for (const n of nodesList) for (const k of Object.keys(n.props)) if (!keys.includes(k)) keys.push(k)
    return [{ name: 'labels', type: '' }, ...keys.map((k) => ({ name: k, type: types.get(k) ?? '' }))]
  }, [nodesList, types])
  const tableRows = useMemo(() => nodesList.map((n) => tableCols.map((c, i) => (i === 0 ? n.labels.join(', ') : cellOf(n.props[c.name], shown!)))), [nodesList, tableCols, shown])
  const filterFields: Field[] = useMemo(() => [...types].filter(([, t]) => t !== 'array').map(([p, t]) => ({ ref: { table: label ?? '', column: p }, type: t === 'number' ? 'number' : t === 'bool' ? 'bool' : 'text', label: p })), [types, label])

  const title = label ?? rel ?? (db || 'Graph')
  const shownTo = skip + pageSize
  const paged = !result && (label || rel)

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: label ? cy.labelColor(label) : 'var(--primary)' }}><Share2 size={15} aria-hidden /></span>
        <div className="max-w-44 min-w-0 shrink-0 leading-tight">
          <h2 className="truncate font-semibold" title={title}>{label ? `:${label}` : rel ? `[:${rel}]` : title}</h2>
          <p className="truncate text-xs text-muted-foreground">{label ? 'Nodes' : rel ? 'Relationships' : 'Sample of the graph'} · {conn.name}</p>
        </div>
        {result ? (
          <Button size="sm" variant="secondary" className="ml-1 shrink-0" onClick={() => (setResult(undefined), setSel(undefined))}><ArrowLeft size={14} aria-hidden /> Back</Button>
        ) : null}
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'graph', label: 'Graph' }, { value: 'table', label: 'Table' }]} className="ml-1 shrink-0" />
        <div className="mx-1 flex min-w-40 flex-1 items-center">
          {label && !result && <FilterBar fields={filterFields} filters={filters} match={match} onChange={(f, m) => (setFilters(f), setMatch(m), setSkip(0))} dense addLabel="Filter nodes" />}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {loading && showSpinner ? (
            <Button size="sm" variant="ghost" onClick={() => api.cancel(loading)}><Spinner size={13} className="text-primary" /> <Square size={10} className="fill-current text-destructive" aria-hidden /> Stop</Button>
          ) : (
            <Tooltip content="Reload"><button onClick={() => (setResult(undefined), load())} aria-label="Reload" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"><RefreshCw size={15} /></button></Tooltip>
          )}
          {!ro && (
            <Tooltip content={label ? `New ${label} node` : 'New node'}>
              <Button size="sm" variant="ghost" aria-label="New node" onClick={() => (setLabelsText(label ?? ''), setEditing({ kind: 'new' }))}><Plus size={14} aria-hidden /><span className="hidden xl:inline">Node</span></Button>
            </Tooltip>
          )}
          {!ro && view === 'table' && rows.size > 0 && (
            <Button size="sm" variant="ghost" aria-label="Delete selected nodes" onClick={() => setConfirm({ nodes: [...rows].map((i) => nodesList[i].id) })}><Trash2 size={14} aria-hidden /> {rows.size}</Button>
          )}
        </div>
      </div>

      {pending && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-accent px-3 py-1.5 text-[13px] text-accent-foreground">
          <Link2 size={14} aria-hidden /> Click the node to connect to (in the graph).
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPending(undefined)}>Cancel</Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {error && !result ? (
            <ErrorPanel message={error} />
          ) : !shown ? (
            <div className="space-y-px p-3" role="status" aria-label="Loading graph">{[...Array(10)].map((_, i) => <Skeleton key={i} className="h-7" />)}</div>
          ) : shown.nodes.length === 0 && !(result?.rows.length) ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <p className="font-medium text-foreground">{result ? (result.summary || 'Done. No rows returned.') : 'Nothing here yet'}</p>
              {!result && <p className="text-[13px]">{ready.length ? 'No nodes match this filter.' : label ? `There are no ${label} nodes.` : 'This database is empty.'}</p>}
              {!ro && !result && !ready.length && <Button size="sm" variant="secondary" onClick={() => (setLabelsText(label ?? ''), setEditing({ kind: 'new' }))}><Plus size={13} aria-hidden /> Create a node</Button>}
            </div>
          ) : view === 'graph' && shown.nodes.length > 0 ? (
            <div className={cn('h-full transition-opacity', loading && 'opacity-60')}>
              <GraphCanvas nodes={shown.nodes} rels={shown.rels} selected={sel} pending={pending} onSelect={select} onExpand={expand} />
            </div>
          ) : result && (result.columns.length && (view === 'table' || !shown.nodes.length)) ? (
            <DataGrid columns={result.columns.map((c) => ({ name: c, type: '' }))} rows={result.rows.map((r) => r.map((v) => cellOf(v, shown)))} />
          ) : (
            <div className={cn('h-full', loading && 'opacity-60')} onDoubleClick={(e) => {
              const r = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')
              if (r && !ro) setEditing({ kind: 'node', node: nodesList[Number(r.dataset.r)] })
            }}>
              <DataGrid columns={tableCols} rows={tableRows} selected={rows} onSelect={(s) => (setRows(s), s.size === 1 && setSel({ kind: 'node', id: nodesList[[...s][0]].id }))} rowOffset={paged ? skip : 0}
                onDeleteRows={ro ? undefined : (list) => setConfirm({ nodes: list.map((i) => nodesList[i].id) })} />
            </div>
          )}
        </div>

        {(node || relSel) && (
          <aside aria-label="Selection" className="flex w-72 shrink-0 flex-col border-l bg-sidebar/40">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              {node ? (
                <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {node.labels.map((l) => <span key={l} className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: cy.labelColor(l) }}>{l}</span>)}
                  {!node.labels.length && <span className="text-[13px] text-muted-foreground">Node</span>}
                </div>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold">[:{relSel!.type}]</span>
              )}
              <button aria-label="Close details" onClick={() => setSel(undefined)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><X size={14} /></button>
            </div>
            <dl className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[13px]">
              {Object.entries((node ?? relSel)!.props).length === 0 && <p className="text-muted-foreground">No properties.</p>}
              {Object.entries((node ?? relSel)!.props).map(([k, v]) => (
                <div key={k} className="border-b py-1.5 last:border-0">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-mono text-[12.5px] break-words">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
                </div>
              ))}
              {relSel && (
                <p className="mt-2 text-xs text-muted-foreground">
                  From {cy.caption(shown!.nodes.find((n) => n.id === relSel.start) ?? { id: '', labels: [], props: {} })} to {cy.caption(shown!.nodes.find((n) => n.id === relSel.end) ?? { id: '', labels: [], props: {} })}
                </p>
              )}
            </dl>
            <div className="grid gap-1 border-t p-2">
              {node && <Button size="sm" variant="ghost" className="justify-start" onClick={() => expand(node.id)}><Expand size={13} aria-hidden /> Show neighbours</Button>}
              {!ro && (
                <>
                  <Button size="sm" variant="ghost" className="justify-start" onClick={() => setEditing(node ? { kind: 'node', node } : { kind: 'rel', rel: relSel! })}><Pencil size={13} aria-hidden /> Edit properties</Button>
                  {node && <Button size="sm" variant="ghost" className="justify-start" onClick={() => (setPending(node.id), setView('graph'))}><Link2 size={13} aria-hidden /> Connect to another node…</Button>}
                  <Button size="sm" variant="ghost" className="justify-start text-destructive hover:bg-destructive/10" onClick={() => setConfirm(node ? { nodes: [node.id] } : { rel: relSel!.id })}>
                    <Trash2 size={13} aria-hidden /> Delete {node ? 'node' : 'relationship'}
                  </Button>
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      <footer className="flex h-10 shrink-0 items-center gap-3 border-t bg-sidebar px-3 text-xs text-muted-foreground">
        {paged && (
          <div className="flex items-center gap-1">
            <button disabled={skip === 0 || !!loading} onClick={() => setSkip((s) => Math.max(0, s - PAGE))} aria-label="Previous page" className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"><ChevronLeft size={15} /></button>
            <span className="tabular-nums">{shownTo > skip ? `${(skip + 1).toLocaleString()}–${shownTo.toLocaleString()}${total !== undefined ? ` of ${total.toLocaleString()}` : ''}` : 'None'}</span>
            <button disabled={total === undefined || shownTo >= total || !!loading} onClick={() => setSkip((s) => s + PAGE)} aria-label="Next page" className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"><ChevronRight size={15} /></button>
          </div>
        )}
        {result && <span>{result.rows.length.toLocaleString()} rows{result.truncated ? ' (first 1,000)' : ''}{result.summary ? ` · ${result.summary}` : ''}</span>}
        {(result?.durationMs ?? ms) !== undefined && <span>{(result?.durationMs ?? ms)!.toFixed(1)} ms</span>}
        <span className="hidden lg:inline">{shown?.nodes.length ?? 0} nodes · {shown?.rels.length ?? 0} relationships shown · double-click a node to show its neighbours</span>
      </footer>

      <CypherConsole conn={conn} db={db} guard={guard} onResult={(r) => (setResult(r), setSel(undefined), setView(r.nodes.length ? 'graph' : 'table'))}
        onWrite={() => schemaChanged(conn.id, undefined, db)} placeholder={label ? `MATCH (n:${cy.cq(label)}) RETURN n LIMIT 25` : 'MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 50'} />

      <JsonDocDialog
        open={!!editing}
        title={editing?.kind === 'new' ? 'New node' : editing?.kind === 'connect' ? 'New relationship' : editing?.kind === 'rel' ? `Edit [:${editing.rel.type}]` : 'Edit node'}
        saveLabel={editing?.kind === 'new' || editing?.kind === 'connect' ? 'Create' : 'Save'}
        hint={propsHint}
        canSave={editing?.kind === 'connect' ? !!relType.trim() : true}
        initial={editing?.kind === 'node' ? pretty(editing.node.props) : editing?.kind === 'rel' ? pretty(editing.rel.props) : editing?.kind === 'new' ? pretty(label && types.size ? Object.fromEntries([...types.keys()].slice(0, 6).map((k) => [k, types.get(k) === 'number' ? 0 : types.get(k) === 'bool' ? false : ''])) : { name: '' }) : '{\n  \n}'}
        onClose={() => setEditing(undefined)}
        onSave={async (props) => {
          const p = props as Record<string, unknown>
          if (editing?.kind === 'node') return write(cy.setProps(editing.node.id, p), 'Save node', 'Node saved')
          if (editing?.kind === 'rel') return write(cy.setRelProps(editing.rel.id, p), 'Save relationship', 'Relationship saved')
          if (editing?.kind === 'connect') return write(cy.connect(editing.from, editing.to, relType.trim(), p), 'Create relationship', 'Relationship created')
          const labels = labelsText.split(/[,:\s]+/).map((l) => l.trim()).filter(Boolean)
          return write(cy.createNode(labels, p), 'Create node', 'Node created')
        }}
      >
        {editing?.kind === 'new' && <Input label="Labels" value={labelsText} onChange={(e) => setLabelsText(e.target.value)} placeholder="e.g. Person, Customer" hint="Separate several labels with commas." />}
        {editing?.kind === 'connect' && (
          <Input label="Relationship type" value={relType} onChange={(e) => setRelType(e.target.value)} placeholder="e.g. KNOWS" autoFocus
            hint={`From ${cy.caption(shown?.nodes.find((n) => n.id === editing.from) ?? { id: '', labels: [], props: {} })} to ${cy.caption(shown?.nodes.find((n) => n.id === editing.to) ?? { id: '', labels: [], props: {} })}.`} />
        )}
      </JsonDocDialog>

      <Confirm open={!!confirm} onOpenChange={(o) => !o && setConfirm(undefined)} danger confirmLabel="Delete"
        title={confirm?.rel ? 'Delete this relationship?' : `Delete ${confirm?.nodes?.length === 1 ? 'this node' : `${confirm?.nodes?.length} nodes`}?`}
        onConfirm={async () => {
          const c = confirm!
          if (c.rel) await write(cy.deleteRel(c.rel), 'Delete relationship', 'Relationship deleted')
          else await write(cy.deleteNodes(c.nodes!), 'Delete nodes', c.nodes!.length === 1 ? 'Node deleted' : `${c.nodes!.length} nodes deleted`)
          setSel(undefined)
        }}>
        {confirm?.rel ? 'The two nodes stay.' : 'Their relationships are deleted too. This can’t be undone.'}
      </Confirm>
      {dialog}
    </div>
  )
}

/** Second choice: any Cypher query. Writes go through the production/read-only guards. */
function CypherConsole({ conn, db, guard, onResult, onWrite, placeholder }: {
  conn: ConnView; db: string; placeholder: string
  guard: <T>(a: (confirmed: boolean) => Promise<T>) => Promise<T | undefined>
  onResult: (r: GraphResult) => void
  onWrite: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    try {
      const r = await guard((confirmed) => track('Running Cypher', api.graph.run(conn.id, db, q, {}, confirmed)))
      if (r) {
        onResult(r)
        if (r.summary) (toast.success('Done', { description: r.summary }), onWrite())
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
      <input value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Cypher query" placeholder={`Cypher, e.g. ${placeholder}`}
        className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2.5 font-mono text-[12.5px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20" />
      <Button size="sm" type="submit" loading={busy} disabled={!text.trim()}>Run</Button>
    </form>
  )
}
