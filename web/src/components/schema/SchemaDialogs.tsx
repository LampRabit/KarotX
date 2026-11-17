import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { api, newId, type ConnView } from '@/lib/api'
import { track } from '@/lib/activity'
import { containerName, createDatabase, dropDatabase, dropTable, emptyTable } from '@/lib/ddl'
import { useDialogs } from '@/lib/dialogs'
import { useWorkspace } from '@/lib/workspace'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { TableDesigner } from './TableDesigner'

/** Runs DDL statements as one script; throws on the first failing statement. */
export async function runDDL(conn: ConnView, stmts: string[], schema: string | undefined, label: string) {
  const res = await track(label, api.query(conn.id, stmts.join(';\n'), newId(), true, conn.driver === 'sqlite' ? undefined : schema))
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
