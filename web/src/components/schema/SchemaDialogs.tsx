import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, KeyRound, Plus, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { api, newId, type ColumnInfo, type ConnView } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { alterTable, containerName, createDatabase, createTable, dropDatabase, dropTable, emptyTable, fromInfo, typeSuggestions, type DesignColumn } from '@/lib/ddl'
import { useDialogs } from '@/lib/dialogs'
import { useWorkspace } from '@/lib/workspace'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Skeleton } from '../ui/Skeleton'

/** Runs DDL statements as one script; throws on the first failing statement. */
async function runDDL(conn: ConnView, stmts: string[], schema: string | undefined, label: string) {
  const res = await track(label, api.query(conn.id, stmts.join(';\n'), newId(), true, conn.driver === 'sqlite' ? undefined : schema))
  const failed = res.find((r) => r.error)
  if (failed) throw new Error(failed.error)
}

function SqlPreview({ stmts }: { stmts: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium">SQL that will run</p>
      <pre className="max-h-48 overflow-auto rounded-xl border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {stmts.length ? stmts.map((s) => s + ';').join('\n\n') : <span className="text-muted-foreground">No changes yet.</span>}
      </pre>
    </div>
  )
}

function ProductionAck({ conn, ack, setAck }: { conn: ConnView; ack: boolean; setAck: (v: boolean) => void }) {
  if (!conn.production) return null
  return (
    <label className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3 text-[13px]">
      <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[var(--destructive)]" />
      <span><span className="font-medium text-destructive">{conn.name} is a production database.</span> I have checked this change.</span>
    </label>
  )
}

const blankColumn = (d: ConnView['driver']): DesignColumn => ({
  key: newId(), name: '', type: d === 'sqlite' ? 'TEXT' : d === 'mysql' ? 'varchar(255)' : 'text', nullable: true, default: '', primaryKey: false, autoIncrement: false,
})

