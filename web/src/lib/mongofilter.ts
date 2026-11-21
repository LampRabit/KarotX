import type { Filter } from './commander'

/**
 * Turns visual filter chips into a MongoDB query (Extended JSON), using the
 * field types sampled from the collection so values compare correctly.
 */

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Converts typed text to the value MongoDB stores for that field type. */
export function mongoValue(text: string, type: string): unknown {
  const t = text.trim()
  if (type === 'number' && /^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (type === 'bool') return t === 'true' || t === '1'
  if (type === 'date' && t && !Number.isNaN(Date.parse(t))) return { $date: new Date(t).toISOString() }
  if (type === 'objectId' && /^[0-9a-fA-F]{24}$/.test(t)) return { $oid: t.toLowerCase() }
  return text
}

function condition(f: Filter, type: string): Record<string, unknown> {
  const v = (s: string) => mongoValue(s, type)
  const path = f.col.column
  switch (f.op) {
    case 'eq': return { [path]: v(f.value) }
    case 'neq': return { [path]: { $ne: v(f.value) } }
    case 'gt': return { [path]: { $gt: v(f.value) } }
    case 'gte': return { [path]: { $gte: v(f.value) } }
    case 'lt': return { [path]: { $lt: v(f.value) } }
    case 'lte': return { [path]: { $lte: v(f.value) } }
    case 'contains': return { [path]: { $regex: escapeRegex(f.value), $options: 'i' } }
    case 'not_contains': return { [path]: { $not: { $regex: escapeRegex(f.value), $options: 'i' } } }
    case 'starts': return { [path]: { $regex: '^' + escapeRegex(f.value), $options: 'i' } }
    case 'ends': return { [path]: { $regex: escapeRegex(f.value) + '$', $options: 'i' } }
    case 'null': return { [path]: null } // matches missing fields too
    case 'not_null': return { [path]: { $ne: null } }
    case 'in': return { [path]: { $in: f.value.split(',').map((x) => x.trim()).filter(Boolean).map(v) } }
    case 'between': return { [path]: { $gte: v(f.value), $lte: v(f.value2 ?? '') } }
    case 'true': return { [path]: true }
    case 'false': return { [path]: false }
  }
}

export function mongoFilter(filters: Filter[], match: 'all' | 'any', typeOf: (path: string) => string, ready: (f: Filter) => boolean) {
  const parts = filters.filter(ready).map((f) => condition(f, typeOf(f.col.column)))
  if (parts.length === 0) return {}
  if (parts.length === 1) return parts[0]
  return { [match === 'all' ? '$and' : '$or']: parts }
}

/** Maps MongoDB field types to the categories the filter bar understands. */
export const filterType = (t: string) =>
  t === 'number' ? 'number' : t === 'bool' ? 'bool' : t === 'date' ? 'date' : t === 'objectId' ? 'objectId' : 'text'
