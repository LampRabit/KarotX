// Tests for the Neo4j graph view's Cypher builder (src/lib/cypher.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { caption, cq, createNode, cypherWhere, labelPage, mergeGraph, propTypes } from '../src/lib/cypher.ts'

const f = (column, op, value = '', value2) => ({ id: column + op, col: { table: 'L', column }, op, value, value2 })
const typeOf = (p) => ({ age: 'number', vip: 'bool' })[p] ?? 'text'

test('names are quoted, values are parameters', () => {
  assert.equal(cq('we`ird'), '`we``ird`')
  const params = {}
  const where = cypherWhere([f('age', 'gte', '30'), f('name', 'contains', "O'Br"), f('tags', 'in', 'a, b')], 'all', typeOf, params)
  assert.equal(where, ' WHERE (n.`age` >= $f0) AND (toLower(toString(n.`name`)) CONTAINS toLower($f1)) AND (n.`tags` IN $f2)')
  assert.deepEqual(params, { f0: 30, f1: "O'Br", f2: ['a', 'b'] })
  assert.equal(cypherWhere([f('vip', 'true'), f('x', 'null')], 'any', typeOf, {}), ' WHERE (n.`vip` = true) OR (n.`x` IS NULL)')
})

test('label page and create', () => {
  const page = labelPage('Per`son', [f('age', 'between', '1', '9')], 'all', typeOf, 50, 25)
  assert.match(page.query, /^MATCH \(n:`Per``son`\) WHERE \(n.`age` >= \$f2 AND n.`age` <= \$f3\)/)
  assert.deepEqual(page.params, { skip: 50, limit: 25, f2: 1, f3: 9 })
  assert.equal(createNode(['A', 'B c'], {}).query, 'CREATE (n:`A`:`B c` $props) RETURN n')
})

test('helpers', () => {
  const nodes = [{ id: '1', labels: ['P'], props: { name: 'Ann', age: 3 } }, { id: '2', labels: ['P'], props: { age: 'x', n: 1 } }]
  assert.equal(caption(nodes[0]), 'Ann')
  assert.equal(caption({ id: '3', labels: ['Q'], props: {} }), 'Q')
  assert.equal(propTypes([...nodes, { id: '4', labels: [], props: { age: 5 } }]).get('age'), 'number')
  assert.equal(mergeGraph({ nodes, rels: [] }, { nodes: [nodes[0]], rels: [{ id: 'r' }] }).nodes.length, 2)
})
