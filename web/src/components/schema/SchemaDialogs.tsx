import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { api, newId, type ConnView } from '@/lib/api'
import { track } from '@/lib/activity'
import { createDatabase, createSchema, dropDatabase, dropSchema, dropTable, emptyTable } from '@/lib/ddl'
import { useDialogs } from '@/lib/dialogs'
import { useWorkspace } from '@/lib/workspace'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { TableDesigner } from './TableDesigner'

/** Runs DDL statements as one script; throws on the first failing statement. */
export async function runDDL(conn: ConnView, stmts: string[], schema: string | undefined, label: string, database?: string) {
  const res = await track(label, api.query(conn.id, stmts.join(';\n'), newId(), true, conn.driver === 'sqlite' ? undefined : schema, database))
  const failed = res.find((r) => r.error)
  if (failed) throw new Error(failed.error)
}

export function SqlPreview({ stmts }: { stmts: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium">SQL that will run</p>
      <pre className="max-h-48 overflow-auto rounded-xl border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {stmts.length ? stmts.map((s) => s + ';').join('\n\n') : <span className="text-muted-foreground">No changes yet.</span>}
      </pre>
    </div>
  )
}

export function ProductionAck({ conn, ack, setAck }: { conn: ConnView; ack: boolean; setAck: (v: boolean) => void }) {
  if (!conn.production) return null
  return (
    <label className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3 text-[13px]">
      <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[var(--destructive)]" />
      <span><span className="font-medium text-destructive">{conn.name} is a production database.</span> I have checked this change.</span>
    </label>
  )
}

function SimpleAction({ conn, title, text, stmts, schema, database, before, confirmText, danger, actionLabel, onDone, onClose }: {
  conn: ConnView; title: string; text: React.ReactNode; stmts: string[]; schema?: string; database?: string
  /** Runs before the SQL (e.g. close our own sessions on a database about to be dropped). */
  before?: () => Promise<unknown>
  confirmText?: string; danger?: boolean; actionLabel: string; onDone: () => void; onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ack, setAck] = useState(false)
  async function run() {
    setBusy(true)
    setError('')
    try {
      await before?.()
      await runDDL(conn, stmts, schema, title, database)
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

/** MySQL: new database. Postgres: new schema in `database`, or (server) a new database on the server. */
function CreateDatabase({ conn, database, server, onClose }: { conn: ConnView; database?: string; server?: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const pgSchema = conn.driver === 'postgres' && !server
  const label = pgSchema ? 'schema' : 'database'
  const { schemaChanged, openDatabase } = useWorkspace()
  const n = name.trim()
  return (
    <SimpleAction
      conn={conn}
      title={pgSchema && database ? `New schema in ${database}` : `New ${label}`}
      text={<Input label={`${label[0].toUpperCase() + label.slice(1)} name`} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. analytics" className="mt-2 w-80" />}
      stmts={n ? [pgSchema ? createSchema(conn.driver, n) : createDatabase(conn.driver, n)] : []}
      database={pgSchema ? database : undefined}
      actionLabel={`Create ${label}`}
      onDone={() => {
        toast.success(`Created ${n}`)
        schemaChanged(conn.id, undefined, pgSchema ? database : undefined)
        if (conn.driver === 'postgres') openDatabase(conn.id, pgSchema ? n : 'public', pgSchema ? database : n)
        else openDatabase(conn.id, n)
      }}
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
      body = <TableDesigner key={`${relevant.database}.${relevant.schema}.${relevant.table}`} conn={conn} schema={relevant.schema} table={relevant.table} database={relevant.database} onClose={close} />
    } else if (relevant.kind === 'create-database') {
      body = <CreateDatabase conn={conn} database={relevant.database} server={relevant.server} onClose={close} />
    } else if (relevant.kind === 'drop') {
      const { what, schema, database } = relevant
      const container = what === 'schema' || what === 'database'
      const target = container ? schema : relevant.table!
      // A Postgres database is dropped from the main session after closing ours on it.
      const pgDatabase = conn.driver === 'postgres' && what === 'database'
      const stmts = [
        what === 'database' ? dropDatabase(conn.driver, target)
        : what === 'schema' ? dropSchema(conn.driver, target)
        : dropTable(conn.driver, schema, target, what === 'view'),
      ]
      const closes = (t: (typeof ws.tabs)[number]) => {
        if (t.connId !== conn.id) return false
        const tdb = t.kind === 'table' ? t.table.database : t.database
        const tschema = t.kind === 'table' ? t.table.schema : t.schema
        if (pgDatabase) return tdb === target
        if (container) return tschema === target && (tdb ?? '') === (database ?? '')
        return t.kind === 'table' && t.table.table === target && t.table.schema === schema && (tdb ?? '') === (database ?? '')
      }
      body = (
        <SimpleAction
          conn={conn}
          danger
          title={`Delete ${what} ${target}?`}
          text={container ? `This permanently deletes the ${what} and every table in it. This can't be undone.` : `This permanently deletes the ${what}${what === 'table' ? ' and all its rows' : ''}. This can't be undone.`}
          stmts={stmts}
          schema={container ? undefined : schema}
          database={pgDatabase ? undefined : database}
          before={pgDatabase ? () => api.disconnect(conn.id, target) : undefined}
          confirmText={target}
          actionLabel={`Delete ${what}`}
          onDone={() => {
            toast.success(`Deleted ${target}`)
            ws.closeTabs(ws.tabs.filter(closes).map((t) => t.id))
            ws.schemaChanged(conn.id, container ? undefined : schema, pgDatabase ? undefined : database)
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
          database={relevant.ref.database}
          confirmText={relevant.ref.table}
          actionLabel="Delete all rows"
          onDone={() => (toast.success(`Emptied ${relevant.ref.table}`), ws.schemaChanged(conn.id, relevant.ref.schema, relevant.ref.database))}
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
