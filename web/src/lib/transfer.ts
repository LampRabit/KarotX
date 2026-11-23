import type { DriverName } from './api'

/** Pure helpers for import/export: file parsing, type inference and value conversion. */

export type Delimiter = ',' | ';' | '\t' | '|'
export const delimiters: { value: Delimiter; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe' },
]

/** Guesses the delimiter from the first line (outside quotes). */
export function sniffDelimiter(text: string): Delimiter {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 }
  let quoted = false
  for (const ch of text.slice(0, 64 * 1024)) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === '\n' || ch === '\r')) break
    else if (!quoted && ch in counts) counts[ch]++
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return (n ? best : ',') as Delimiter
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, optional BOM. Blank lines are skipped. */
export function parseCSV(text: string, delimiter: Delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const endRow = () => {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
    field = ''
  }
  for (; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') (field += '"'), i++
        else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) row.push(field), (field = '')
    else if (ch === '\n') endRow()
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
    } else field += ch
  }
  if (field !== '' || row.length) endRow()
  return rows
}

export type Records = { columns: string[]; rows: unknown[][] }

/** A JSON array of objects, or JSON Lines (one object per line). */
export function parseJSONRecords(text: string): Record<string, unknown>[] {
  const t = text.replace(/^﻿/, '').trim()
  if (!t) return []
  let data: unknown
  if (t.startsWith('[')) data = JSON.parse(t)
  else {
    data = t.split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
      try {
        return JSON.parse(l)
      } catch {
        throw new Error(`Line ${i + 1} is not valid JSON.`)
      }
    })
  }
  if (!Array.isArray(data)) throw new Error('Expected a JSON array of objects, or one object per line.')
  for (const [i, r] of data.entries()) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`Item ${i + 1} is not an object.`)
  }
  return data as Record<string, unknown>[]
}

/** Columns are the union of keys, in order of first appearance. Missing keys are undefined (not null). */
export function recordsToTable(records: Record<string, unknown>[], columns = recordColumns(records)): Records {
  return { columns, rows: records.map((r) => columns.map((c) => (c in r ? r[c] : undefined))) }
}

export function recordColumns(records: Record<string, unknown>[]) {
  const seen = new Set<string>()
  for (const r of records) for (const k of Object.keys(r)) seen.add(k)
  return [...seen]
}

/** CSV rows to a table; without a header row, columns are named column_1, column_2… */
export function csvToTable(rows: string[][], header: boolean): Records {
  const width = Math.max(0, ...rows.map((r) => r.length))
  const names = header && rows.length ? rows[0] : []
  const used = new Set<string>()
  const columns = Array.from({ length: width }, (_, i) => {
    let n = (names[i] ?? '').trim() || `column_${i + 1}`
    for (let k = 2; used.has(n); k++) n = `${(names[i] ?? '').trim() || 'column'}_${k}`
    used.add(n)
    return n
  })
  const body = header ? rows.slice(1) : rows
  return { columns, rows: body.map((r) => columns.map((_, i) => r[i] ?? '')) }
}

export type Inferred = 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'json' | 'text'

const intRe = /^-?\d{1,18}$/
const decRe = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
const dateRe = /^\d{4}-\d{2}-\d{2}$/
const dateTimeRe = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const boolRe = /^(true|false)$/i

/** The narrowest type that fits every non-empty value (samples up to 1000 values). */
export function inferType(values: unknown[]): Inferred {
  let t: Inferred | undefined
  const widen = (a: Inferred | undefined, b: Inferred): Inferred => {
    if (!a || a === b) return b
    if ((a === 'integer' && b === 'decimal') || (a === 'decimal' && b === 'integer')) return 'decimal'
    if ((a === 'date' && b === 'datetime') || (a === 'datetime' && b === 'date')) return 'datetime'
    return 'text'
  }
  for (const v of values.slice(0, 1000)) {
    if (v === null || v === undefined || v === '') continue
    let k: Inferred
    if (typeof v === 'boolean') k = 'boolean'
    else if (typeof v === 'number') k = Number.isInteger(v) ? 'integer' : 'decimal'
    else if (typeof v === 'object') k = isWrapper(v) ? 'text' : 'json'
    else {
      const s = String(v).trim()
      k = intRe.test(s) ? 'integer' : decRe.test(s) ? 'decimal' : boolRe.test(s) ? 'boolean' : dateRe.test(s) ? 'date' : dateTimeRe.test(s) ? 'datetime' : 'text'
    }
    t = widen(t, k)
    if (t === 'text') break
  }
  return t ?? 'text'
}