function TableDesigner({ conn, schema, table, onClose }: { conn: ConnView; schema: string; table?: string; onClose: () => void }) {
  const d = conn.driver
  const [name, setName] = useState(table ?? '')
  const [before, setBefore] = useState<ColumnInfo[]>()
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
    api.columns(conn.id, { schema, table }).then((info) => (setBefore(info), setCols(info.map(fromInfo)))).catch((e) => setError(e.message))
  }, [conn.id, schema, table, d])

  const named = cols.filter((c) => c.name.trim())
  const { stmts, warnings } = useMemo(() => {
    if (!name.trim() || named.length === 0) return { stmts: [], warnings: [] }
    if (!table) return { stmts: createTable(d, schema, name.trim(), named), warnings: [] }
    if (!before) return { stmts: [], warnings: [] }
    return alterTable(d, schema, table, name.trim(), before, named)
  }, [d, schema, table, name, named, before])

  const set = (key: string, patch: Partial<DesignColumn>) => setCols((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  const move = (i: number, by: number) => setCols((cs) => {
    const next = [...cs]
    const [c] = next.splice(i, 1)
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, c)
    return next
  })

  async function apply() {
    setBusy(true)
    setError('')
    try {
      await runDDL(conn, stmts, schema, table ? 'Altering table' : 'Creating table')
      toast.success(table ? `Updated ${name}` : `Created ${name}`)
      schemaChanged(conn.id, schema)
      if (!table) useWorkspace.getState().openTable(conn.id, { schema: d === 'sqlite' ? 'main' : schema, table: name.trim() })
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
        <p className="text-[13px] text-muted-foreground">{d === 'sqlite' ? conn.name : `In ${containerName(d)} ${schema}`} · changes are previewed as SQL before they run</p>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <Input label="Table name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!table} placeholder="e.g. customers" className="max-w-sm" />
        <div>
          <div className="grid grid-cols-[28px_1.3fr_1.1fr_64px_1fr_44px_56px_68px] items-center gap-2 px-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <span /> <span>Column</span> <span>Type</span> <span className="text-center">Null</span> <span>Default</span>
            <span className="text-center" title="Primary key">Key</span> <span className="text-center" title="Auto increment">Auto</span> <span />
          </div>
          {!before && table && !error ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <ul className="space-y-1.5">
              {cols.map((c, i) => (
                <motion.li key={c.key} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-[28px_1.3fr_1.1fr_64px_1fr_44px_56px_68px] items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-muted/40">
                  <span className="text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <input aria-label={`Column ${i + 1} name`} value={c.name} onChange={(e) => set(c.key, { name: e.target.value })} placeholder="column_name"
                    className="h-9 rounded-lg border bg-background px-2.5 font-mono text-[13px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20" />
                  <input aria-label={`Column ${i + 1} type`} list={listId} value={c.type} onChange={(e) => set(c.key, { type: e.target.value })}
                    className="h-9 rounded-lg border bg-background px-2.5 font-mono text-[13px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20" />
                  <input type="checkbox" aria-label={`Column ${i + 1} allows NULL`} checked={c.nullable} disabled={c.primaryKey} onChange={(e) => set(c.key, { nullable: e.target.checked })} className="mx-auto size-4 accent-[var(--primary)]" />
                  <input aria-label={`Column ${i + 1} default`} value={c.default} disabled={c.autoIncrement} onChange={(e) => set(c.key, { default: e.target.value })} placeholder={c.autoIncrement ? 'auto' : "e.g. 'new' or now()"}
                    className="h-9 rounded-lg border bg-background px-2.5 font-mono text-[13px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 disabled:opacity-50" />
                  <button type="button" aria-pressed={c.primaryKey} aria-label={`Column ${i + 1} primary key`} disabled={!!c.orig}
                    title={c.orig ? 'Change primary keys with SQL' : 'Primary key'}
                    onClick={() => set(c.key, { primaryKey: !c.primaryKey, nullable: c.primaryKey ? c.nullable : false })}
                    className={cn('mx-auto flex size-8 items-center justify-center rounded-lg transition disabled:opacity-60', c.primaryKey ? 'bg-warning/15 text-warning' : 'text-muted-foreground hover:bg-muted')}>
                    <KeyRound size={15} />
                  </button>
                  <input type="checkbox" aria-label={`Column ${i + 1} auto increment`} checked={c.autoIncrement} disabled={!!c.orig || !c.primaryKey}
                    onChange={(e) => set(c.key, { autoIncrement: e.target.checked })} className="mx-auto size-4 accent-[var(--primary)]" />
                  <span className="flex justify-end gap-0.5">
                    <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp size={13} /></button>
                    <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === cols.length - 1} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown size={13} /></button>
                    <button type="button" aria-label={`Remove column ${c.name || i + 1}`} onClick={() => setCols((cs) => cs.filter((x) => x.key !== c.key))} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={13} /></button>
                  </span>
                </motion.li>
              ))}
            </ul>
          )}
          <datalist id={listId}>{typeSuggestions[d].map((t) => <option key={t} value={t} />)}</datalist>
          <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setCols((cs) => [...cs, blankColumn(d)])}>
            <Plus size={14} aria-hidden /> Add column
          </Button>
          {table && <p className="mt-2 text-xs text-muted-foreground">Column order of existing tables can't be changed; reordering only affects new tables.</p>}
        </div>

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

function SimpleAction({ conn, title, text, stmts, schema, confirmText, danger, actionLabel, onDone, onClose }: {
  conn: ConnView; title: string; text: React.ReactNode; stmts: string[]; schema?: string; confirmText?: string
  danger?: boolean; actionLabel: string; onDone: () => void; onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ack, setAck] = useState(false)
  async function run() {
    setBusy(true)
    setError('')
    try {
      await runDDL(conn, stmts, schema, title)
      onDone()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => (e.preventDefault(), run())} className="space-y-4 p-6">
      <div className="flex gap-3">
        {danger && <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle size={18} /></span>}
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <div className="mt-1 text-[13px] text-muted-foreground">{text}</div>
        </div>
      </div>
      {confirmText && (
        <Input label={`Type ${confirmText} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
      )}
      <SqlPreview stmts={stmts} />
      <ProductionAck conn={conn} ack={ack} setAck={setAck} />
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 font-mono text-[13px] whitespace-pre-wrap text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy} disabled={(!!confirmText && typed !== confirmText) || (conn.production && !ack)}>
          {actionLabel}
        </Button>
      </div>
    </form>
  )
}

function CreateDatabase({ conn, onClose }: { conn: ConnView; onClose: () => void }) {
  const [name, setName] = useState('')
  const label = containerName(conn.driver)
  const { schemaChanged, openDatabase } = useWorkspace()
  return (
    <SimpleAction
      conn={conn}
      title={`New ${label}`}
      text={<Input label={`${label[0].toUpperCase() + label.slice(1)} name`} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. analytics" className="mt-2 w-80" />}
      stmts={name.trim() ? [createDatabase(conn.driver, name.trim())] : []}
      actionLabel={`Create ${label}`}
      onDone={() => (toast.success(`Created ${name}`), schemaChanged(conn.id), openDatabase(conn.id, name.trim()))}
      onClose={onClose}
    />
  )
}

/** Mounts whichever schema dialog is open (see lib/dialogs.ts). */
export function SchemaDialogs() {
  const { dialog, close } = useDialogs()
  const connections = useWorkspace((s) => s.connections)
  const ws = useWorkspace()
  const relevant = dialog && 'connId' in dialog ? dialog : null
  const conn = relevant ? connections.find((c) => c.id === relevant.connId) : undefined
  const open = !!relevant && !!conn

  let body: React.ReactNode = null
  let wide = false
  if (open && relevant && conn) {
    if (relevant.kind === 'table-designer') {
      wide = true
      body = <TableDesigner key={`${relevant.schema}.${relevant.table}`} conn={conn} schema={relevant.schema} table={relevant.table} onClose={close} />
    } else if (relevant.kind === 'create-database') {
      body = <CreateDatabase conn={conn} onClose={close} />
    } else if (relevant.kind === 'drop') {
      const isDb = relevant.what === 'database'
      const target = isDb ? relevant.schema : relevant.table!
      body = (
        <SimpleAction
          conn={conn}
          danger
          title={`Delete ${relevant.what} ${target}?`}
          text={isDb ? `This permanently deletes the ${containerName(conn.driver)} and every table in it. This can't be undone.` : `This permanently deletes the ${relevant.what}${relevant.what === 'table' ? ' and all its rows' : ''}. This can't be undone.`}
          stmts={[isDb ? dropDatabase(conn.driver, target) : dropTable(conn.driver, relevant.schema, target, relevant.what === 'view')]}
          schema={isDb ? undefined : relevant.schema}
          confirmText={target}
          actionLabel={`Delete ${relevant.what}`}
          onDone={() => {
            toast.success(`Deleted ${target}`)
            ws.closeTabs(ws.tabs.filter((t) => t.connId === conn.id && (isDb ? (t.kind === 'database' && t.schema === target) || (t.kind === 'table' && t.table.schema === target) : t.kind === 'table' && t.table.table === target)).map((t) => t.id))
            ws.schemaChanged(conn.id, isDb ? undefined : relevant.schema)
          }}
          onClose={close}
        />
      )
    } else if (relevant.kind === 'empty-table') {
      body = (
        <SimpleAction
          conn={conn}
          danger
          title={`Empty ${relevant.ref.table}?`}
          text="Every row in this table will be deleted. The table and its columns stay."
          stmts={[emptyTable(conn.driver, relevant.ref.schema, relevant.ref.table)]}
          schema={relevant.ref.schema}
          confirmText={relevant.ref.table}
          actionLabel="Delete all rows"
          onDone={() => (toast.success(`Emptied ${relevant.ref.table}`), ws.schemaChanged(conn.id, relevant.ref.schema))}
          onClose={close}
        />
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title="Schema" className={wide ? 'max-w-5xl' : 'max-w-lg'}>
      {body}
    </Dialog>
  )
}
