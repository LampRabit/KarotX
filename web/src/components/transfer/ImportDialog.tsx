import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, DatabaseZap, FileCode2, FileUp, Upload } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { api, isDoc, isSql, type ColumnInfo, type ConnView, type TableInfo, type TreeNode } from '@/lib/api'
import { track } from '@/lib/activity'
import { createTable, typeSuggestions } from '@/lib/ddl'
import { runScript, type ScriptProgress, type TransferTarget } from '@/lib/exporter'
import { useGuard } from '@/lib/guard'
import { connectionSource, csvSource, jsonSource, type RowSource } from '@/lib/importSources'
import {
  batches, delimiters, docValue, fileKind, formatBytes, inferType, matchColumns, safeName, sniffDelimiter, sqlTypeFor, sqlValue, type Delimiter,
} from '@/lib/transfer'
import { useWorkspace } from '@/lib/workspace'
import { cn } from '@/lib/cn'
import { runDDL } from '../schema/SchemaDialogs'
import { Button } from '../ui/Button'
import { Progress } from '../ui/Progress'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { Spinner } from '../ui/Spinner'
import { Switch } from '../ui/Switch'
import { targetIcon, targetLabel } from './TransferDialogs'

type Props = { target: TransferTarget; conn: ConnView; onClose: () => void; setBusy: (b: boolean) => void }
type Csv = { name: string; text: string; delimiter: Delimiter; header: boolean }
type RedisItem = { key: string; type: string; ttl?: number; value: unknown; encoding?: string }

export function ImportDialog({ target, conn, onClose, setBusy }: Props) {
  const [csv, setCsv] = useState<Csv>()
  const [other, setOther] = useState<RowSource>() // JSON file or another connection
  const [script, setScript] = useState<File>()
  const [redis, setRedis] = useState<{ name: string; items: RedisItem[] }>()
  const [copy, setCopy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const Icon = targetIcon[target.kind]
  const rowsMode = target.kind !== 'redis'

  const source = useMemo(() => {
    if (!csv) return other
    try {
      return csvSource(csv.name, csv.text, csv.delimiter, csv.header)
    } catch {
      return undefined
    }
  }, [csv, other])

  const reset = () => (setCsv(undefined), setOther(undefined), setScript(undefined), setRedis(undefined), setCopy(false), setError(''))

  async function pick(f: File) {
    setError('')
    const kind = fileKind(f.name)
    if (kind === 'sql') {
      if (target.kind === 'database') return setScript(f)
      return setError(target.kind === 'table' ? 'SQL files run against a whole database. Use Import on the database instead.' : "SQL files can't be imported here.")
    }
    setReading(true)
    await new Promise((r) => setTimeout(r, 30)) // let the spinner paint before parsing a big file
    try {
      const text = await f.text()
      if (target.kind === 'redis') return setRedis({ name: f.name, items: parseRedis(text) })
      const k = fileKind(f.name, text)
      if (k === 'csv') setCsv({ name: f.name, text, delimiter: f.name.toLowerCase().endsWith('.tsv') ? '\t' : sniffDelimiter(text), header: true })
      else if (k === 'json') setOther(jsonSource(f.name, text))
      else setError('Choose a CSV, TSV, JSON or JSON Lines file.')
    } catch (e) {
      setError(e instanceof SyntaxError ? `This file isn't valid JSON: ${e.message}` : (e as Error).message)
    } finally {
      setReading(false)
    }
  }

  const accept = target.kind === 'redis' ? '.json' : `.csv,.tsv,.txt,.json,.jsonl,.ndjson${target.kind === 'database' ? ',.sql' : ''}`
  const body = source && rowsMode
    ? <RowsImport target={target} conn={conn} source={source} csv={csv} setCsv={setCsv} onBack={reset} onClose={onClose} setBusy={setBusy} />
    : script && target.kind === 'database'
      ? <ScriptImport target={target} conn={conn} file={script} onBack={reset} onClose={onClose} setBusy={setBusy} />
      : redis && target.kind === 'redis'
        ? <RedisImport target={target} conn={conn} name={redis.name} items={redis.items} onBack={reset} onClose={onClose} setBusy={setBusy} />
        : copy
          ? <SourcePicker onPick={(s) => (setOther(s), setCopy(false))} onBack={() => setCopy(false)} />
          : (
            <div className="space-y-3">
              <DropZone accept={accept} reading={reading} onFile={pick}
                hint={target.kind === 'redis' ? 'A Redis export from KarotX (.json)'
                  : target.kind === 'database' && isSql(conn.driver) ? 'CSV, TSV, JSON, JSON Lines, or a .sql file to run'
                  : 'CSV, TSV, JSON or JSON Lines'} />
              {rowsMode && (
                <button type="button" onClick={() => setCopy(true)}
                  className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition hover:border-primary/40 hover:bg-muted/50">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"><DatabaseZap size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">Copy from another connection</span>
                    <span className="block text-[13px] text-muted-foreground">Read a table or collection from any connection, even another database type.</span>
                  </span>
                  <ArrowRight size={16} className="text-muted-foreground" />
                </button>
              )}
              {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>}
              <div className="flex justify-end"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
            </div>
          )

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-3 pr-8">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><FileUp size={17} /></span>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">Import into {targetLabel(target, conn)}</h2>
          <p className="flex items-center gap-1.5 truncate text-[13px] text-muted-foreground"><Icon size={13} aria-hidden /> {conn.name}</p>
        </div>
      </div>
      {body}
    </div>
  )
}

