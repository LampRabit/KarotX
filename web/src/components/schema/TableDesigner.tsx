import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Info, KeyRound, MoreVertical, Plus, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { api, newId, type ColumnInfo, type ConnView } from '@/lib/api'
import { cn } from '@/lib/cn'
import { alterTable, containerName, createTable, fromInfo, typeSuggestions, type DesignColumn, type SqliteObject } from '@/lib/ddl'
import { useWorkspace } from '@/lib/workspace'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu'
import { Skeleton } from '../ui/Skeleton'
import { ProductionAck, runDDL, SqlPreview } from './SchemaDialogs'

const blankColumn = (d: ConnView['driver']): DesignColumn => ({
  key: newId(), name: '', type: d === 'sqlite' ? 'TEXT' : d === 'mysql' ? 'varchar(255)' : 'text', nullable: true, default: '', primaryKey: false, autoIncrement: false,
})

// Every track is shrinkable (minmax(0, …)), so the rows fit the dialog without horizontal scrolling.
const COLS = 'grid-cols-[18px_minmax(0,1.35fr)_minmax(0,1.15fr)_minmax(0,1fr)_34px_34px_34px_30px]'
const field = 'h-9 w-full min-w-0 rounded-lg border bg-background px-2.5 font-mono text-[13px] outline-none transition placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 disabled:opacity-50'

function Toggle({ on, label, onClick, disabled, title, children }: { on: boolean; label: string; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} title={title ?? label} disabled={disabled} onClick={onClick}
      className={cn('mx-auto flex size-8 items-center justify-center rounded-lg border text-xs font-semibold transition disabled:opacity-35',
        on ? 'border-primary/40 bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:bg-muted')}>
      {children}
    </button>
  )
}

