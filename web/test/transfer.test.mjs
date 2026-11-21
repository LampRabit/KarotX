// Tests for import/export helpers (src/lib/transfer.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  batches, csvToTable, docValue, fileKind, inferType, matchColumns, parseCSV, parseJSONRecords,
  recordsToTable, safeName, sniffDelimiter, sqlTypeFor, sqlValue,
} from '../src/lib/transfer.ts'

test('CSV parsing', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n1,"x, ""y"""\n\n2,\n'), [['a', 'b'], ['1', 'x, "y"'], ['2', '']])
  assert.deepEqual(parseCSV('a;b\n"multi\nline";2', ';'), [['a', 'b'], ['multi\nline', '2']])
  assert.deepEqual(parseCSV('a,b'), [['a', 'b']])
  assert.equal(sniffDelimiter('a;b;c\n1,2;3'), ';')
  assert.equal(sniffDelimiter('a\tb\n'), '\t')
  assert.equal(sniffDelimiter('"x,y";z;w\n'), ';')
  assert.equal(sniffDelimiter('single'), ',')
})

test('CSV to table: header names, duplicates, ragged rows', () => {
  const t = csvToTable([['id', 'name', 'name', ''], ['1', 'a'], ['2', 'b', 'c', 'd', 'extra']], true)
  assert.deepEqual(t.columns, ['id', 'name', 'name_2', 'column_4', 'column_5'])
  assert.deepEqual(t.rows[0], ['1', 'a', '', '', ''])
  assert.deepEqual(csvToTable([['1', '2']], false).columns, ['column_1', 'column_2'])
})

test('JSON records: array or JSON Lines', () => {
  assert.equal(parseJSONRecords('[{"a":1},{"b":2}]').length, 2)
  assert.equal(parseJSONRecords('{"a":1}\n\n{"a":2}\r\n').length, 2)
  assert.throws(() => parseJSONRecords('[1,2]'), /Item 1 is not an object/)
  assert.throws(() => parseJSONRecords('{"a":1}\n{oops'), /Line 2/)
  assert.deepEqual(parseJSONRecords('  '), [])
  const t = recordsToTable([{ a: 1, b: { c: 2 } }, { b: null, d: 'x' }])
  assert.deepEqual(t.columns, ['a', 'b', 'd'])
  assert.deepEqual(t.rows[1], [undefined, null, 'x'])
})

test('type inference', () => {
  assert.equal(inferType(['1', '', '42']), 'integer')
  assert.equal(inferType(['1', '2.5']), 'decimal')
  assert.equal(inferType([1, 2.5]), 'decimal')
  assert.equal(inferType(['true', 'FALSE']), 'boolean')
  assert.equal(inferType(['2024-01-02', '2024-01-02 10:00:00']), 'datetime')
  assert.equal(inferType(['2024-01-02T10:00:00Z']), 'datetime')
  assert.equal(inferType(['1', 'x']), 'text')
  assert.equal(inferType([{ a: 1 }, [1]]), 'json')
  assert.equal(inferType([{ $oid: 'abc' }]), 'text')
  assert.equal(inferType(['', null]), 'text')
  assert.equal(inferType(['12345678901234567890']), 'decimal') // too long for bigint
  assert.equal(sqlTypeFor('postgres', 'json'), 'jsonb')
  assert.equal(sqlTypeFor('sqlite', 'boolean'), 'INTEGER')
})

test('column matching and names', () => {
  assert.deepEqual(matchColumns(['ID', 'First Name', 'zip'], ['id', 'first_name', 'email']), ['id', 'first_name', ''])
  assert.equal(safeName('My Sales 2024.csv'), 'My_Sales_2024')
  assert.equal(safeName('2024 data.json'), 't_2024_data')
  assert.equal(safeName('---.csv'), 'imported')
})

test('value conversion', () => {
  assert.equal(sqlValue('', true), null)
  assert.equal(sqlValue('', false), '')
  assert.equal(sqlValue({ $oid: 'abc' }, false), 'abc')
  assert.equal(sqlValue({ $date: { $numberLong: '17' } }, false), '17')
  assert.deepEqual(sqlValue({ a: 1 }, false), { a: 1 })
  assert.equal(docValue('42', false, true), 42)
  assert.equal(docValue('4.5', false, true), 4.5)
  assert.equal(docValue('True', false, true), true)
  assert.equal(docValue('007x', false, true), '007x')
  assert.equal(docValue('42', false, false), '42')
  assert.equal(docValue('', true, true), null)
  assert.equal(docValue('99999999999999999999', false, true), '99999999999999999999')
})

test('batches by count and size', () => {
  assert.deepEqual([...batches([1, 2, 3, 4, 5], 2)].map((b) => b.length), [2, 2, 1])
  const big = ['x'.repeat(60), 'y'.repeat(60), 'z']
  assert.deepEqual([...batches(big, 100, 100)].map((b) => b.length), [1, 2])
  assert.equal(fileKind('data.TSV'), 'csv')
  assert.equal(fileKind('dump.sql'), 'sql')
  assert.equal(fileKind('export', '  [{}]'), 'json')
})
