import { api, isSql, type ConnView, type TableRef } from './api'
import { csvToTable, parseCSV, parseJSONRecords, recordColumns, recordsToTable, type Delimiter, type Records } from './transfer'

/** Rows to import: from a parsed file, or read page by page from another connection. */
export type RowSource = {
  label: string
  kind: 'csv' | 'json' | 'copy'
  columns: string[]
  /** The first rows, for type inference and previews. */
  sample: unknown[][]
  /** Exact for files; an estimate (or unknown) when copying. */
  total?: number
  /** Yields every row, in `columns` order, in chunks. */
  read: (signal: AbortSignal) => AsyncGenerator<unknown[][]>
}

export function fromTable(label: string, kind: 'csv' | 'json', t: Records): RowSource {
  return {
    label, kind, columns: t.columns, sample: t.rows.slice(0, 200), total: t.rows.length,
    async *read() {
      for (let i = 0; i < t.rows.length; i += 2000) yield t.rows.slice(i, i + 2000)
    },
  }
}

export const csvSource = (label: string, text: string, delimiter: Delimiter, header: boolean) =>
  fromTable(label, 'csv', csvToTable(parseCSV(text, delimiter), header))

export function jsonSource(label: string, text: string) {
  const records = parseJSONRecords(text)
  if (!records.length) throw new Error('The file has no records.')
  return fromTable(label, 'json', recordsToTable(records))
}

const PAGE = 1000

/** Reads a table (SQL) or collection (MongoDB) of another connection. */
export async function connectionSource(conn: ConnView, ref: TableRef, estimate?: number): Promise<RowSource> {
  const label = `${conn.name} · ${ref.table}`
  if (isSql(conn.driver)) {
    const first = await api.browse(conn.id, { ...ref, offset: 0, limit: 200 })
    const columns = (first.columns ?? []).map((c) => c.name)
    const orderBy = first.primaryKey?.[0] ?? columns[0] // stable paging
    return {
      label, kind: 'copy', columns, sample: first.rows ?? [], total: estimate,
      async *read(signal) {
        for (let offset = 0; !signal.aborted; offset += PAGE) {
          const page = await api.browse(conn.id, { ...ref, offset, limit: PAGE, orderBy })
          if (page.rows?.length) yield page.rows
          if (!page.truncated) return
        }
      },
    }
  }
  // MongoDB: ref.schema is the database, ref.table the collection. Columns come
  // from a 1000-document sample; fields seen only later are not copied.
  const first = await api.mongo.find(conn.id, ref.schema, ref.table, { skip: 0, limit: PAGE, sort: { _id: 1 } })
  const columns = recordColumns(first.docs as Record<string, unknown>[])
  return {
    label, kind: 'copy', columns, sample: recordsToTable(first.docs as Record<string, unknown>[], columns).rows.slice(0, 200), total: estimate ?? first.total,
    async *read(signal) {
      for (let skip = 0; !signal.aborted; skip += PAGE) {
        const page = skip === 0 ? first : await api.mongo.find(conn.id, ref.schema, ref.table, { skip, limit: PAGE, sort: { _id: 1 } })
        if (page.docs.length) yield recordsToTable(page.docs as Record<string, unknown>[], columns).rows
        if (page.docs.length < PAGE) return
      }
    },
  }
}
