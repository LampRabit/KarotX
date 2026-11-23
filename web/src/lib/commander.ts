import type { DriverName } from './api'

/**
 * The Query Commander model: a query built through the UI. `buildSql` turns
 * it into SQL for the dialect; `whereSql` is also used by the table filter bar.
 */

export type ColRef = { table: string; column: string }

export type Op =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains' | 'starts' | 'ends'
  | 'null' | 'not_null' | 'in' | 'between' | 'true' | 'false'

export type Filter = { id: string; col: ColRef; op: Op; value: string; value2?: string }
export type JoinType = 'inner' | 'left'
export type Join = { id: string; table: string; type: JoinType; on: { left: ColRef; right: ColRef }[] }
export type AggFn = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max'
export type Aggregate = { id: string; fn: AggFn; col?: ColRef }
/** key: "c:<table>.<column>" for a column, "a:<aggregate id>" for a metric. */
export type Sort = { id: string; key: string; desc: boolean }

export type Commander = {
  source?: string
  joins: Join[]
  columns: ColRef[] // empty = all columns
  filters: Filter[]
  match: 'all' | 'any'
  groupBy: ColRef[]
  aggregates: Aggregate[]
  sort: Sort[]
  limit: number | null
}

export const emptyCommander = (source?: string): Commander => ({
  source, joins: [], columns: [], filters: [], match: 'all', groupBy: [], aggregates: [], sort: [], limit: 100,
})

export type Category = 'number' | 'text' | 'date' | 'bool'

export function categoryOf(type: string): Category {
  const t = type.toLowerCase()
  if (/^(bool|boolean)$/.test(t) || t === 'tinyint(1)') return 'bool'
  if (/int|numeric|decimal|float|double|real|money|serial|number/.test(t)) return 'number'
  if (/date|time/.test(t)) return 'date'
  return 'text'
}

/** Operators: label, how many values they take, and which column categories they fit. */
export const ops: Record<Op, { label: string; values: 0 | 1 | 2; for: Category[] }> = {
  eq: { label: 'is', values: 1, for: ['number', 'text', 'date', 'bool'] },
  neq: { label: 'is not', values: 1, for: ['number', 'text', 'date', 'bool'] },
  contains: { label: 'contains', values: 1, for: ['text'] },
  not_contains: { label: 'does not contain', values: 1, for: ['text'] },
  starts: { label: 'starts with', values: 1, for: ['text'] },
  ends: { label: 'ends with', values: 1, for: ['text'] },
  gt: { label: 'greater than', values: 1, for: ['number', 'date'] },
  gte: { label: 'at least', values: 1, for: ['number', 'date'] },
  lt: { label: 'less than', values: 1, for: ['number', 'date'] },
  lte: { label: 'at most', values: 1, for: ['number', 'date'] },
  between: { label: 'between', values: 2, for: ['number', 'date'] },
  in: { label: 'is one of', values: 1, for: ['number', 'text'] },
  true: { label: 'is true', values: 0, for: ['bool'] },
  false: { label: 'is false', values: 0, for: ['bool'] },
  null: { label: 'is empty', values: 0, for: ['number', 'text', 'date', 'bool'] },
  not_null: { label: 'is not empty', values: 0, for: ['number', 'text', 'date', 'bool'] },
}

export const opsFor = (c: Category) => (Object.keys(ops) as Op[]).filter((o) => ops[o].for.includes(c))

export const aggLabels: Record<AggFn, string> = {
  count: 'Count of rows', count_distinct: 'Distinct values of', sum: 'Sum of', avg: 'Average of', min: 'Minimum of', max: 'Maximum of',
}

export const q = (d: DriverName, id: string) =>
  d === 'mysql' ? '`' + id.replace(/`/g, '``') + '`' : '"' + id.replace(/"/g, '""') + '"'

