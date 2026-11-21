import { ApiError, type TableRef } from './api'

/** What to export; mirrors exportSpec on the server. Schema/table double as MongoDB database/collection. */
export type ExportSpec = {
  source: 'table' | 'query' | 'database' | 'redis'
  format: 'csv' | 'json' | 'jsonl' | 'sql' | 'zip'
  database?: string
  schema?: string
  table?: string
  where?: string
  orderBy?: string
  desc?: boolean
  sql?: string
  insertTable?: string
  ddl?: boolean
  data?: boolean
  drop?: boolean
  tables?: string[]
  delimiter?: string
  header?: boolean
  null?: string
  filter?: unknown
  sort?: unknown
  db?: number
  pattern?: string
  type?: string
}

/** Something that can be exported or imported into, as opened from a menu. */
export type TransferTarget =
  | { kind: 'table'; connId: string; ref: TableRef; where?: string; orderBy?: string; desc?: boolean }
  | { kind: 'query'; connId: string; sql: string; schema?: string; database?: string }
  /** SQL: a schema (Postgres), database (MySQL) or the SQLite file. */
  | { kind: 'database'; connId: string; schema: string; database?: string }
  | { kind: 'collection'; connId: string; db: string; collection: string; filter?: unknown; sort?: unknown }
  | { kind: 'mongo-db'; connId: string; db: string }
  | { kind: 'redis'; connId: string; db: number; pattern?: string; type?: string }

type SaveHandle = { createWritable(): Promise<WritableStream<Uint8Array> & { abort(): Promise<void> }> }
type Picker = (o: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>
const picker = () => (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker

const mime: Record<ExportSpec['format'], string> = {
  csv: 'text/csv', json: 'application/json', jsonl: 'application/x-ndjson', sql: 'application/sql', zip: 'application/zip',
}

/**
 * Downloads an export. Where the browser can save straight to disk (Chrome, Edge),
 * the user picks the file first and the data streams into it; otherwise the
 * export is collected in memory and downloaded. Resolves with the byte count,
 * or undefined when the user cancels the save dialog.
 */
export async function exportFile(connId: string, spec: ExportSpec, fileName: string, onBytes: (n: number) => void, signal: AbortSignal): Promise<number | undefined> {
  const pick = picker()
  let handle: SaveHandle | undefined
  if (pick) {
    const ext = '.' + fileName.split('.').pop()
    try {
      handle = await pick({ suggestedName: fileName, types: [{ description: ext.slice(1).toUpperCase() + ' file', accept: { [mime[spec.format]]: [ext] } }] })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return undefined
      handle = undefined // e.g. not allowed in this context: fall back to a download
    }
  }
  let res: Response
  try {
    res = await fetch(`/api/connections/${connId}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec), signal })
  } catch (e) {
    if (signal.aborted) throw e
    throw new ApiError(0, 'Cannot reach the KarotX server. Is it still running?')
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data.error ?? res.statusText, data)
  }
  const reader = res.body.getReader()
  let n = 0
  const failed = () => new Error('The export stopped before it finished. The file is incomplete.')
  if (handle) {
    const out = await handle.createWritable()
    const w = out.getWriter()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await w.write(value)
        onBytes((n += value.length))
      }
      await w.close()
    } catch (e) {
      await w.abort().catch(() => {})
      throw signal.aborted ? e : failed()
    }
    return n
  }
  const parts: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      onBytes((n += value.length))
    }
  } catch (e) {
    throw signal.aborted ? e : failed()
  }
  const url = URL.createObjectURL(new Blob(parts as BlobPart[], { type: mime[spec.format] }))
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return n
}

export type ScriptProgress = { done: number; total: number; error?: string; statement?: string; finished?: boolean; failed?: number }

/** Runs a .sql file on the server, reporting progress lines as they arrive. */
export async function runScript(
  connId: string, file: Blob, opts: { schema?: string; database?: string; continueOnError: boolean; confirmed: boolean },
  onLine: (p: ScriptProgress) => void, signal: AbortSignal,
): Promise<true> {
  const qs = new URLSearchParams()
  if (opts.schema) qs.set('schema', opts.schema)
  if (opts.database) qs.set('database', opts.database)
  if (opts.continueOnError) qs.set('continue', '1')
  if (opts.confirmed) qs.set('confirmed', '1')
  const res = await fetch(`/api/connections/${connId}/import/script?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/sql' }, body: file, signal })
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data.error ?? res.statusText, data)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  let finished = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += value
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const p = JSON.parse(line) as ScriptProgress
      finished ||= !!p.finished
      onLine(p)
    }
  }
  if (!finished) throw new Error('The connection closed before the file finished running.')
  return true // (undefined from useGuard means "declined")
}
