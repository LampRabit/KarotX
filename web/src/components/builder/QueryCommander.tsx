import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDownNarrowWide, ArrowUpNarrowWide, Columns3, Copy, Database, FileCode2, Filter as FilterIcon, Hash, Link2, ListOrdered,
  Play, Plus, Sigma, Square, Table2, X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { api, newId, type ColumnInfo, type ConnView, type ForeignKey, type TableInfo } from '@/lib/api'
import {
  aggLabels, buildSql, colKey, emptyCommander, joinSuggestions, parseColKey,
  type AggFn, type ColRef, type Commander, type JoinType,
} from '@/lib/commander'
import { cn } from '@/lib/cn'
import { containerName } from '@/lib/ddl'
import { modKey } from '@/lib/hooks'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { defaultSchema, fmtRows, Picker, useContainers, useServerDatabases } from '../database/DatabaseTab'
import { Results } from '../query/Results'
import { SqlEditor } from '../query/SqlEditor'
import type { useQueryRunner } from '../query/useQueryRunner'
import { Button } from '../ui/Button'
import { Kbd } from '../ui/Kbd'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover'
import { Select, type Option } from '../ui/Select'
import { FilterBar, type Field } from './FilterBar'

type QTab = Extract<Tab, { kind: 'query' }>
type Runner = ReturnType<typeof useQueryRunner>

function Step({ n, icon, title, hint, children, muted }: { n: number; icon: ReactNode; title: string; hint?: string; children: ReactNode; muted?: boolean }) {
  return (
    <motion.section layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={cn('rounded-xl border bg-surface transition-opacity', muted && 'opacity-55')}>
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-semibold text-accent-foreground" aria-hidden>{n}</span>
        <span className="text-muted-foreground [&>svg]:size-4" aria-hidden>{icon}</span>
        <h3 className="font-semibold">{title}</h3>
        {hint && <span className="ml-auto truncate text-xs text-muted-foreground">{hint}</span>}
      </header>
      <div className="px-3.5 pb-3.5">{children}</div>
    </motion.section>
  )
}

const Remove = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} aria-label={label} className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
    <X size={14} />
  </button>
)

