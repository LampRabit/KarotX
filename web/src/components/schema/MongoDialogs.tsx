import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, type ConnView } from '@/lib/api'
import { track } from '@/lib/activity'
import { useWorkspace } from '@/lib/workspace'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

/** New MongoDB collection, in an existing database or a new one (databases appear with their first collection). */
export function MongoCreate({ conn, db, onClose }: { conn: ConnView; db?: string; onClose: () => void }) {
  const [dbName, setDbName] = useState(db ?? '')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { schemaChanged, openTable } = useWorkspace()

  async function create() {
    const d = dbName.trim(), c = name.trim()
    if (!d || !c) return
    setBusy(true)
    setError('')
    try {
      await track('Creating collection', api.mongo.createCollection(conn.id, d, c))
      toast.success(`Created ${d}.${c}`)
      schemaChanged(conn.id, d)
      openTable(conn.id, { schema: d, table: c })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => (e.preventDefault(), create())} className="space-y-4 p-6">
      <div>
        <h2 className="text-[15px] font-semibold">{db ? `New collection in ${db}` : 'New database'}</h2>
        {!db && <p className="mt-1 text-[13px] text-muted-foreground">MongoDB creates a database together with its first collection.</p>}
      </div>
      {!db && <Input label="Database name" value={dbName} onChange={(e) => setDbName(e.target.value)} autoFocus placeholder="e.g. shop" />}
      <Input label="Collection name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!db} placeholder="e.g. orders" />
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy} disabled={!dbName.trim() || !name.trim()}>Create</Button>
      </div>
    </form>
  )
}

/** Drop a collection, or a whole database: type the name to confirm. */
export function MongoDrop({ conn, db, collection, onClose }: { conn: ConnView; db: string; collection?: string; onClose: () => void }) {
  const target = collection ?? db
  const [typed, setTyped] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ws = useWorkspace()

  async function drop() {
    setBusy(true)
    setError('')
    try {
      await track('Dropping', api.mongo.drop(conn.id, db, collection ?? '', conn.production && ack))
      toast.success(`Dropped ${target}`)
      ws.closeTabs(ws.tabs.filter((t) => t.connId === conn.id && (
        (t.kind === 'table' && t.table.schema === db && (!collection || t.table.table === collection)) ||
        (!collection && t.kind === 'database' && t.schema === db))).map((t) => t.id))
      ws.schemaChanged(conn.id, collection ? db : undefined)
      onClose()
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => (e.preventDefault(), drop())} className="space-y-4 p-6">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle size={18} /></span>
        <div>
          <h2 className="text-[15px] font-semibold">Drop {collection ? 'collection' : 'database'} {target}?</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {collection ? 'All documents and indexes in this collection are deleted permanently.' : 'Every collection and document in this database is deleted permanently.'}
          </p>
        </div>
      </div>
      <Input label={`Type ${target} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
      {conn.production && (
        <label className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3 text-[13px]">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[var(--destructive)]" />
          <span><span className="font-medium text-destructive">{conn.name} is a production database.</span> I have checked this.</span>
        </label>
      )}
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="danger" loading={busy} disabled={typed !== target || (conn.production && !ack)}>Drop {collection ? 'collection' : 'database'}</Button>
      </div>
    </form>
  )
}
