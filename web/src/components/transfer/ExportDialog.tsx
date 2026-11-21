import { useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { api, type ConnView } from '@/lib/api'
import { track } from '@/lib/activity'
import { exportFile, type ExportSpec, type TransferTarget } from '@/lib/exporter'
import { delimiters, formatBytes, type Delimiter } from '@/lib/transfer'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Progress } from '../ui/Progress'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { Switch } from '../ui/Switch'
import { targetFileBase, targetIcon, targetLabel } from './TransferDialogs'

type Format = ExportSpec['format']
const formatLabels: Record<Format, string> = { csv: 'CSV', json: 'JSON', jsonl: 'JSON Lines', sql: 'SQL', zip: 'ZIP' }

function formatsFor(t: TransferTarget): Format[] {
  switch (t.kind) {
    case 'table': case 'query': return ['csv', 'json', 'jsonl', 'sql']
    case 'database': return ['sql']
    case 'collection': return ['json', 'jsonl', 'csv']
    case 'mongo-db': return ['zip']
    case 'redis': return ['json']
  }
}

export function ExportDialog({ target, conn, onClose, setBusy }: { target: TransferTarget; conn: ConnView; onClose: () => void; setBusy: (b: boolean) => void }) {
  const formats = formatsFor(target)
  const [format, setFormat] = useState<Format>(formats[0])
  const [delimiter, setDelimiter] = useState<Delimiter>(',')
  const [header, setHeader] = useState(true)
  const [nullText, setNullText] = useState<'' | 'NULL'>('')
  const [filtered, setFiltered] = useState(true)
  const [insertTable, setInsertTable] = useState(target.kind === 'table' ? target.ref.table : 'query_result')
  const [ddl, setDdl] = useState(true)
  const [data, setData] = useState(true)
  const [drop, setDrop] = useState(false)
  const [tables, setTables] = useState<string[]>()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const base = targetFileBase(target, conn)
  const ext = format === 'csv' && delimiter === '\t' ? 'tsv' : format
  const [name, setName] = useState(base)
  const [bytes, setBytes] = useState<number>()
  const [error, setError] = useState('')
  const abort = useRef<AbortController>(undefined)
  const Icon = targetIcon[target.kind]

  const hasFilter = (target.kind === 'table' && !!target.where) || (target.kind === 'collection' && !!target.filter && Object.keys(target.filter).length > 0)

  // A database export lets you pick tables.
  useEffect(() => {
    if (target.kind !== 'database') return
    api.tables(conn.id, target.schema, target.database).then((ts) => {
      const names = ts.filter((t) => t.kind === 'table').map((t) => t.name)
      setTables(names)
      setPicked(new Set(names))
    }, (e) => setError(e.message))
  }, [conn.id, target])

  const spec = useMemo((): ExportSpec => {
    const csv = { delimiter, header, null: nullText }
    switch (target.kind) {
      case 'table':
        return { source: 'table', format, database: target.ref.database, schema: target.ref.schema, table: target.ref.table, where: filtered ? target.where : undefined, orderBy: target.orderBy, desc: target.desc, insertTable, ...csv }
      case 'query':
        return { source: 'query', format, database: target.database, schema: target.schema, sql: target.sql, insertTable, ...csv }
      case 'database':
        return { source: 'database', format, database: target.database, schema: target.schema, ddl, data, drop, tables: [...picked] }
      case 'collection':
        return { source: 'table', format, schema: target.db, table: target.collection, filter: filtered ? target.filter : undefined, sort: target.sort, ...csv }
      case 'mongo-db':
        return { source: 'database', format, schema: target.db }
      case 'redis':
        return { source: 'redis', format, db: target.db, pattern: target.pattern || '*', type: target.type }
    }
  }, [target, format, delimiter, header, nullText, filtered, insertTable, ddl, data, drop, picked])

  const running = bytes !== undefined
  const invalid = !name.trim() || (target.kind === 'database' && (picked.size === 0 || (!ddl && !data))) || (format === 'sql' && target.kind !== 'database' && !insertTable.trim())

  async function run() {
    setError('')
    const ctl = new AbortController()
    abort.current = ctl
    const file = `${name.trim()}.${ext}`
    setBytes(0)
    setBusy(true)
    try {
      const n = await track(`Exporting ${file}`, exportFile(conn.id, spec, file, setBytes, ctl.signal))
      if (n !== undefined) {
        toast.success(`Exported ${file}`, { description: formatBytes(n) })
        onClose()
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError((e as Error).message)
    } finally {
      setBytes(undefined)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => (e.preventDefault(), !invalid && !running && run())} className="space-y-5 p-6">
      <div className="flex items-center gap-3 pr-8">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Download size={17} /></span>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">Export {targetLabel(target, conn)}</h2>
          <p className="flex items-center gap-1.5 truncate text-[13px] text-muted-foreground"><Icon size={13} aria-hidden /> {conn.name}</p>
        </div>
      </div>

      <fieldset disabled={running} className="space-y-4">
        {formats.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">Format</p>
            <Segmented label="Format" value={format} onChange={setFormat} options={formats.map((f) => ({ value: f, label: formatLabels[f] }))} className="flex w-full" />
          </div>
        )}

        {hasFilter && (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">Rows</p>
            <Segmented label="Rows" value={filtered ? 'filtered' : 'all'} onChange={(v) => setFiltered(v === 'filtered')}
              options={[{ value: 'filtered', label: 'Matching the current filter' }, { value: 'all', label: 'All rows' }]} className="flex w-full" />
          </div>
        )}

        {format === 'csv' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium">Separator</p>
              <Select label="Separator" value={delimiter} onChange={setDelimiter} options={delimiters} />
            </div>
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium">Empty values</p>
              <Segmented label="Empty values" value={nullText || 'blank'} onChange={(v) => setNullText(v === 'NULL' ? 'NULL' : '')}
                options={[{ value: 'blank', label: 'Blank' }, { value: 'NULL', label: 'NULL' }]} className="flex w-full" />
            </div>
            <div className="col-span-2"><Switch checked={header} onChange={setHeader} label="Column names in the first row" /></div>
          </div>
        )}

        {format === 'sql' && target.kind !== 'database' && (
          <Input label="Table name in the INSERT statements" value={insertTable} onChange={(e) => setInsertTable(e.target.value)} />
        )}

        {target.kind === 'database' && (
          <>
            <div className="space-y-3">
              <Switch checked={ddl} onChange={setDdl} label="Structure" description="CREATE TABLE statements with keys." />
              <Switch checked={data} onChange={setData} label="Data" description="INSERT statements for every row." />
              <Switch checked={drop} onChange={setDrop} label="Replace existing tables" description="Adds DROP TABLE IF EXISTS before each table." tone="danger" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium">Tables <span className="font-normal text-muted-foreground">{tables ? `${picked.size} of ${tables.length}` : ''}</span></p>
                {tables && tables.length > 0 && (
                  <button type="button" className="text-[13px] text-primary hover:underline" onClick={() => setPicked(picked.size === tables.length ? new Set() : new Set(tables))}>
                    {picked.size === tables.length ? 'Select none' : 'Select all'}
                  </button>
                )}
              </div>
              <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-xl border p-1.5">
                {!tables ? <li className="p-2 text-[13px] text-muted-foreground">Loading tables…</li>
                  : tables.length === 0 ? <li className="p-2 text-[13px] text-muted-foreground">No tables.</li>
                  : tables.map((t) => (
                    <li key={t}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-muted">
                        <input type="checkbox" className="accent-[var(--primary)]" checked={picked.has(t)}
                          onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(t); else n.delete(t); return n })} />
                        <span className="truncate font-mono text-xs">{t}</span>
                      </label>
                    </li>
                  ))}
              </ul>
              {conn.driver === 'postgres' && <p className="text-xs text-muted-foreground">Includes columns, primary and foreign keys. Indexes, views and triggers aren't exported.</p>}
            </div>
          </>
        )}

        {target.kind === 'mongo-db' && <p className="rounded-lg bg-muted p-3 text-[13px] text-muted-foreground">A .zip with one JSON Lines file per collection. It works with KarotX import and with mongoimport.</p>}
        {target.kind === 'redis' && (
          <p className="rounded-lg bg-muted p-3 text-[13px] text-muted-foreground">
            Keys matching <code className="font-mono text-foreground">{target.pattern || '*'}</code>{target.type ? ` (${target.type} only)` : ''}, with their full values and expiry. Import the file into any Redis with KarotX.
          </p>
        )}
        {target.kind === 'query' && <p className="text-xs text-muted-foreground">The query runs again in a read-only session and every row is exported, not just the rows on screen.</p>}

        <div className="space-y-1.5">
          <label htmlFor="kx-export-name" className="text-[13px] font-medium">File name</label>
          <div className="flex h-9 items-center rounded-lg border bg-background focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15">
            <input id="kx-export-name" value={name} onChange={(e) => setName(e.target.value)} className="h-full min-w-0 flex-1 bg-transparent px-3 outline-none" />
            <span className="pr-3 text-muted-foreground">.{ext}</span>
          </div>
        </div>
      </fieldset>

      {running && (
        <div className="space-y-1.5" role="status">
          <Progress label="Exporting" />
          <p className="text-[13px] text-muted-foreground tabular-nums">{bytes ? `${formatBytes(bytes)} written…` : 'Starting…'}</p>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-[13px] whitespace-pre-wrap text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        {running
          ? <Button type="button" variant="secondary" onClick={() => abort.current?.abort()}>Cancel export</Button>
          : <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}
        <Button type="submit" loading={running} disabled={invalid}><Download size={15} aria-hidden /> Export</Button>
      </div>
    </form>
  )
}
