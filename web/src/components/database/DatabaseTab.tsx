import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, Copy, Database, Eraser, Eye, FileCode2, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Table2, Trash2, Wand2 } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { api, type ConnView, type TableInfo } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { kindOf } from '@/lib/databases'
import { containerName, selectSql } from '@/lib/ddl'
import { emptyCommander } from '@/lib/commander'
import { openDialog } from '@/lib/dialogs'
import { treeKey, useWorkspace, type Tab } from '@/lib/workspace'
import { BrandIcon } from '../BrandIcon'
import { useSchema } from '../query/QueryTab'
import { ErrorPanel, Results } from '../query/Results'
import { useElapsed, useQueryRunner } from '../query/useQueryRunner'
import { Button } from '../ui/Button'
import { ContextMenu, CtxItem, CtxLabel, CtxSeparator } from '../ui/ContextMenu'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu'
import { Skeleton } from '../ui/Skeleton'
import { QueryComposer } from './QueryComposer'

type DTab = Extract<Tab, { kind: 'database' }>

export const fmtRows = (n?: number) =>
  n === undefined ? '' : n < 1000 ? `${n} rows` : n < 1e6 ? `~${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k rows` : `~${(n / 1e6).toFixed(1)}M rows`
export const fmtBytes = (n?: number) =>
  n === undefined ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`

/** Postgres: the server's databases (top of the tree). Other drivers: none. */
export function useServerDatabases(conn: ConnView) {
  const root = useWorkspace((s) => s.trees[treeKey(conn.id, [])])
  const loadTree = useWorkspace((s) => s.loadTree)
  useEffect(() => void loadTree(conn.id, []), [conn.id, loadTree])
  const dbs = conn.driver === 'postgres' ? (root?.nodes ?? []).filter((n) => n.kind === 'database').map((n) => n.name) : []
  return { dbs, loading: !root?.nodes }
}

/** Schema-level containers: Postgres schemas (of `database`), MySQL databases, SQLite "main". */
export function useContainers(conn: ConnView, database?: string) {
  const path = database ? [database] : []
  const entry = useWorkspace((s) => s.trees[treeKey(conn.id, path)])
  const loadTree = useWorkspace((s) => s.loadTree)
  useEffect(() => void (database && loadTree(conn.id, [database])), [conn.id, database, loadTree])
  if (conn.driver === 'sqlite') return { names: ['main'], loading: false }
  const nodes = (entry?.nodes ?? []).filter((n) => n.kind === 'schema' || (n.kind === 'database' && conn.driver !== 'postgres'))
  return { names: nodes.map((n) => n.name), loading: !entry?.nodes }
}

export function defaultSchema(conn: ConnView, names: string[]) {
  if (conn.driver === 'sqlite') return 'main'
  if (conn.driver === 'mysql' && conn.database && names.includes(conn.database)) return conn.database
  if (names.includes('public')) return 'public'
  return names[0]
}

export function Picker({ label, value, items, onPick, newLabel, onNew, placeholder }: {
  label: string; value?: string; items: string[]; onPick: (v: string) => void; newLabel?: string; onNew?: () => void; placeholder: string
}) {
  return (
    <Menu>
      <MenuTrigger className="-ml-1 flex max-w-48 items-center gap-1 rounded-md px-1 font-semibold transition hover:bg-muted" aria-label={`Choose ${label}`}>
        <span className="truncate">{value ?? placeholder}</span> <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuContent>
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground capitalize">{label}s</p>
        <div className="max-h-72 overflow-y-auto">
          {items.map((n) => (
            <MenuItem key={n} icon={n === value ? <Check /> : <Database />} onSelect={() => onPick(n)}>{n}</MenuItem>
          ))}
        </div>
        {onNew && (
          <>
            <MenuSeparator />
            <MenuItem icon={<Plus />} onSelect={onNew}>{newLabel}</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}

export function DatabaseTab({ tab, conn }: { tab: DTab; conn: ConnView }) {
  const { updateTab, openTable, openQuery } = useWorkspace()
  const version = useWorkspace((s) => s.schemaVersion[conn.id] ?? 0)
  const { dbs } = useServerDatabases(conn)
  // Postgres: which database on the server this tab looks at (default: the connection's own).
  const database = dbs.length ? (tab.database ?? (conn.info?.database || conn.database || dbs[0])) : undefined
  const { names, loading: loadingNames } = useContainers(conn, database)
  const schema = tab.schema ?? defaultSchema(conn, names)
  const [tables, setTables] = useState<TableInfo[]>()
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [showResults, setShowResults] = useState(false)
  const runner = useQueryRunner(conn, conn.driver === 'sqlite' ? undefined : schema, database)
  const elapsed = useElapsed(!!runner.running)
  const completion = useSchema(conn.id, schema, database)
  const gridRef = useRef<HTMLUListElement>(null)
  const label = containerName(conn.driver)

  const load = useCallback(async () => {
    if (!schema) return
    setError('')
    try {
      setTables(await track(`Loading ${schema}`, api.tables(conn.id, schema, database)))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [conn.id, schema, database])

  useEffect(() => {
    setTables(undefined)
    load()
  }, [load, version])

  const shown = useMemo(() => (tables ?? []).filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase())), [tables, filter])

  function pick(name: string) {
    updateTab(tab.id, { schema: name, title: name })
    setShowResults(false)
  }

  function pickDatabase(db: string) {
    updateTab(tab.id, { database: db, schema: undefined, title: db })
    setShowResults(false)
  }

  // "New schema" on Postgres, "New database" on MySQL; deleting follows the same naming.
  const newContainer = () => openDialog({ kind: 'create-database', connId: conn.id, database })
  const dropContainer = () => openDialog({ kind: 'drop', connId: conn.id, what: conn.driver === 'postgres' ? 'schema' : 'database', schema: schema!, database })

  function run(sql: string) {
    setShowResults(true)
    runner.run(sql)
  }

  // Arrow keys move between table cards (grid aware); Enter opens one.
  function onGridKey(e: React.KeyboardEvent) {
    const cards = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-card]') ?? [])]
    const i = cards.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const cols = Math.max(1, Math.round(gridRef.current!.clientWidth / cards[0].offsetWidth))
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: cards.length - 1 - i }[e.key]
    if (step !== undefined) {
      e.preventDefault()
      cards[Math.max(0, Math.min(cards.length - 1, i + step))]?.focus()
    }
  }

  const ref = (t: TableInfo) => ({ database, schema, table: t.name })

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <BrandIcon db={kindOf(conn)} size={30} />
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{conn.name}</p>
          {conn.driver === 'sqlite' ? (
            <p className="font-semibold">main</p>
          ) : (
            <div className="flex items-center gap-1">
              {database && (
                <>
                  <Picker label="database" value={database} items={dbs} onPick={pickDatabase} placeholder="Database"
                    newLabel="New database…" onNew={conn.readOnly ? undefined : () => openDialog({ kind: 'create-database', connId: conn.id, server: true })} />
                  <span className="text-muted-foreground" aria-hidden>/</span>
                </>
              )}
              <Picker label={label} value={schema} items={names} onPick={pick} placeholder={loadingNames ? 'Loading…' : `No ${label}s`}
                newLabel={`New ${label}…`} onNew={conn.readOnly ? undefined : newContainer} />
            </div>
          )}
        </div>

        {showResults ? (
          <Button size="sm" variant="secondary" className="ml-4" onClick={() => setShowResults(false)}>
            <ArrowLeft size={14} aria-hidden /> Back to tables
          </Button>
        ) : (
          <label className="relative ml-4 w-full max-w-xs">
            <span className="sr-only">Search tables</span>
            <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'ArrowDown' && (e.preventDefault(), gridRef.current?.querySelector<HTMLButtonElement>('[data-card]')?.focus())}
              placeholder={tables ? `Search ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}` : 'Search tables'}
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-[13px] outline-none transition focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
            />
          </label>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {showResults && (
            <Button size="sm" variant="ghost" onClick={() => openQuery(conn.id, '', schema, database)}><FileCode2 size={14} aria-hidden /> Open editor</Button>
          )}
          {schema && (
            <Button size="sm" variant="secondary" onClick={() => openQuery(conn.id, '', schema, database, emptyCommander())}>
              <Wand2 size={14} aria-hidden /> Build a query
            </Button>
          )}
          {schema && !conn.readOnly && (
            <Button size="sm" onClick={() => openDialog({ kind: 'table-designer', connId: conn.id, schema, database })}>
              <Plus size={14} aria-hidden /> New table
            </Button>
          )}
          <Menu>
            <MenuTrigger aria-label="More actions" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <MoreHorizontal size={16} />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<RefreshCw />} onSelect={() => useWorkspace.getState().schemaChanged(conn.id, schema, database)}>Refresh</MenuItem>
              <MenuItem icon={<FileCode2 />} onSelect={() => openQuery(conn.id, '', schema, database)}>Open in query editor</MenuItem>
              {conn.driver !== 'sqlite' && !conn.readOnly && (
                <>
                  <MenuItem icon={<Plus />} onSelect={newContainer}>New {label}…</MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 />} danger onSelect={dropContainer}>Delete {label}…</MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>

      {/* Body */}
      <div className="relative min-h-0 flex-1">
        {showResults ? (
          <Results results={runner.results} active={runner.active} setActive={runner.setActive} error={runner.error} running={!!runner.running} />
        ) : error ? (
          <ErrorPanel message={error} />
        ) : !tables ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5 p-4" role="status" aria-label="Loading tables">
            {[...Array(12)].map((_, i) => <Skeleton key={i} className="h-[62px] rounded-xl" />)}
          </div>
        ) : tables.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Table2 size={22} /></span>
            <div>
              <p className="font-medium">No tables in {schema} yet</p>
              <p className="text-[13px] text-muted-foreground">Create one with the designer, or run CREATE TABLE below.</p>
            </div>
            {!conn.readOnly && <Button onClick={() => openDialog({ kind: 'table-designer', connId: conn.id, schema, database })}><Plus size={15} aria-hidden /> New table</Button>}
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-4">
            {shown.length === 0 && <p className="p-6 text-center text-[13px] text-muted-foreground">No tables match “{filter}”.</p>}
            <motion.ul ref={gridRef} onKeyDown={onGridKey} initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.012 } } }}
              className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
              {shown.map((t) => (
                <motion.li key={t.name} variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}>
                  <ContextMenu
                    content={
                      <>
                        <CtxLabel>{t.name}</CtxLabel>
                        <CtxItem icon={<Table2 />} onSelect={() => openTable(conn.id, ref(t))} shortcut="Enter">Open data</CtxItem>
                        <CtxItem icon={<Wand2 />} onSelect={() => openQuery(conn.id, '', schema, database, emptyCommander(t.name))}>Build a query</CtxItem>
                        <CtxItem icon={<FileCode2 />} onSelect={() => openQuery(conn.id, selectSql(conn.driver, schema, t.name), schema, database)}>Query in editor</CtxItem>
                        <CtxItem icon={<Copy />} onSelect={() => navigator.clipboard.writeText(t.name).then(() => toast.success('Copied name', { duration: 1200 }))}>Copy name</CtxItem>
                        {!conn.readOnly && t.kind === 'table' && (
                          <>
                            <CtxSeparator />
                            <CtxItem icon={<Pencil />} onSelect={() => openDialog({ kind: 'table-designer', connId: conn.id, schema, table: t.name, database })}>Edit structure…</CtxItem>
                            <CtxItem icon={<Eraser />} danger onSelect={() => openDialog({ kind: 'empty-table', connId: conn.id, ref: ref(t) })}>Empty table…</CtxItem>
                          </>
                        )}
                        {!conn.readOnly && (
                          <CtxItem icon={<Trash2 />} danger onSelect={() => openDialog({ kind: 'drop', connId: conn.id, what: t.kind, schema, table: t.name, database })}>Delete {t.kind}…</CtxItem>
                        )}
                      </>
                    }
                  >
                    <button
                      data-card
                      onClick={() => openTable(conn.id, ref(t))}
                      className="group flex w-full items-center gap-3 rounded-xl border bg-surface p-3 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow)] focus-visible:border-primary"
                    >
                      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', t.kind === 'view' ? 'bg-muted text-muted-foreground' : 'bg-accent text-accent-foreground')}>
                        {t.kind === 'view' ? <Eye size={16} /> : <Table2 size={16} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{t.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t.kind === 'view' ? 'View' : [fmtRows(t.rows), fmtBytes(t.bytes)].filter(Boolean).join(' · ') || 'Table'}
                        </span>
                      </span>
                    </button>
                  </ContextMenu>
                </motion.li>
              ))}
            </motion.ul>
          </div>
        )}
      </div>

      {schema && (
        <QueryComposer
          value={tab.sql ?? ''}
          onChange={(sql) => updateTab(tab.id, { sql })}
          onRun={run}
          onStop={runner.stop}
          running={!!runner.running}
          dialect={conn.driver}
          schema={completion}
          scopeLabel={conn.driver === 'sqlite' ? conn.name : database ? `${database}.${schema}` : schema}
          elapsed={elapsed}
        />
      )}
      {runner.confirmDialog}
    </div>
  )
}
