import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, type ConnView, type KeyAttr } from '@/lib/api'
import { track } from '@/lib/activity'
import { useWorkspace } from '@/lib/workspace'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'

const keyTypes: { value: KeyAttr['type']; label: string }[] = [
  { value: 'S', label: 'Text' }, { value: 'N', label: 'Number' }, { value: 'B', label: 'Binary' },
]

/** A DynamoDB key attribute: name + type. */
function KeyField({ label, value, onChange, hint }: { label: string; value: KeyAttr; onChange: (k: KeyAttr) => void; hint?: string }) {
  return (
    <div className="grid grid-cols-[1fr_120px] items-start gap-2">
      <Input label={label} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} hint={hint} placeholder="e.g. id" />
      <div className="pt-[22px]"><Select label={`${label} type`} value={value.type} options={keyTypes} onChange={(type) => onChange({ ...value, type })} /></div>
    </div>
  )
}

/** New MongoDB collection, in an existing database or a new one (databases appear with their first collection). */
export function MongoCreate({ conn, db, onClose }: { conn: ConnView; db?: string; onClose: () => void }) {
  const [dbName, setDbName] = useState(db ?? '')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pk, setPk] = useState<KeyAttr>({ name: 'id', type: 'S' })
  const [sk, setSk] = useState<KeyAttr>({ name: '', type: 'S' })
  const { schemaChanged, openTable } = useWorkspace()
  const dynamo = conn.driver === 'dynamodb'
  const word = dynamo ? 'table' : 'collection'

  async function create() {
    const d = dbName.trim(), c = name.trim()
    if (!d || !c || (dynamo && !pk.name.trim())) return
    setBusy(true)
    setError('')
    try {
      const keys = dynamo ? [pk, sk].filter((k) => k.name.trim()).map((k) => ({ ...k, name: k.name.trim() })) : undefined
      await track(`Creating ${word}`, api.mongo.createCollection(conn.id, d, c, keys))
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
        <h2 className="text-[15px] font-semibold">{dynamo ? 'New DynamoDB table' : db ? `New collection in ${db}` : 'New database'}</h2>
        {dynamo && <p className="mt-1 text-[13px] text-muted-foreground">Items are identified by the partition key, plus the sort key if you add one. Keys can’t be changed later. Billing is on demand.</p>}
        {!db && <p className="mt-1 text-[13px] text-muted-foreground">MongoDB creates a database together with its first collection.</p>}
      </div>
      {!db && <Input label="Database name" value={dbName} onChange={(e) => setDbName(e.target.value)} autoFocus placeholder="e.g. shop" />}
      <Input label={dynamo ? 'Table name' : 'Collection name'} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!db} placeholder="e.g. orders" />
      {dynamo && (
        <>
          <KeyField label="Partition key" value={pk} onChange={setPk} />
          <KeyField label="Sort key" value={sk} onChange={setSk} hint="Optional. Groups items with the same partition key, in order." />
        </>
      )}
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy} disabled={!dbName.trim() || !name.trim() || (dynamo && !pk.name.trim())}>Create</Button>
      </div>
    </form>
  )
}

/** Drop a collection, or a whole database: type the name to confirm. */
export function MongoDrop({ conn, db, collection, onClose }: { conn: ConnView; db: string; collection?: string; onClose: () => void }) {
  const target = collection ?? db
  const word = conn.driver === 'dynamodb' ? 'table' : 'collection'
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
          <h2 className="text-[15px] font-semibold">Drop {collection ? word : 'database'} {target}?</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {collection ? `All ${conn.driver === 'dynamodb' ? 'items' : 'documents and indexes'} in this ${word} are deleted permanently.` : 'Every collection and document in this database is deleted permanently.'}
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
        <Button type="submit" variant="danger" loading={busy} disabled={typed !== target || (conn.production && !ack)}>Drop {collection ? word : 'database'}</Button>
      </div>
    </form>
  )
}
