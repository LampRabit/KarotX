import type { Filter } from './commander'
import type { GraphNode, GraphResult } from './api'

/**
 * Builds the Cypher behind the Neo4j graph view. Names are `quoted` and every
 * value travels as a parameter, so nothing typed in the UI becomes Cypher.
 */

export const cq = (name: string) => '`' + name.replace(/`/g, '``') + '`'

export type Cypher = { query: string; params: Record<string, unknown> }

/** Typed text → the value to compare with, by the property's sampled type. */
export function cypherValue(text: string, type: string): unknown {
  const t = text.trim()
  if (type === 'number' && /^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (type === 'bool') return t === 'true' || t === '1'
  return text
}

function condition(f: Filter, type: string, p: (v: unknown) => string, v = 'n'): string {
  const col = `${v}.${cq(f.col.column)}`
  const val = (s: string) => p(cypherValue(s, type))
  switch (f.op) {
    case 'eq': return `${col} = ${val(f.value)}`
    case 'neq': return `${col} <> ${val(f.value)}`
    case 'gt': return `${col} > ${val(f.value)}`
    case 'gte': return `${col} >= ${val(f.value)}`
    case 'lt': return `${col} < ${val(f.value)}`
    case 'lte': return `${col} <= ${val(f.value)}`
    case 'contains': return `toLower(toString(${col})) CONTAINS toLower(${p(f.value)})`
    case 'not_contains': return `NOT toLower(toString(${col})) CONTAINS toLower(${p(f.value)})`
    case 'starts': return `toLower(toString(${col})) STARTS WITH toLower(${p(f.value)})`
    case 'ends': return `toLower(toString(${col})) ENDS WITH toLower(${p(f.value)})`
    case 'null': return `${col} IS NULL`
    case 'not_null': return `${col} IS NOT NULL`
    case 'in': return `${col} IN ${p(f.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => cypherValue(x, type)))}`
    case 'between': return `${col} >= ${val(f.value)} AND ${col} <= ${val(f.value2 ?? '')}`
    case 'true': return `${col} = true`
    case 'false': return `${col} = false`
  }
}

/** WHERE clause (with leading " WHERE ") for the filter chips; params are added to `params`. */
export function cypherWhere(filters: Filter[], match: 'all' | 'any', typeOf: (prop: string) => string, params: Record<string, unknown>, v = 'n') {
  const p = (value: unknown) => {
    const name = `f${Object.keys(params).length}`
    params[name] = value
    return '$' + name
  }
  const parts = filters.map((f) => `(${condition(f, typeOf(f.col.column), p, v)})`)
  return parts.length ? ` WHERE ${parts.join(match === 'all' ? ' AND ' : ' OR ')}` : ''
}

/** One page of a label's nodes plus the relationships between them. */
export function labelPage(label: string, filters: Filter[], match: 'all' | 'any', typeOf: (p: string) => string, skip: number, limit: number): Cypher {
  const params: Record<string, unknown> = { skip, limit }
  const where = cypherWhere(filters, match, typeOf, params)
  return {
    query: `MATCH (n:${cq(label)})${where}\nWITH n ORDER BY elementId(n) SKIP $skip LIMIT $limit\nWITH collect(n) AS page\nUNWIND page AS n\nOPTIONAL MATCH (n)-[r]->(m) WHERE m IN page\nRETURN n, r`,
    params,
  }
}

export function labelCount(label: string, filters: Filter[], match: 'all' | 'any', typeOf: (p: string) => string): Cypher {
  const params: Record<string, unknown> = {}
  return { query: `MATCH (n:${cq(label)})${cypherWhere(filters, match, typeOf, params)} RETURN count(n) AS total`, params }
}

/** One page of a relationship type, with both ends. */
export const relPage = (type: string, skip: number, limit: number): Cypher => ({
  query: `MATCH (a)-[r:${cq(type)}]->(b)\nRETURN a, r, b ORDER BY elementId(r) SKIP $skip LIMIT $limit`,
  params: { skip, limit },
})

export const relCount = (type: string): Cypher => ({ query: `MATCH ()-[r:${cq(type)}]->() RETURN count(r) AS total`, params: {} })

/** A sample of the whole database. */
export const overview = (limit: number): Cypher => ({
  query: 'MATCH (n)\nWITH n LIMIT $limit\nOPTIONAL MATCH (n)-[r]-(m)\nRETURN n, r, m LIMIT $rels',
  params: { limit, rels: limit * 3 },
})

export const expand = (id: string): Cypher => ({
  query: 'MATCH (n)-[r]-(m) WHERE elementId(n) = $id RETURN n, r, m LIMIT 100',
  params: { id },
})

export const setProps = (id: string, props: Record<string, unknown>): Cypher => ({
  query: 'MATCH (n) WHERE elementId(n) = $id SET n = $props RETURN n',
  params: { id, props },
})

export const setRelProps = (id: string, props: Record<string, unknown>): Cypher => ({
  query: 'MATCH ()-[r]->() WHERE elementId(r) = $id SET r = $props RETURN r',
  params: { id, props },
})

export function createNode(labels: string[], props: Record<string, unknown>): Cypher {
  return { query: `CREATE (n${labels.map((l) => ':' + cq(l)).join('')} $props) RETURN n`, params: { props } }
}

export const deleteNodes = (ids: string[]): Cypher => ({ query: 'MATCH (n) WHERE elementId(n) IN $ids DETACH DELETE n', params: { ids } })

export const deleteRel = (id: string): Cypher => ({ query: 'MATCH ()-[r]->() WHERE elementId(r) = $id DELETE r', params: { id } })

export const connect = (from: string, to: string, type: string, props: Record<string, unknown>): Cypher => ({
  query: `MATCH (a), (b) WHERE elementId(a) = $from AND elementId(b) = $to\nCREATE (a)-[r:${cq(type)} $props]->(b) RETURN a, r, b`,
  params: { from, to, props },
})

/** Property name → most common value type among the nodes ("number", "bool", "text", …). */
export function propTypes(nodes: GraphNode[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const n of nodes) {
    for (const [k, v] of Object.entries(n.props)) {
      const t = typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : Array.isArray(v) ? 'array' : v === null ? 'null' : 'text'
      const c = counts.get(k) ?? new Map()
      c.set(t, (c.get(t) ?? 0) + 1)
      counts.set(k, c)
    }
  }
  const out = new Map<string, string>()
  for (const [k, c] of counts) out.set(k, [...c].sort((a, b) => b[1] - a[1])[0][0])
  return out
}

/** Merges results (e.g. after expanding a node) without duplicates. */
export function mergeGraph(a: Pick<GraphResult, 'nodes' | 'rels'>, b: Pick<GraphResult, 'nodes' | 'rels'>) {
  const nodes = new Map(a.nodes.map((n) => [n.id, n]))
  for (const n of b.nodes) nodes.set(n.id, n)
  const rels = new Map(a.rels.map((r) => [r.id, r]))
  for (const r of b.rels) rels.set(r.id, r)
  return { nodes: [...nodes.values()], rels: [...rels.values()] }
}

/** The text shown on a node: a name-like property, else the first short text one. */
export function caption(n: GraphNode): string {
  for (const k of ['name', 'title', 'label', 'username', 'email', 'id', 'key']) {
    const v = n.props[k]
    if (v !== undefined && v !== null && typeof v !== 'object') return String(v)
  }
  const first = Object.values(n.props).find((v) => typeof v === 'string' && v.length <= 40)
  return first !== undefined ? String(first) : n.labels[0] ?? 'node'
}

const palette = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#059669']

/** A stable colour per label. */
export function labelColor(label = ''): string {
  let h = 0
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return palette[h % palette.length]
}