function parseRedis(text: string): RedisItem[] {
  const data = JSON.parse(text)
  const ok = Array.isArray(data) && data.every((d) => d && typeof d.key === 'string' && typeof d.type === 'string')
  if (!ok) throw new Error("This isn't a Redis export from KarotX (a list of keys with key, type and value).")
  if (!data.length) throw new Error('The file has no keys.')
  return data
}

function DropZone({ accept, hint, reading, onFile }: { accept: string; hint: string; reading: boolean; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) onFile(f)
        }}
        disabled={reading}
        className={cn('flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition',
          over ? 'border-primary bg-primary/[0.06]' : 'hover:border-primary/50 hover:bg-muted/40')}
      >
        <motion.span animate={{ y: over ? -3 : 0 }} className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {reading ? <Spinner size={18} /> : <Upload size={19} />}
        </motion.span>
        <span className="font-medium">{reading ? 'Reading file…' : <>Drop a file here, or <span className="text-primary">browse</span></>}</span>
        <span className="text-[13px] text-muted-foreground">{hint}</span>
      </button>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) onFile(f)
      }} />
    </>
  )
}

/** Picks a table or collection on any connection to copy from. */
function SourcePicker({ onPick, onBack }: { onPick: (s: RowSource) => void; onBack: () => void }) {
  const connections = useWorkspace((s) => s.connections).filter((c) => isSql(c.driver) || isDoc(c.driver))
  const [srcId, setSrcId] = useState<string>()
  const src = connections.find((c) => c.id === srcId)
  const [roots, setRoots] = useState<TreeNode[]>()
  const [db, setDb] = useState<string>()
  const [schemas, setSchemas] = useState<TreeNode[]>()
  const [schema, setSchema] = useState<string>()
  const [tables, setTables] = useState<TableInfo[]>()
  const [table, setTable] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pgDatabases = src?.driver === 'postgres' && roots?.[0]?.kind === 'database'

  const load = <T,>(p: Promise<T>, set: (v: T) => void) => {
    setError('')
    p.then(set, (e) => setError(e.message))
  }
  useEffect(() => {
    setRoots(undefined), setDb(undefined), setSchemas(undefined), setSchema(undefined), setTables(undefined), setTable(undefined)
    if (!src) return
    if (src.driver === 'sqlite') setSchema('main')
    else load(api.tree(src.id, []), setRoots)
  }, [srcId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSchemas(undefined), setSchema(undefined)
    if (src && db) load(api.tree(src.id, [db]), setSchemas)
  }, [db]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTables(undefined), setTable(undefined)
    if (src && schema) load(api.tables(src.id, schema, db), setTables)
  }, [schema]) // eslint-disable-line react-hooks/exhaustive-deps

  async function next() {
    if (!src || !schema || !table) return
    setBusy(true)
    setError('')
    try {
      const est = tables?.find((t) => t.name === table)?.rows
      onPick(await track(`Reading ${table}`, connectionSource(src, { database: db, schema, table }, est)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const containers = (pgDatabases ? schemas : roots)?.filter((n) => n.kind === 'schema' || n.kind === 'database')
  const word = src?.driver === 'mongodb' ? 'Collection' : 'Table'
  return (
    <form onSubmit={(e) => (e.preventDefault(), next())} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Connection">
          <Select label="Connection" value={srcId} onChange={setSrcId} placeholder="Choose a connection…"
            options={connections.map((c) => ({ value: c.id, label: c.name, hint: c.driver }))} />
        </Field>
        {pgDatabases && (
          <Field label="Database">
            <Select label="Database" value={db} onChange={setDb} options={roots!.map((n) => ({ value: n.name, label: n.name }))} />
          </Field>
        )}
        {src && src.driver !== 'sqlite' && (!pgDatabases || db) && (
          <Field label={src.driver === 'postgres' ? 'Schema' : 'Database'}>
            <Select label="Schema" value={schema} onChange={setSchema} placeholder={containers ? 'Choose…' : 'Loading…'}
              options={(containers ?? []).map((n) => ({ value: n.name, label: n.name }))} />
          </Field>
        )}
        {schema && (
          <Field label={word}>
            <Select label={word} value={table} onChange={setTable} placeholder={tables ? `Choose a ${word.toLowerCase()}…` : 'Loading…'}
              options={(tables ?? []).map((t) => ({ value: t.name, label: t.name, hint: t.rows !== undefined ? `~${t.rows.toLocaleString()} rows` : undefined }))} />
          </Field>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>}
      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}><ArrowLeft size={15} /> Back</Button>
        <Button type="submit" loading={busy} disabled={!table}>Continue <ArrowRight size={15} /></Button>
      </div>
    </form>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <p className="text-[13px] font-medium">{label}</p>
      {children}
    </div>
  )
}

type MapRow = { include: boolean; target: string; type: string }
type Outcome = { done: number; ms: number; error?: string; stopped?: boolean }

/** Column mapping and the batched run for files and copies, into SQL tables or MongoDB collections. */
function RowsImport({ target, conn, source, csv, setCsv, onBack, onClose, setBusy }: Props & { source: RowSource; csv?: Csv; setCsv: (c: Csv) => void; onBack: () => void }) {
  const sql = isSql(conn.driver)
  const ws = useWorkspace()
  const { guard, dialog } = useGuard(conn.name)
  // Where rows go: SQL schema + table, or MongoDB database + collection.
  const schema = target.kind === 'table' ? target.ref.schema : target.kind === 'database' ? target.schema : target.kind === 'collection' || target.kind === 'mongo-db' ? target.db : ''
  const database = target.kind === 'table' ? target.ref.database : target.kind === 'database' ? target.database : undefined
  const fixed = target.kind === 'table' ? target.ref.table : target.kind === 'collection' ? target.collection : undefined
  const [dest, setDest] = useState<'new' | 'existing'>(fixed ? 'existing' : 'new')
  const [newName, setNewName] = useState(safeName(source.label.split(' · ').pop() ?? 'imported'))
  const [existing, setExisting] = useState<string>()
  const [tables, setTables] = useState<TableInfo[]>()
  const [targetCols, setTargetCols] = useState<ColumnInfo[]>()
  const tableName = fixed ?? (dest === 'new' ? newName.trim() : existing ?? '')
  const [map, setMap] = useState<MapRow[]>([])
  const [emptyNull, setEmptyNull] = useState(sql && source.kind === 'csv')
  const [detect, setDetect] = useState(true)
  const [clear, setClear] = useState(false)
  const [progress, setProgress] = useState<{ done: number; started: number }>()
  const [outcome, setOutcome] = useState<Outcome>()
  const abort = useRef<AbortController>(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    if (fixed && target.kind !== 'collection') return
    api.tables(conn.id, schema, database).then((t) => setTables(t.filter((x) => x.kind === 'table')), () => setTables([]))
  }, [conn.id, schema, database, fixed, target.kind])

  // SQL into an existing table: load its columns to map onto.
  const existingTable = sql && dest === 'existing' ? tableName : ''
  useEffect(() => {
    setTargetCols(undefined)
    if (existingTable) api.columns(conn.id, { database, schema, table: existingTable }).then(setTargetCols, (e) => setError(e.message))
  }, [conn.id, database, schema, existingTable])

  // (Re)build the mapping when the source or destination changes.
  const mapKey = `${source.label}|${source.columns.join('\u0000')}|${dest}|${targetCols?.map((c) => c.name).join() ?? ''}`
  useEffect(() => {
    if (sql && dest === 'existing') {
      const m = matchColumns(source.columns, (targetCols ?? []).map((c) => c.name))
      setMap(source.columns.map((_, i) => ({ include: !!m[i], target: m[i], type: '' })))
    } else {
      setMap(source.columns.map((c, i) => ({
        include: true,
        target: sql ? c.trim() || `column_${i + 1}` : c,
        type: sql ? sqlTypeFor(conn.driver, inferType(source.sample.map((r) => r[i]))) : '',
      })))
    }
  }, [mapKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const plan = map.map((m, i) => ({ ...m, index: i })).filter((m) => m.include && m.target)
  const dupes = plan.map((p) => p.target).filter((t, i, a) => a.indexOf(t) !== i)
  const appending = !sql && !fixed && tables?.some((t) => t.name === tableName)
  const problem =
    sql && dest === 'existing' && !tableName ? 'Choose a table.'
    : !tableName ? `Name the new ${sql ? 'table' : 'collection'}.`
    : sql && dest === 'new' && tables?.some((t) => t.name === tableName) ? `${tableName} already exists. Pick another name, or choose Existing table.`
    : sql && dest === 'existing' && !targetCols ? ' '
    : !plan.length ? 'Choose at least one column to import.'
    : dupes.length ? `Two columns go to ${dupes[0]}.`
    : ''

  const set = (i: number, patch: Partial<MapRow>) => setMap((m) => m.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const sample = (i: number) => {
    const v = source.sample.find((r) => r[i] !== '' && r[i] != null)?.[i]
    return v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }

  async function run() {
    const ctl = new AbortController()
    abort.current = ctl
    const started = Date.now()
    setProgress({ done: 0, started })
    setOutcome(undefined)
    setBusy(true)
    let done = 0
    try {
      if (sql && dest === 'new') {
        const cols = plan.map((p, i) => ({ key: `c${i}`, name: p.target, type: p.type, nullable: true, default: '', primaryKey: false, autoIncrement: false }))
        await runDDL(conn, createTable(conn.driver, schema, tableName, cols), schema, `Creating ${tableName}`, database)
        ws.schemaChanged(conn.id, schema, database)
      }
      const columns = plan.map((p) => p.target)
      // MySQL and SQLite have no boolean type: "true"/"false" text becomes 1/0 for integer-like columns.
      const typeOf = (p: (typeof plan)[number]) => (dest === 'new' ? p.type : targetCols?.find((c) => c.name === p.target)?.type ?? '')
      const toInt = plan.map((p) => conn.driver !== 'postgres' && /int|bool|bit/i.test(typeOf(p)))
      const toRow = (r: unknown[]) => plan.map((p, i) => {
        const v = sqlValue(r[p.index], emptyNull)
        return toInt[i] && typeof v === 'string' && /^(true|false)$/i.test(v) ? (v.toLowerCase() === 'true' ? 1 : 0) : v
      })
      const toDoc = (r: unknown[]) => {
        const d: Record<string, unknown> = {}
        for (const p of plan) {
          const v = docValue(r[p.index], emptyNull, detect && source.kind === 'csv')
          if (v !== undefined) d[p.target] = v
        }
        return d
      }
      let first = true
      for await (const chunk of source.read(ctl.signal)) {
        const converted = sql ? chunk.map(toRow) : chunk.map(toDoc)
        for (const batch of batches<unknown>(converted, 500)) {
          if (ctl.signal.aborted) break
          const wipe = first && clear
          const send = (confirmed: boolean) => sql
            ? api.importRows(conn.id, { database, schema, table: tableName }, columns, batch as unknown[][], wipe, confirmed)
            : api.mongo.insert(conn.id, schema, tableName, batch, wipe, confirmed)
          if (first) {
            if ((await guard(send)) === undefined) return setOutcome({ done: 0, ms: 0, stopped: true })
            first = false
          } else await send(false)
          done += batch.length
          setProgress({ done, started })
        }
        if (ctl.signal.aborted) break
      }
      setOutcome({ done, ms: Date.now() - started, stopped: ctl.signal.aborted })
      if (!ctl.signal.aborted) toast.success(`Imported ${done.toLocaleString()} ${sql ? 'rows' : 'documents'} into ${tableName}`)
      ws.schemaChanged(conn.id, schema, database)
    } catch (e) {
      setOutcome({ done, ms: Date.now() - started, error: (e as Error).message })
    } finally {
      setProgress(undefined)
      setBusy(false)
    }
  }

  const unit = sql ? 'rows' : 'documents'
  if (progress || outcome) {
    const total = source.total
    const pct = progress && total ? (progress.done / total) * 100 : undefined
    const rate = progress && progress.done ? Math.round(progress.done / ((Date.now() - progress.started) / 1000)) : 0
    return (
      <div className="space-y-4">
        {progress && (
          <div className="space-y-2" role="status">
            <Progress value={pct} label="Importing" />
            <p className="flex justify-between text-[13px] text-muted-foreground tabular-nums">
              <span>{progress.done.toLocaleString()}{total ? ` of ${total.toLocaleString()}` : ''} {unit}</span>
              {rate > 0 && <span>{rate.toLocaleString()} {unit}/s</span>}
            </p>
          </div>
        )}
        {outcome && <OutcomeView outcome={outcome} what={`${unit} into ${tableName}`} batchNote={clear} />}
        <div className="flex justify-between gap-2">
          {progress ? <span /> : outcome?.error ? <Button type="button" variant="ghost" onClick={() => setOutcome(undefined)}><ArrowLeft size={15} /> Back to mapping</Button> : <span />}
          <div className="flex gap-2">
            {progress
              ? <Button type="button" variant="secondary" onClick={() => abort.current?.abort()}>Stop</Button>
              : (
                <>
                  {!outcome?.error && outcome?.done ? (
                    <Button type="button" variant="secondary" onClick={() => (ws.openTable(conn.id, { database, schema, table: tableName }), onClose())}>
                      Open {tableName}
                    </Button>
                  ) : null}
                  <Button type="button" onClick={onClose}>Done</Button>
                </>
              )}
          </div>
        </div>
        {dialog}
      </div>
    )
  }

  const types = Array.from(new Set([...(typeSuggestions[conn.driver] ?? []), ...map.map((m) => m.type).filter(Boolean)]))
  return (
    <form onSubmit={(e) => (e.preventDefault(), !problem && run())} className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted/60 px-3 py-2 text-[13px]">
        <FileCode2 size={15} className="text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate font-medium">{source.label}</span>
        <span className="text-muted-foreground">
          {source.total !== undefined ? `${source.total.toLocaleString()} ${source.kind === 'copy' ? '(estimated) ' : ''}${unit}` : ''} · {source.columns.length} columns
        </span>
        <button type="button" onClick={onBack} className="ml-auto text-primary hover:underline">Change</button>
      </div>

      {csv && (
        <div className="grid grid-cols-2 items-end gap-3">
          <Field label="Separator"><Select label="Separator" value={csv.delimiter} onChange={(d) => setCsv({ ...csv, delimiter: d })} options={delimiters} /></Field>
          <div className="pb-1.5"><Switch checked={csv.header} onChange={(h) => setCsv({ ...csv, header: h })} label="First row has column names" /></div>
        </div>
      )}

      {!fixed && (
        <div className="grid items-end gap-3 sm:grid-cols-2">
          {sql && (
            <Field label="Into">
              <Segmented label="Into" value={dest} onChange={setDest} className="flex w-full"
                options={[{ value: 'new', label: 'New table' }, { value: 'existing', label: 'Existing table' }]} />
            </Field>
          )}
          {dest === 'new' ? (
            <Field label={sql ? 'Table name' : 'Collection'}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} list={sql ? undefined : 'kx-colls'} aria-label={sql ? 'Table name' : 'Collection'}
                className="h-9 w-full rounded-lg border bg-background px-3 outline-none focus:border-primary focus:ring-3 focus:ring-primary/15" />
              {!sql && <datalist id="kx-colls">{tables?.map((t) => <option key={t.name} value={t.name} />)}</datalist>}
            </Field>
          ) : (
            <Field label="Table">
              <Select label="Table" value={existing} onChange={setExisting} placeholder={tables ? 'Choose a table…' : 'Loading…'} options={(tables ?? []).map((t) => ({ value: t.name, label: t.name }))} />
            </Field>
          )}
          {appending && <p className="text-xs text-muted-foreground sm:col-span-2">{tableName} exists: documents are added to it.</p>}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[13px] font-medium">Columns <span className="font-normal text-muted-foreground">{plan.length} of {source.columns.length} imported</span></p>
        <ul className="max-h-64 divide-y overflow-y-auto rounded-xl border">
          {source.columns.map((c, i) => {
            const m = map[i]
            if (!m) return null
            const mapped = sql && dest === 'existing'
            return (
              <li key={i} className={cn('grid items-center gap-2 px-3 py-1.5', mapped ? 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : sql ? 'grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_8.5rem]' : 'grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]')}>
                {!mapped && <input type="checkbox" checked={m.include} onChange={(e) => set(i, { include: e.target.checked })} aria-label={`Import ${c}`} className="accent-[var(--primary)]" />}
                <div className={cn('min-w-0', !m.include && !mapped && 'opacity-50')}>
                  <p className="truncate text-[13px] font-medium">{c}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{sample(i) || '—'}</p>
                </div>
                <ArrowRight size={14} className="text-muted-foreground" aria-hidden />
                {mapped ? (
                  <Select label={`Column for ${c}`} value={m.target} onChange={(t) => set(i, { target: t, include: !!t })}
                    options={[{ value: '', label: 'Skip' }, ...(targetCols ?? []).map((t) => ({ value: t.name, label: t.name, hint: t.type }))]} />
                ) : (
                  <input value={m.target} onChange={(e) => set(i, { target: e.target.value })} disabled={!m.include} aria-label={`Name for ${c}`}
                    className="h-8 min-w-0 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:border-primary disabled:opacity-50" />
                )}
                {!mapped && sql && (
                  <Select label={`Type for ${c}`} value={m.type} onChange={(t) => set(i, { type: t })} options={types.map((t) => ({ value: t, label: t }))} />
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="space-y-3">
        {source.kind === 'csv' && <Switch checked={emptyNull} onChange={setEmptyNull} label="Treat empty cells as NULL" />}
        {!sql && source.kind === 'csv' && <Switch checked={detect} onChange={setDetect} label="Detect numbers and true/false" description="Otherwise every value is imported as text." />}
        {(fixed || dest === 'existing' || appending) && (
          <Switch checked={clear} onChange={setClear} tone="danger" label={`Delete existing ${unit} first`} description="Replaces the contents instead of adding to them." />
        )}
      </div>

      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] text-muted-foreground">{problem.trim()}</p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!!problem}>
            Import{source.total ? ` ${source.total.toLocaleString()}` : ''} {unit}
          </Button>
        </div>
      </div>
      {dialog}
    </form>
  )
}

function OutcomeView({ outcome, what, batchNote }: { outcome: Outcome; what: string; batchNote?: boolean }) {
  if (outcome.error) {
    return (
      <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4 text-[13px]">
        <p className="font-medium text-destructive">The import stopped with an error</p>
        <p className="font-mono text-xs whitespace-pre-wrap">{outcome.error}</p>
        <p className="text-muted-foreground">
          {outcome.done ? `${outcome.done.toLocaleString()} ${what} were saved before the error (each batch of up to 500 is saved as it goes).` : 'Nothing was imported.'}
          {batchNote && outcome.done === 0 ? ' The existing data was kept.' : ''}
        </p>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-success/[0.06] p-4">
      <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex size-9 items-center justify-center rounded-full bg-success text-white"><Check size={18} /></motion.span>
      <div className="text-[13px]">
        <p className="font-medium">{outcome.stopped ? 'Stopped' : 'Import complete'}</p>
        <p className="text-muted-foreground">
          {outcome.done.toLocaleString()} {what}{outcome.ms ? ` in ${(outcome.ms / 1000).toFixed(1)}s` : ''}.
        </p>
      </div>
    </div>
  )
}

/** Runs a .sql file against a database, with live progress and per-statement errors. */
function ScriptImport({ target, conn, file, onBack, onClose, setBusy }: Props & { target: Extract<TransferTarget, { kind: 'database' }>; file: File; onBack: () => void }) {
  const ws = useWorkspace()
  const { guard, dialog } = useGuard(conn.name)
  const [cont, setCont] = useState(false)
  const [prog, setProg] = useState<ScriptProgress>()
  const [errors, setErrors] = useState<{ statement?: string; error: string }[]>([])
  const [running, setRunning] = useState(false)
  const [fatal, setFatal] = useState('')
  const abort = useRef<AbortController>(undefined)

  async function run() {
    const ctl = new AbortController()
    abort.current = ctl
    setRunning(true)
    setBusy(true)
    setErrors([])
    setProg({ done: 0, total: 0 })
    setFatal('')
    try {
      const opts = { schema: conn.driver === 'sqlite' ? undefined : target.schema, database: target.database, continueOnError: cont }
      const r = await guard((confirmed) => runScript(conn.id, file, { ...opts, confirmed }, (p) => {
        if (p.error && !p.finished) setErrors((e) => (e.length < 100 ? [...e, { statement: p.statement, error: p.error! }] : e))
        if (p.finished && p.error) setFatal(p.error)
        setProg(p)
      }, ctl.signal))
      if (r === undefined) setProg(undefined)
    } catch (e) {
      if (!ctl.signal.aborted) setFatal((e as Error).message)
      else setFatal('Stopped. Statements that already ran were not undone.')
    } finally {
      setRunning(false)
      setBusy(false)
      ws.schemaChanged(conn.id, conn.driver === 'sqlite' ? undefined : target.schema, target.database)
    }
  }

  const finished = prog?.finished
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2 text-[13px]">
        <FileCode2 size={15} className="text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate font-medium">{file.name}</span>
        <span className="text-muted-foreground">{formatBytes(file.size)}</span>
        {!running && !prog && <button type="button" onClick={onBack} className="ml-auto text-primary hover:underline">Change</button>}
      </div>
      {!prog && (
        <>
          <p className="text-[13px] text-muted-foreground">
            Runs every statement in the file, in order, on {conn.driver === 'sqlite' ? conn.name : <span className="font-medium text-foreground">{target.schema}</span>}.
          </p>
          <Switch checked={cont} onChange={setCont} label="Keep going after an error" description="Otherwise the run stops at the first failing statement." />
        </>
      )}
      {prog && (
        <div className="space-y-2" role="status">
          <Progress value={prog.total ? (prog.done / prog.total) * 100 : undefined} label="Running" />
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {prog.total ? `${prog.done.toLocaleString()} of ${prog.total.toLocaleString()} statements` : 'Uploading…'}
            {errors.length ? ` · ${prog.failed ?? errors.length} failed` : ''}
          </p>
        </div>
      )}
      {finished && !fatal && errors.length === 0 && (
        <OutcomeView outcome={{ done: prog.done, ms: 0 }} what="statements ran" />
      )}
      {fatal && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{fatal}</p>}
      {errors.length > 0 && (
        <ul className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-destructive/30 p-3">
          {errors.map((e, i) => (
            <li key={i} className="text-[13px]">
              <p className="text-destructive">{e.error}</p>
              {e.statement && <pre className="mt-1 max-h-20 overflow-hidden rounded bg-muted p-1.5 font-mono text-[11px] whitespace-pre-wrap">{e.statement}</pre>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        {running
          ? <Button type="button" variant="secondary" onClick={() => abort.current?.abort()}>Stop</Button>
          : prog ? <Button type="button" onClick={onClose}>Done</Button>
          : (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" onClick={run}>Run file</Button>
            </>
          )}
      </div>
      {dialog}
    </div>
  )
}

/** Restores keys from a KarotX Redis export. */
function RedisImport({ target, conn, name, items, onBack, onClose, setBusy }: Props & { target: Extract<TransferTarget, { kind: 'redis' }>; name: string; items: RedisItem[]; onBack: () => void }) {
  const { guard, dialog } = useGuard(conn.name)
  const ws = useWorkspace()
  const [replace, setReplace] = useState(false)
  const [done, setDone] = useState<number>()
  const [result, setResult] = useState<{ written: number; skipped: number; error?: string }>()
  const byType = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) m.set(it.type, (m.get(it.type) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [items])

  async function run() {
    setBusy(true)
    setDone(0)
    let written = 0, skipped = 0, n = 0, confirmed = false
    try {
      for (const batch of batches(items, 200)) {
        const send = (c: boolean) => api.redisImport(conn.id, target.db, batch, replace, c)
        const r = n === 0 ? await guard((c) => ((confirmed = c), send(c))) : await send(confirmed)
        if (!r) return setDone(undefined)
        written += r.written
        skipped += r.skipped
        setDone((n += batch.length))
      }
      setResult({ written, skipped })
    } catch (e) {
      setResult({ written, skipped, error: (e as Error).message })
    } finally {
      setBusy(false)
      if (n) ws.schemaChanged(conn.id) // refresh key lists and the sidebar's key counts
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2 text-[13px]">
        <FileCode2 size={15} className="text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate font-medium">{name}</span>
        <span className="text-muted-foreground">{items.length.toLocaleString()} keys</span>
        {done === undefined && <button type="button" onClick={onBack} className="ml-auto text-primary hover:underline">Change</button>}
      </div>
      {done === undefined && (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {byType.map(([t, n]) => <li key={t} className="rounded-full border px-2 py-0.5 text-xs"><span className="font-medium">{n.toLocaleString()}</span> {t}</li>)}
          </ul>
          <Switch checked={replace} onChange={setReplace} tone="danger" label="Replace keys that already exist" description="Otherwise existing keys are left as they are and skipped." />
        </>
      )}
      {done !== undefined && !result && (
        <div className="space-y-2" role="status">
          <Progress value={(done / items.length) * 100} label="Importing keys" />
          <p className="text-[13px] text-muted-foreground tabular-nums">{done.toLocaleString()} of {items.length.toLocaleString()} keys</p>
        </div>
      )}
      {result && (result.error
        ? <OutcomeView outcome={{ done: result.written, ms: 0, error: result.error }} what="keys" />
        : (
          <div className="flex items-center gap-3 rounded-xl border bg-success/[0.06] p-4 text-[13px]">
            <span className="flex size-9 items-center justify-center rounded-full bg-success text-white"><Check size={18} /></span>
            <p><span className="font-medium">{result.written.toLocaleString()} keys written</span>{result.skipped ? <span className="text-muted-foreground"> · {result.skipped.toLocaleString()} skipped (already existed)</span> : null}</p>
          </div>
        ))}
      <div className="flex justify-end gap-2">
        {result ? <Button type="button" onClick={onClose}>Done</Button>
          : done !== undefined ? null
          : (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" onClick={run}>Import into db{target.db}</Button>
            </>
          )}
      </div>
      {dialog}
    </div>
  )
}