export function TableDesigner({ conn, schema, table, database, onClose }: { conn: ConnView; schema: string; table?: string; database?: string; onClose: () => void }) {
  const d = conn.driver
  const [name, setName] = useState(table ?? '')
  const [before, setBefore] = useState<ColumnInfo[]>()
  const [objects, setObjects] = useState<SqliteObject[]>([])
  const [cols, setCols] = useState<DesignColumn[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState(false)
  const schemaChanged = useWorkspace((s) => s.schemaChanged)

  useEffect(() => {
    if (!table) {
      setCols([{ key: newId(), name: 'id', type: d === 'sqlite' ? 'INTEGER' : 'bigint', nullable: false, default: '', primaryKey: true, autoIncrement: true }, blankColumn(d)])
      return
    }
    api.columns(conn.id, { database, schema, table }).then((info) => (setBefore(info), setCols(info.map(fromInfo)))).catch((e) => setError(e.message))
    if (d === 'sqlite') {
      // Indexes and triggers must be recreated if the table is rebuilt.
      const lit = table.replace(/'/g, "''")
      api.query(conn.id, `SELECT type, name, sql FROM sqlite_master WHERE tbl_name = '${lit}' AND type IN ('index','trigger') AND sql IS NOT NULL`, newId())
        .then((r) => setObjects((r[0]?.rows ?? []).map(([type, n, sql]) => ({ type: String(type), name: String(n), sql: String(sql) }))))
        .catch(() => {})
    }
  }, [conn.id, schema, table, database, d])

  const named = cols.filter((c) => c.name.trim())
  const { stmts, warnings, notes } = useMemo(() => {
    const empty = { stmts: [] as string[], warnings: [] as string[], notes: [] as string[] }
    if (!name.trim() || named.length === 0) return empty
    if (!table) return { ...empty, stmts: createTable(d, schema, name.trim(), named) }
    if (!before) return empty
    return alterTable(d, schema, table, name.trim(), before, named, objects)
  }, [d, schema, table, name, named, before, objects])

  const set = (key: string, patch: Partial<DesignColumn>) => setCols((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  const move = (i: number, by: number) => setCols((cs) => {
    const j = i + by
    if (j < 0 || j >= cs.length) return cs
    const next = [...cs]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const remove = (key: string) => setCols((cs) => cs.filter((x) => x.key !== key))
  const add = () => {
    setCols((cs) => [...cs, blankColumn(d)])
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-col-row]:last-of-type input`)?.focus())
  }

  // Row shortcuts: Alt+↑/↓ move the column, Ctrl+Enter adds one, Ctrl+Backspace removes it.
  function onRowKey(e: React.KeyboardEvent, i: number, key: string) {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      move(i, e.key === 'ArrowUp' ? -1 : 1)
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace' && cols.length > 1) {
      e.preventDefault()
      remove(key)
    }
  }

  // Auto-increment only applies to a single-column key; existing tables can change it on SQLite (via rebuild).
  const singlePk = cols.filter((c) => c.primaryKey).length === 1
  const autoAllowed = (c: DesignColumn) => c.primaryKey && singlePk && (!table || d === 'sqlite' || !c.orig)

  async function apply() {
    setBusy(true)
    setError('')
    try {
      await runDDL(conn, stmts, schema, table ? 'Altering table' : 'Creating table', database)
      toast.success(table ? `Updated ${name}` : `Created ${name}`)
      schemaChanged(conn.id, schema, database)
      if (!table) useWorkspace.getState().openTable(conn.id, { database, schema: d === 'sqlite' ? 'main' : schema, table: name.trim() })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const listId = `types-${d}`
  return (
    <div className="flex max-h-[min(820px,92vh)] flex-col">
      <header className="border-b px-6 py-4 pr-14">
        <h2 className="text-[15px] font-semibold">{table ? `Edit table ${table}` : 'New table'}</h2>
        <p className="text-[13px] text-muted-foreground">{d === 'sqlite' ? conn.name : `In ${containerName(d)} ${database ? `${database}.` : ''}${schema}`} · changes are previewed as SQL before they run</p>
      </header>
      <div className="flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-6 py-5">
        <Input label="Table name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!table} placeholder="e.g. customers" className="max-w-sm" />

        <div>
          <div className={cn('grid items-end gap-2 px-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase', COLS)}>
            <span />
            <span>Column</span>
            <span>Type</span>
            <span>Default</span>
            <span className="text-center" title="Allows NULL">Null</span>
            <span className="text-center" title="Primary key">Key</span>
            <span className="text-center" title="Auto increment">Auto</span>
            <span />
          </div>
          {!before && table && !error ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <ul className="space-y-1.5" aria-label="Columns">
              {cols.map((c, i) => (
                <motion.li
                  key={c.key}
                  data-col-row
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  onKeyDown={(e) => onRowKey(e, i, c.key)}
                  className={cn('grid items-center gap-2 rounded-lg px-1 py-0.5 focus-within:bg-muted/50 hover:bg-muted/40', COLS)}
                >
                  <span className="text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <input aria-label={`Column ${i + 1} name`} value={c.name} onChange={(e) => set(c.key, { name: e.target.value })} placeholder="column_name" className={field} />
                  <input aria-label={`Column ${i + 1} type`} list={listId} value={c.type} onChange={(e) => set(c.key, { type: e.target.value })} className={field} />
                  <input aria-label={`Column ${i + 1} default`} value={c.default} disabled={c.autoIncrement} onChange={(e) => set(c.key, { default: e.target.value })}
                    placeholder={c.autoIncrement ? 'auto' : "'text', 0, now()"} className={field} />
                  <Toggle on={c.nullable} label={`Column ${i + 1} allows NULL`} disabled={c.primaryKey} onClick={() => set(c.key, { nullable: !c.nullable })}>
                    {c.nullable ? 'Ø' : '—'}
                  </Toggle>
                  <Toggle on={c.primaryKey} label={`Column ${i + 1} primary key`}
                    onClick={() => set(c.key, { primaryKey: !c.primaryKey, nullable: c.primaryKey ? c.nullable : false, autoIncrement: c.primaryKey ? false : c.autoIncrement })}>
                    <KeyRound size={14} />
                  </Toggle>
                  <Toggle on={c.autoIncrement && autoAllowed(c)} label={`Column ${i + 1} auto increment`} disabled={!autoAllowed(c)}
                    title={autoAllowed(c) ? 'Auto increment' : 'Only for a single-column primary key'}
                    onClick={() => set(c.key, { autoIncrement: !c.autoIncrement, default: '' })}>
                    1+
                  </Toggle>
                  <Menu>
                    <MenuTrigger aria-label={`Column ${i + 1} actions`} className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
                      <MoreVertical size={15} />
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem icon={<ArrowUp />} onSelect={() => move(i, -1)}>Move up <span className="ml-auto pl-4 text-xs text-muted-foreground">Alt ↑</span></MenuItem>
                      <MenuItem icon={<ArrowDown />} onSelect={() => move(i, 1)}>Move down <span className="ml-auto pl-4 text-xs text-muted-foreground">Alt ↓</span></MenuItem>
                      <MenuSeparator />
                      <MenuItem icon={<Trash2 />} danger onSelect={() => remove(c.key)}>Remove column</MenuItem>
                    </MenuContent>
                  </Menu>
                </motion.li>
              ))}
            </ul>
          )}
          <datalist id={listId}>{typeSuggestions[d].map((t) => <option key={t} value={t} />)}</datalist>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="secondary" onClick={add}><Plus size={14} aria-hidden /> Add column</Button>
            <span className="text-xs text-muted-foreground">
              Ø = allows NULL · Ctrl+Enter adds a column · Alt+↑/↓ moves it
              {table && d !== 'sqlite' ? ' · column order only applies to new tables' : ''}
            </span>
          </div>
        </div>

        {notes.map((n) => (
          <p key={n} className="flex items-start gap-2 rounded-lg bg-accent p-2.5 text-[13px] text-accent-foreground"><Info size={15} className="mt-0.5 shrink-0" />{n}</p>
        ))}
        {warnings.map((w) => (
          <p key={w} className="flex items-start gap-2 rounded-lg bg-warning/10 p-2.5 text-[13px]"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />{w}</p>
        ))}
        <SqlPreview stmts={stmts} />
        <ProductionAck conn={conn} ack={ack} setAck={setAck} />
        {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 font-mono text-[13px] whitespace-pre-wrap text-destructive">{error}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t bg-sidebar/60 px-6 py-4">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} disabled={stmts.length === 0 || (conn.production && !ack)} onClick={apply}>
          {table ? 'Apply changes' : 'Create table'}
        </Button>
      </footer>
    </div>
  )
}
