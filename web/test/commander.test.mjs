// Tests for the Query Commander SQL generator (src/lib/commander.ts).
// Run: pnpm -C web test   (Node strips the TypeScript types)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSql, whereSql, joinSuggestions, emptyCommander } from '../src/lib/commander.ts'

const types = { 'orders.id': 'integer', 'orders.total': 'numeric', 'orders.status': 'text', 'orders.paid': 'boolean', 'orders.customer_id': 'integer', 'customers.id': 'integer', 'customers.name': 'text' }
const typeOf = (c) => types[`${c.table}.${c.column}`] ?? 'text'
const plain = (c) => `"${c.column}"`
const f = (column, op, value = '', value2) => ({ id: column + op, col: { table: 'orders', column }, op, value, value2 })

test('filters become safe SQL conditions', () => {
  assert.equal(whereSql('postgres', [f('status', 'eq', "it's")], 'all', plain, typeOf), `"status" = 'it''s'`)
  assert.equal(whereSql('postgres', [f('total', 'gte', '10.5')], 'all', plain, typeOf), `"total" >= 10.5`)
  assert.equal(whereSql('postgres', [f('total', 'eq', '1; drop')], 'all', plain, typeOf), `"total" = '1; drop'`, 'non-numbers are quoted')
  assert.equal(whereSql('postgres', [f('status', 'eq', '')], 'all', plain, typeOf), '', 'incomplete filters are skipped')
  assert.equal(whereSql('postgres', [f('status', 'contains', 'pa'), f('total', 'between', '1', '9')], 'any', plain, typeOf),
    `("status" ILIKE '%pa%') OR ("total" BETWEEN 1 AND 9)`)
  assert.equal(whereSql('mysql', [f('status', 'starts', 'p')], 'all', (c) => '`' + c.column + '`', typeOf), "`status` LIKE 'p%'")
  assert.equal(whereSql('sqlite', [f('paid', 'true')], 'all', plain, typeOf), `"paid" = 1`)
  assert.equal(whereSql('postgres', [f('id', 'in', '1, 2,x')], 'all', plain, typeOf), `"id" IN (1, 2, 'x')`)
  assert.equal(whereSql('postgres', [f('status', 'null')], 'all', plain, typeOf), `"status" IS NULL`)
})

test('builds SELECT with joins, filters, summaries, sort and limit', () => {
  assert.equal(buildSql('postgres', 'public', emptyCommander('orders'), typeOf), 'SELECT *\nFROM "public"."orders"\nLIMIT 100')
  const m = {
    ...emptyCommander('orders'),
    joins: [{ id: 'j', table: 'customers', type: 'left', on: [{ left: { table: 'orders', column: 'customer_id' }, right: { table: 'customers', column: 'id' } }] }],
    filters: [f('status', 'eq', 'paid')],
    groupBy: [{ table: 'customers', column: 'name' }],
    aggregates: [{ id: 'a1', fn: 'count' }, { id: 'a2', fn: 'sum', col: { table: 'orders', column: 'total' } }],
    sort: [{ id: 's', key: 'a:a2', desc: true }],
    limit: 10,
  }
  assert.equal(buildSql('postgres', 'public', m, typeOf), [
    'SELECT "customers"."name",',
    '       COUNT(*) AS "count",',
    '       SUM("orders"."total") AS "sum_total"',
    'FROM "public"."orders"',
    'LEFT JOIN "public"."customers" ON "orders"."customer_id" = "customers"."id"',
    `WHERE "orders"."status" = 'paid'`,
    'GROUP BY "customers"."name"',
    'ORDER BY "sum_total" DESC',
    'LIMIT 10',
  ].join('\n'))
  assert.equal(
    buildSql('sqlite', 'main', { ...emptyCommander('orders'), columns: [{ table: 'orders', column: 'id' }, { table: 'orders', column: 'status' }], sort: [{ id: 's', key: 'c:orders.id', desc: false }], limit: null }, typeOf),
    'SELECT "id",\n       "status"\nFROM "orders"\nORDER BY "id" ASC',
  )
})

test('suggests joins from foreign keys in both directions', () => {
  const fks = [{ table: 'orders', columns: ['customer_id'], refTable: 'customers', refColumns: ['id'] }, { table: 'items', columns: ['order_id'], refTable: 'orders', refColumns: ['id'] }]
  const s = joinSuggestions(['orders'], fks)
  assert.deepEqual(s.map((x) => [x.table, x.on[0].left, x.on[0].right]), [
    ['customers', { table: 'orders', column: 'customer_id' }, { table: 'customers', column: 'id' }],
    ['items', { table: 'orders', column: 'id' }, { table: 'items', column: 'order_id' }],
  ])
  assert.deepEqual(joinSuggestions(['orders', 'customers'], fks).map((x) => x.table), ['items'])
})