const AddButton = ({ children, onClick, label }: { children: ReactNode; onClick?: () => void; label: string }) => (
  <button type="button" onClick={onClick} aria-label={label}
    className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed px-2.5 text-[13px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
    <Plus size={13} aria-hidden /> {children}
  </button>
)

/**
 * Query Commander: build a query step by step without typing SQL. The SQL is
 * generated live and can be copied or taken to the SQL view.
 */
export function QueryCommander({ conn, tab, runner, onEditSql }: { conn: ConnView; tab: QTab; runner: Runner; onEditSql: (sql: string) => void }) {
  const updateTab = useWorkspace((s) => s.updateTab)
  const version = useWorkspace((s) => s.schemaVersion[conn.id] ?? 0)
  const m = tab.builder ?? emptyCommander()
  const set = useCallback((patch: Partial<Commander>) => updateTab(tab.id, { builder: { ...m, ...patch } }), [m, tab.id, updateTab])

  // Scope: Postgres database + schema, MySQL database, SQLite main.
  const { dbs } = useServerDatabases(conn)
  const database = dbs.length ? (tab.database ?? (conn.info?.database || conn.database || dbs[0])) : undefined
  const { names } = useContainers(conn, database)
  const schema = tab.schema ?? defaultSchema(conn, names)
  const label = containerName(conn.driver)

  const [tables, setTables] = useState<TableInfo[]>()
  const [fks, setFks] = useState<ForeignKey[]>([])
  const [cols, setCols] = useState<Record<string, ColumnInfo[]>>({})

  useEffect(() => {
    if (!schema) return
    setTables(undefined)
    setCols({})
    api.tables(conn.id, schema, database).then(setTables).catch(() => setTables([]))
    api.foreignKeys(conn.id, schema, database).then(setFks).catch(() => setFks([]))
  }, [conn.id, schema, database, version])

  const involved = useMemo(() => [m.source, ...m.joins.map((j) => j.table)].filter(Boolean) as string[], [m.source, m.joins])
  useEffect(() => {
    for (const t of involved) {
      if (cols[t] || !schema) continue
      setCols((c) => ({ ...c, [t]: [] }))
      api.columns(conn.id, { schema, table: t, database }).then((info) => setCols((c) => ({ ...c, [t]: info }))).catch(() => {})
    }
  }, [involved, cols, conn.id, schema, database])

  const multi = involved.length > 1
  const fields: Field[] = useMemo(
    () => involved.flatMap((t) => (cols[t] ?? []).map((c) => ({ ref: { table: t, column: c.name }, type: c.type, label: multi ? `${t}.${c.name}` : c.name, group: multi ? t : undefined }))),
    [involved, cols, multi],
  )
  const typeOf = useCallback((c: ColRef) => cols[c.table]?.find((x) => x.name === c.column)?.type ?? 'text', [cols])
  const fieldOptions = (filter?: (f: Field) => boolean): Option[] =>
    fields.filter(filter ?? (() => true)).map((f) => ({ value: colKey(f.ref), label: f.label, hint: f.type, group: f.group }))
  const colLabel = (c: ColRef) => (multi ? `${c.table}.${c.column}` : c.column)

  const sql = useMemo(() => buildSql(conn.driver, conn.driver === 'sqlite' ? undefined : schema, m, typeOf), [conn.driver, schema, m, typeOf])
  const summarizing = m.groupBy.length > 0 || m.aggregates.length > 0
  const suggestions = joinSuggestions(involved, fks)
  const otherTables = (tables ?? []).filter((t) => !involved.includes(t.name))

  const run = useCallback(() => sql && runner.run(sql), [sql, runner])

  function pickSource(name: string) {
    updateTab(tab.id, { builder: { ...emptyCommander(name), limit: m.limit } })
  }

  function addJoin(table: string, on?: { left: ColRef; right: ColRef }[]) {
    set({ joins: [...m.joins, { id: newId(), table, type: 'left', on: on ?? [{ left: { table: m.source!, column: '' }, right: { table, column: '' } }] }] })
  }

  const tableOptions: Option[] = (tables ?? []).map((t) => ({ value: t.name, label: t.name, hint: t.kind === 'view' ? 'view' : fmtRows(t.rows), icon: <Table2 /> }))

  return (
    <div
      className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(340px,460px)_minmax(0,1fr)]"
      onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && (e.preventDefault(), run())}
    >
      {/* Builder steps */}
      <div className="min-h-0 space-y-2.5 overflow-y-auto border-b bg-sidebar/40 p-3 lg:border-r lg:border-b-0">
        <Step n={1} icon={<Database />} title="Data" hint="Pick the table to start from">
          <div className="space-y-2">
            {conn.driver !== 'sqlite' && (
              <div className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
                <span>From</span>
                {database && (
                  <>
                    <Picker label="database" value={database} items={dbs} placeholder="Database"
                      onPick={(db) => updateTab(tab.id, { database: db, schema: undefined, builder: emptyCommander() })} />
                    <span aria-hidden>/</span>
                  </>
                )}
                <Picker label={label} value={schema} items={names} placeholder={`Choose a ${label}`}
                  onPick={(s) => updateTab(tab.id, { schema: s, builder: emptyCommander() })} />
              </div>
            )}
            <Select label="Table" value={m.source} options={tableOptions} placeholder={tables ? 'Choose a table…' : 'Loading tables…'} searchable onChange={pickSource} />
          </div>
        </Step>

        {m.source && (
          <>
            <Step n={2} icon={<Link2 />} title="Join" hint="Optional · combine related tables">
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {m.joins.map((j, ji) => {
                    const earlier = [m.source!, ...m.joins.slice(0, ji).map((x) => x.table)]
                    const update = (patch: Partial<typeof j>) => set({ joins: m.joins.map((x) => (x.id === j.id ? { ...x, ...patch } : x)) })
                    return (
                      <motion.div key={j.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="space-y-1.5 rounded-lg border bg-background p-2">
                        <div className="flex items-center gap-1.5">
                          <Select variant="token" label="Join type" value={j.type} onChange={(t: JoinType) => update({ type: t })}
                            options={[{ value: 'left', label: 'Left join', hint: 'keep all rows' }, { value: 'inner', label: 'Inner join', hint: 'only matches' }]} />
                          <span className="flex min-w-0 items-center gap-1 truncate font-medium"><Table2 size={14} className="shrink-0 text-primary" aria-hidden />{j.table}</span>
                          <span className="ml-auto" />
                          <Remove label={`Remove join ${j.table}`} onClick={() => set({ joins: m.joins.filter((x) => x.id !== j.id), filters: m.filters.filter((f) => f.col.table !== j.table) })} />
                        </div>
                        {j.on.map((c, ci) => (
                          <div key={ci} className="flex min-w-0 items-center gap-1.5 text-[13px]">
                            <span className="w-6 shrink-0 text-muted-foreground">{ci === 0 ? 'on' : 'and'}</span>
                            <Select variant="token" className="min-w-0 flex-1" label="Left column" value={c.left.column ? colKey(c.left) : undefined} placeholder="column"
                              options={fieldOptions((f) => earlier.includes(f.ref.table))}
                              onChange={(k) => update({ on: j.on.map((x, i) => (i === ci ? { ...x, left: parseColKey(k) } : x)) })} />
                            <span className="text-muted-foreground">=</span>
                            <Select variant="token" className="min-w-0 flex-1" label="Right column" value={c.right.column ? colKey(c.right) : undefined} placeholder="column"
                              options={fieldOptions((f) => f.ref.table === j.table)}
                              onChange={(k) => update({ on: j.on.map((x, i) => (i === ci ? { ...x, right: parseColKey(k) } : x)) })} />
                          </div>
                        ))}
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
                <Popover>
                  <PopoverTrigger asChild><span><AddButton label="Add a join">Join data</AddButton></span></PopoverTrigger>
                  <PopoverContent className="w-80 p-1.5">
                    {suggestions.length > 0 && (
                      <>
                        <p className="px-2 pt-1 pb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">Related tables (foreign keys)</p>
                        {suggestions.map((s) => (
                          <button key={s.table + s.via} type="button" onClick={() => addJoin(s.table, s.on)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent hover:text-accent-foreground">
                            <Link2 size={13} className="shrink-0 text-primary" aria-hidden />
                            <span className="font-medium">{s.table}</span>
                            <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{s.on.map((c) => `${c.left.column} = ${c.right.column}`).join(', ')}</span>
                          </button>
                        ))}
                      </>
                    )}
                    <p className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">Any table</p>
                    <div className="px-1 pb-1">
                      <Select label="Table to join" options={otherTables.map((t) => ({ value: t.name, label: t.name, icon: <Table2 /> }))} placeholder="Choose a table…" searchable onChange={(t) => addJoin(t)} />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </Step>

            <Step n={3} icon={<Columns3 />} title="Columns" hint={summarizing ? 'Set by Summarize below' : m.columns.length ? `${m.columns.length} selected` : 'All columns'} muted={summarizing}>
              {summarizing ? (
                <p className="text-[13px] text-muted-foreground">Grouped results show the “group by” columns and metrics from step 5.</p>
              ) : (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={m.columns.length === 0}
                      onChange={(e) => set({ columns: e.target.checked ? [] : fields.map((f) => f.ref) })} />
                    All columns
                  </label>
                  {m.columns.length > 0 && (
                    <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border bg-background p-2">
                      {involved.map((t) => (
                        <div key={t}>
                          {multi && <p className="mb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{t}</p>}
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-3 gap-y-1">
                            {(cols[t] ?? []).map((c) => {
                              const ref = { table: t, column: c.name }
                              const on = m.columns.some((x) => colKey(x) === colKey(ref))
                              return (
                                <label key={c.name} className="flex min-w-0 items-center gap-1.5 text-[13px]">
                                  <input type="checkbox" className="size-3.5 shrink-0 accent-[var(--primary)]" checked={on}
                                    onChange={() => set({ columns: on ? m.columns.filter((x) => colKey(x) !== colKey(ref)) : [...m.columns, ref] })} />
                                  <span className="truncate">{c.name}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Step>

            <Step n={4} icon={<FilterIcon />} title="Filter" hint="Optional · keep only some rows">
              <FilterBar fields={fields} filters={m.filters} match={m.match} onChange={(filters, match) => set({ filters, match })} addLabel="Add a filter" />
            </Step>

            <Step n={5} icon={<Sigma />} title="Summarize" hint="Optional · group and count">
              <div className="space-y-2.5">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Metrics</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {m.aggregates.map((a) => (
                      <span key={a.id} className="inline-flex max-w-full items-center gap-1 rounded-lg border bg-background p-0.5 pl-1">
                        <Select variant="token" label="Metric" value={a.fn} onChange={(fn: AggFn) => set({ aggregates: m.aggregates.map((x) => (x.id === a.id ? { ...x, fn, col: fn === 'count' ? undefined : x.col } : x)) })}
                          options={(Object.keys(aggLabels) as AggFn[]).map((fn) => ({ value: fn, label: aggLabels[fn] }))} />
                        {a.fn !== 'count' && (
                          <Select variant="token" label="Metric column" value={a.col ? colKey(a.col) : undefined} placeholder="column"
                            options={fieldOptions((f) => a.fn === 'count_distinct' || a.fn === 'min' || a.fn === 'max' || /int|num|dec|float|double|real|money/.test(f.type.toLowerCase()))}
                            onChange={(k) => set({ aggregates: m.aggregates.map((x) => (x.id === a.id ? { ...x, col: parseColKey(k) } : x)) })} />
                        )}
                        <Remove label="Remove metric" onClick={() => set({ aggregates: m.aggregates.filter((x) => x.id !== a.id), sort: m.sort.filter((s) => s.key !== `a:${a.id}`) })} />
                      </span>
                    ))}
                    <AddButton label="Add a metric" onClick={() => set({ aggregates: [...m.aggregates, { id: newId(), fn: 'count' }] })}>Metric</AddButton>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Group by</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {m.groupBy.map((g) => (
                      <span key={colKey(g)} className="inline-flex h-8 items-center gap-1 rounded-lg border bg-background pl-2 text-[13px]">
                        <Hash size={12} className="text-muted-foreground" aria-hidden /> {colLabel(g)}
                        <Remove label={`Stop grouping by ${g.column}`} onClick={() => set({ groupBy: m.groupBy.filter((x) => colKey(x) !== colKey(g)) })} />
                      </span>
                    ))}
                    <span className="w-44">
                      <Select label="Group by column" options={fieldOptions((f) => !m.groupBy.some((g) => colKey(g) === colKey(f.ref)))} placeholder="+ Group by…" searchable
                        onChange={(k) => set({ groupBy: [...m.groupBy, parseColKey(k)] })} />
                    </span>
                  </div>
                </div>
              </div>
            </Step>

            <Step n={6} icon={<ListOrdered />} title="Sort & limit">
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {m.sort.map((s) => {
                    const sortOptions: Option[] = [
                      ...m.aggregates.map((a) => ({ value: `a:${a.id}`, label: a.fn === 'count' ? 'Count' : `${aggLabels[a.fn]} ${a.col?.column ?? ''}`, group: 'Metrics' })),
                      ...fieldOptions(summarizing ? (f) => m.groupBy.some((g) => colKey(g) === colKey(f.ref)) : undefined),
                    ]
                    return (
                      <span key={s.id} className="inline-flex items-center gap-1 rounded-lg border bg-background p-0.5 pl-1">
                        <Select variant="token" label="Sort by" value={s.key} options={sortOptions} onChange={(k) => set({ sort: m.sort.map((x) => (x.id === s.id ? { ...x, key: k } : x)) })} />
                        <button type="button" onClick={() => set({ sort: m.sort.map((x) => (x.id === s.id ? { ...x, desc: !x.desc } : x)) })}
                          aria-label={s.desc ? 'Descending, switch to ascending' : 'Ascending, switch to descending'}
                          className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                          {s.desc ? <ArrowDownNarrowWide size={14} /> : <ArrowUpNarrowWide size={14} />} {s.desc ? 'Desc' : 'Asc'}
                        </button>
                        <Remove label="Remove sort" onClick={() => set({ sort: m.sort.filter((x) => x.id !== s.id) })} />
                      </span>
                    )
                  })}
                  <AddButton label="Add a sort" onClick={() => {
                    const first = m.aggregates[0] ? `a:${m.aggregates[0].id}` : summarizing && m.groupBy[0] ? colKey(m.groupBy[0]) : fields[0] ? colKey(fields[0].ref) : ''
                    if (first) set({ sort: [...m.sort, { id: newId(), key: first, desc: !!m.aggregates[0] }] })
                  }}>Sort</AddButton>
                </div>
                <div className="flex items-center gap-3 text-[13px]">
                  <label className="flex items-center gap-2">
                    Show
                    <input type="number" min={1} value={m.limit ?? ''} disabled={m.limit === null}
                      onChange={(e) => set({ limit: Math.max(1, Number(e.target.value) || 1) })} aria-label="Row limit"
                      className="h-8 w-24 rounded-lg border bg-background px-2 text-[13px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 disabled:opacity-50" />
                    rows
                  </label>
                  <label className="flex items-center gap-1.5 text-muted-foreground">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={m.limit === null} onChange={(e) => set({ limit: e.target.checked ? null : 100 })} />
                    No limit
                  </label>
                </div>
              </div>
            </Step>
          </>
        )}
      </div>

      {/* SQL preview + results */}
      <div className="flex min-h-0 flex-col">
        <div className="shrink-0 border-b">
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <FileCode2 size={14} className="text-muted-foreground" aria-hidden />
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Generated SQL</span>
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={!sql} onClick={() => navigator.clipboard.writeText(sql).then(() => toast.success('SQL copied', { duration: 1200 }))}>
                <Copy size={13} aria-hidden /> Copy
              </Button>
              <Button size="sm" variant="ghost" disabled={!sql} onClick={() => onEditSql(sql)} title="Continue in the SQL editor">
                <FileCode2 size={13} aria-hidden /> Edit as SQL
              </Button>
              {runner.running ? (
                <Button size="sm" variant="secondary" onClick={runner.stop}><Square size={12} className="fill-current text-destructive" aria-hidden /> Stop</Button>
              ) : (
                <Button size="sm" onClick={run} disabled={!sql}><Play size={12} className="fill-current" aria-hidden /> Run <Kbd className="border-primary-foreground/30 bg-transparent text-primary-foreground">{modKey} ↵</Kbd></Button>
              )}
            </div>
          </div>
          <div className="px-2 pb-2">
            {sql ? (
              <SqlEditor value={sql} onChange={() => {}} dialect={conn.driver} schema={{}} onRun={run} readOnly compact={{ minHeight: '40px', maxHeight: '180px' }} />
            ) : (
              <p className="px-1.5 py-3 text-[13px] text-muted-foreground">Pick a table on the left. The SQL appears here as you build.</p>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <Results results={runner.results} active={runner.active} setActive={runner.setActive} error={runner.error} running={!!runner.running}
            empty={
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
                <Play size={22} aria-hidden />
                <p>{sql ? <>Press <b>Run</b> to see the results.</> : 'Results will appear here.'}</p>
              </div>
            } />
        </div>
      </div>
    </div>
  )
}
