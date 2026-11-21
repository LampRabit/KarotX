// Tests for visual filters → MongoDB queries (src/lib/mongofilter.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mongoFilter, mongoValue } from '../src/lib/mongofilter.ts'
import { filterReady } from '../src/lib/commander.ts'

const types = { age: 'number', vip: 'bool', joined: 'date', _id: 'objectId', name: 'string', 'address.city': 'string' }
const typeOf = (p) => types[p] ?? 'string'
const f = (column, op, value = '', value2) => ({ id: column + op, col: { table: 'c', column }, op, value, value2 })

test('typed values', () => {
  assert.equal(mongoValue('42', 'number'), 42)
  assert.equal(mongoValue('4x2', 'number'), '4x2', 'non-numbers stay text')
  assert.equal(mongoValue('true', 'bool'), true)
  assert.deepEqual(mongoValue('2024-01-02', 'date'), { $date: '2024-01-02T00:00:00.000Z' })
  assert.deepEqual(mongoValue('65A1B2C3D4E5F60718293A4B', 'objectId'), { $oid: '65a1b2c3d4e5f60718293a4b' })
})

test('filters become MongoDB queries', () => {
  assert.deepEqual(mongoFilter([], 'all', typeOf, filterReady), {})
  assert.deepEqual(mongoFilter([f('age', 'gte', '30')], 'all', typeOf, filterReady), { age: { $gte: 30 } })
  assert.deepEqual(mongoFilter([f('name', 'contains', 'a.n')], 'all', typeOf, filterReady), { name: { $regex: 'a\\.n', $options: 'i' } }, 'regex is escaped')
  assert.deepEqual(mongoFilter([f('address.city', 'starts', 'Pu'), f('vip', 'true')], 'any', typeOf, filterReady),
    { $or: [{ 'address.city': { $regex: '^Pu', $options: 'i' } }, { vip: true }] })
  assert.deepEqual(mongoFilter([f('age', 'between', '20', '30'), f('age', 'in', '1, 2')], 'all', typeOf, filterReady),
    { $and: [{ age: { $gte: 20, $lte: 30 } }, { age: { $in: [1, 2] } }] })
  assert.deepEqual(mongoFilter([f('name', 'eq', '')], 'all', typeOf, filterReady), {}, 'incomplete filters are skipped')
})