const sqlTypes: Record<'postgres' | 'mysql' | 'sqlite' | 'clickhouse', Record<Inferred, string>> = {
  postgres: { integer: 'bigint', decimal: 'double precision', boolean: 'boolean', date: 'date', datetime: 'timestamp', json: 'jsonb', text: 'text' },
  mysql: { integer: 'bigint', decimal: 'double', boolean: 'tinyint(1)', date: 'date', datetime: 'datetime', json: 'json', text: 'text' },
  sqlite: { integer: 'INTEGER', decimal: 'REAL', boolean: 'INTEGER', date: 'TEXT', datetime: 'TEXT', json: 'TEXT', text: 'TEXT' },
  clickhouse: { integer: 'Int64', decimal: 'Float64', boolean: 'Bool', date: 'Date', datetime: 'DateTime64(3)', json: 'String', text: 'String' },
}
export const sqlTypeFor = (d: DriverName, t: Inferred) => (d === 'postgres' || d === 'mysql' || d === 'sqlite' || d === 'clickhouse' ? sqlTypes[d][t] : t)

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Maps each source column to the target column with the same name (ignoring case, spaces and punctuation). */
export function matchColumns(source: string[], target: string[]): string[] {
  const byNorm = new Map(target.map((t) => [norm(t), t]))
  return source.map((s) => target.find((t) => t === s) ?? byNorm.get(norm(s)) ?? '')
}

/** A valid column/collection name from a file name or header: letters, digits and underscores. */
export function safeName(s: string) {
  const n = s.replace(/\.[^.]+$/, '').trim().replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '')
  return /^\p{N}/u.test(n) ? `t_${n}` : n || 'imported'
}

const isWrapper = (v: object) => {
  const k = Object.keys(v)
  return k.length === 1 && k[0].startsWith('$')
}

/**
 * Prepares a value for a SQL column: MongoDB Extended JSON wrappers ({"$oid": …})
 * become their plain value, nested objects stay objects (stored as JSON text),
 * and with emptyNull, empty strings become NULL.
 */
export function sqlValue(v: unknown, emptyNull: boolean): unknown {
  if (v === undefined) return null
  if (emptyNull && v === '') return null
  if (v && typeof v === 'object' && !Array.isArray(v) && isWrapper(v)) {
    const inner = Object.values(v)[0]
    if (inner && typeof inner === 'object' && '$numberLong' in inner) return (inner as { $numberLong: string }).$numberLong
    return inner
  }
  return v
}

/** Prepares a value for a document field: with detect, text that looks like a number or boolean is converted. */
export function docValue(v: unknown, emptyNull: boolean, detect: boolean): unknown {
  if (v === undefined) return null
  if (typeof v !== 'string') return v
  if (v === '') return emptyNull ? null : ''
  if (!detect) return v
  const s = v.trim()
  if (intRe.test(s) && Math.abs(Number(s)) <= Number.MAX_SAFE_INTEGER) return Number(s)
  if (decRe.test(s) && !/^-?\d+$/.test(s)) return Number(s) // big integers stay text (no precision loss)
  if (boolRe.test(s)) return s.toLowerCase() === 'true'
  return v
}

/** Splits rows into batches of at most `size` rows and roughly `maxBytes` of JSON. */
export function* batches<T>(rows: T[], size = 500, maxBytes = 4 << 20): Generator<T[]> {
  let batch: T[] = []
  let bytes = 0
  for (const r of rows) {
    const n = JSON.stringify(r)?.length ?? 4
    if (batch.length && (batch.length >= size || bytes + n > maxBytes)) {
      yield batch
      batch = []
      bytes = 0
    }
    batch.push(r)
    bytes += n
  }
  if (batch.length) yield batch
}

export type FileKind = 'csv' | 'json' | 'sql' | 'unknown'
export function fileKind(name: string, text?: string): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv'
  if (ext === 'json' || ext === 'jsonl' || ext === 'ndjson') return 'json'
  if (ext === 'sql') return 'sql'
  const t = text?.trimStart() ?? ''
  return t.startsWith('[') || t.startsWith('{') ? 'json' : 'unknown'
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB']
  let i = -1
  do (n /= 1024), i++
  while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`
}