const str = (v: string) => "'" + v.replace(/'/g, "''") + "'"

export function literal(v: string, cat: Category) {
  const t = v.trim()
  return cat === 'number' && /^-?\d+(\.\d+)?$/.test(t) ? t : str(v)
}

/** Is this filter complete enough to apply? */
export const filterReady = (f: Filter) =>
  ops[f.op].values === 0 || (f.value.trim() !== '' && (ops[f.op].values === 1 || (f.value2 ?? '').trim() !== ''))

type TypeOf = (c: ColRef) => string

export function filterSql(d: DriverName, f: Filter, col: string, type: string) {
  const cat = categoryOf(type)
  const like = d === 'postgres' || d === 'clickhouse' ? 'ILIKE' : 'LIKE' // case-insensitive "contains"
  const text = d === 'postgres' && cat !== 'text' ? `${col}::text` : col
  switch (f.op) {
    case 'eq': return `${col} = ${literal(f.value, cat)}`
    case 'neq': return `${col} <> ${literal(f.value, cat)}`
    case 'gt': return `${col} > ${literal(f.value, cat)}`
    case 'gte': return `${col} >= ${literal(f.value, cat)}`
    case 'lt': return `${col} < ${literal(f.value, cat)}`
    case 'lte': return `${col} <= ${literal(f.value, cat)}`
    case 'contains': return `${text} ${like} ${str(`%${f.value}%`)}`
    case 'not_contains': return `${text} NOT ${like} ${str(`%${f.value}%`)}`
    case 'starts': return `${text} ${like} ${str(`${f.value}%`)}`
    case 'ends': return `${text} ${like} ${str(`%${f.value}`)}`
    case 'null': return `${col} IS NULL`
    case 'not_null': return `${col} IS NOT NULL`
    case 'in': return `${col} IN (${f.value.split(',').map((v) => v.trim()).filter(Boolean).map((v) => literal(v, cat)).join(', ')})`
    case 'between': return `${col} BETWEEN ${literal(f.value, cat)} AND ${literal(f.value2 ?? '', cat)}`
    case 'true': return d === 'sqlite' ? `${col} = 1` : `${col} = TRUE`
    case 'false': return d === 'sqlite' ? `${col} = 0` : `${col} = FALSE`
  }
}

/** WHERE condition (without the keyword) for the complete filters; '' if none. */
export function whereSql(d: DriverName, filters: Filter[], match: 'all' | 'any', colSql: (c: ColRef) => string, typeOf: TypeOf) {
  const parts = filters.filter(filterReady).map((f) => filterSql(d, f, colSql(f.col), typeOf(f.col)))
  if (parts.length <= 1) return parts[0] ?? ''
  return parts.map((p) => `(${p})`).join(match === 'all' ? ' AND ' : ' OR ')
}

export const aggAlias = (a: Aggregate) =>
  a.fn === 'count' ? 'count' : `${a.fn}_${a.col?.column ?? ''}`

export function buildSql(d: DriverName, schema: string | undefined, m: Commander, typeOf: TypeOf) {
  if (!m.source) return ''
  const tbl = (t: string) => (d === 'sqlite' || !schema ? q(d, t) : `${q(d, schema)}.${q(d, t)}`)
  const qualified = m.joins.length > 0 // qualify columns once more than one table is involved
  const col = (c: ColRef) => (qualified ? `${q(d, c.table)}.${q(d, c.column)}` : q(d, c.column))
  const aggSql = (a: Aggregate) => {
    if (a.fn === 'count' || !a.col) return 'COUNT(*)'
    if (a.fn === 'count_distinct') return `COUNT(DISTINCT ${col(a.col)})`
    return `${a.fn.toUpperCase()}(${col(a.col)})`
  }
  const summarizing = m.groupBy.length > 0 || m.aggregates.length > 0

  const select = summarizing
    ? [...m.groupBy.map(col), ...m.aggregates.map((a) => `${aggSql(a)} AS ${q(d, aggAlias(a))}`)]
    : m.columns.length ? m.columns.map(col) : ['*']

  const lines = [`SELECT ${select.join(',\n       ')}`, `FROM ${tbl(m.source)}`]
  for (const j of m.joins) {
    const on = j.on.filter((c) => c.left.column && c.right.column).map((c) => `${col(c.left)} = ${col(c.right)}`)
    lines.push(`${j.type === 'left' ? 'LEFT JOIN' : 'JOIN'} ${tbl(j.table)}${on.length ? ` ON ${on.join(' AND ')}` : ''}`)
  }
  const where = whereSql(d, m.filters, m.match, col, typeOf)
  if (where) lines.push(`WHERE ${where}`)
  if (summarizing && m.groupBy.length) lines.push(`GROUP BY ${m.groupBy.map(col).join(', ')}`)
  const order = m.sort.map((s) => {
    const expr = s.key.startsWith('a:')
      ? q(d, aggAlias(m.aggregates.find((a) => a.id === s.key.slice(2)) ?? { id: '', fn: 'count' }))
      : col(parseColKey(s.key))
    return `${expr} ${s.desc ? 'DESC' : 'ASC'}`
  })
  if (order.length) lines.push(`ORDER BY ${order.join(', ')}`)
  if (m.limit) lines.push(`LIMIT ${m.limit}`)
  return lines.join('\n')
}

export const colKey = (c: ColRef) => `c:${c.table}.${c.column}`
export function parseColKey(k: string): ColRef {
  const s = k.slice(2)
  const i = s.indexOf('.')
  return { table: s.slice(0, i), column: s.slice(i + 1) }
}

export type FK = { table: string; columns: string[]; refTable: string; refColumns: string[] }

/** Tables that can be joined to the current ones, with conditions from foreign keys. */
export function joinSuggestions(current: string[], fks: FK[]) {
  const have = new Set(current)
  const out: { table: string; on: { left: ColRef; right: ColRef }[]; via: string }[] = []
  for (const fk of fks) {
    if (have.has(fk.table) && !have.has(fk.refTable)) {
      out.push({ table: fk.refTable, via: `${fk.table}.${fk.columns.join(', ')}`, on: fk.columns.map((c, i) => ({ left: { table: fk.table, column: c }, right: { table: fk.refTable, column: fk.refColumns[i] } })) })
    } else if (have.has(fk.refTable) && !have.has(fk.table)) {
      out.push({ table: fk.table, via: `${fk.table}.${fk.columns.join(', ')}`, on: fk.columns.map((c, i) => ({ left: { table: fk.refTable, column: fk.refColumns[i] }, right: { table: fk.table, column: c } })) })
    }
  }
  return out
}
