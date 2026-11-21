// Tests for connection-URL parsing (src/lib/databases.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseConnectionUrl } from '../src/lib/databases.ts'

test('parses Postgres and MySQL URLs', () => {
  const pg = parseConnectionUrl('postgres://app:s%40cret@db.example.com:6543/shop?sslmode=require')
  assert.equal(pg.conn.driver, 'postgres')
  assert.equal(pg.conn.host, 'db.example.com')
  assert.equal(pg.conn.port, 6543)
  assert.equal(pg.conn.tls.mode, 'require')
  assert.equal(pg.password, 's@cret')
  assert.equal(parseConnectionUrl('mariadb://root@localhost/x').conn.preset, 'mariadb')
})

test('parses Redis URLs, rediss means TLS', () => {
  const r = parseConnectionUrl('rediss://default:tok@eu1.upstash.io:6380/2')
  assert.deepEqual([r.conn.driver, r.conn.host, r.conn.port, r.conn.user, r.conn.database, r.conn.tls.mode, r.password],
    ['redis', 'eu1.upstash.io', 6380, 'default', '2', 'require', 'tok'])
  assert.equal(parseConnectionUrl('redis://localhost').conn.database, '0')
})

test('parses MongoDB URLs: SRV, seed lists and options', () => {
  const a = parseConnectionUrl('mongodb+srv://ann:p%40ss@cluster0.abcd.mongodb.net/shop?retryWrites=true&w=majority')
  assert.equal(a.conn.srv, true)
  assert.equal(a.conn.host, 'cluster0.abcd.mongodb.net')
  assert.equal(a.conn.database, 'shop')
  assert.equal(a.password, 'p@ss')
  assert.deepEqual(a.conn.params, { retryWrites: 'true', w: 'majority' })
  const rs = parseConnectionUrl('mongodb://a:27017,b:27018/?replicaSet=rs0&tls=false')
  assert.equal(rs.conn.host, 'a:27017,b:27018')
  assert.equal(rs.conn.port, undefined)
  assert.equal(rs.conn.tls.mode, 'off')
  assert.deepEqual(rs.conn.params, { replicaSet: 'rs0' })
  const one = parseConnectionUrl('mongodb://localhost:27018')
  assert.deepEqual([one.conn.host, one.conn.port, one.conn.srv], ['localhost', 27018, false])
})

test('rejects unknown schemes', () => {
  assert.equal(parseConnectionUrl('http://example.com'), null)
})
