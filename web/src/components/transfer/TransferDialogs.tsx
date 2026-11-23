import { useEffect, useState } from 'react'
import { Database, FileCode2, KeyRound, Layers, Table2 } from 'lucide-react'
import type { ConnView } from '@/lib/api'
import { useDialogs } from '@/lib/dialogs'
import type { TransferTarget } from '@/lib/exporter'
import { safeName } from '@/lib/transfer'
import { useWorkspace } from '@/lib/workspace'
import { Dialog } from '../ui/Dialog'
import { ExportDialog } from './ExportDialog'
import { ImportDialog } from './ImportDialog'

/** A human name for the thing being exported or imported into. */
export function targetLabel(t: TransferTarget, conn: ConnView) {
  switch (t.kind) {
    case 'table': return t.ref.table
    case 'query': return 'Query result'
    case 'database': return conn.driver === 'sqlite' ? conn.name : t.schema
    case 'collection': return t.collection
    case 'mongo-db': return t.db
    case 'redis': return conn.driver === 'memcached' ? 'all keys' : `db${t.db}`
  }
}

/** A default file name (without extension) for an export. */
export function targetFileBase(t: TransferTarget, conn: ConnView) {
  if (t.kind === 'query') return 'query_result'
  if (t.kind === 'redis') return safeName(conn.driver === 'memcached' ? conn.name : `${conn.name}_db${t.db}`)
  return safeName(targetLabel(t, conn))
}

export const targetIcon = { table: Table2, query: FileCode2, database: Database, collection: Layers, 'mongo-db': Database, redis: KeyRound }

/** Mounts the export/import dialog opened from anywhere (menus, tabs, palette). */
export function TransferDialogs() {
  const { dialog, close } = useDialogs()
  const d = dialog?.kind === 'export' || dialog?.kind === 'import' ? dialog : null
  const conn = useWorkspace((s) => s.connections.find((c) => c.id === d?.target.connId))
  const wide = d?.kind === 'import'
  // While an export/import runs, Esc and the close button do nothing; Cancel stops it.
  const [busy, setBusy] = useState(false)
  useEffect(() => setBusy(false), [d])
  return (
    <Dialog open={!!d && !!conn} onOpenChange={(o) => !o && !busy && close()} title={d?.kind === 'import' ? 'Import' : 'Export'} className={wide ? 'max-w-2xl' : 'max-w-lg'}>
      {d && conn && (d.kind === 'export'
        ? <ExportDialog key={JSON.stringify(d.target)} target={d.target} conn={conn} onClose={close} setBusy={setBusy} />
        : <ImportDialog key={JSON.stringify(d.target)} target={d.target} conn={conn} onClose={close} setBusy={setBusy} />)}
    </Dialog>
  )
}
