import {
  siClickhouse, siCockroachlabs, siMariadb, siMongodb, siMysql, siNeo4j, siNeon,
  siPlanetscale, siPostgresql, siRedis, siSqlite, siSupabase, siTidb,
  type SimpleIcon,
} from 'simple-icons'
import type { Connection, DriverName, TLSMode } from './api'

export type DbKind = {
  id: string
  name: string
  detail: string
  icon?: SimpleIcon
  /** Brand colour too dark to show on a dark background. */
  darkBrand?: boolean
  status: 'ready' | 'soon'
  group: 'database' | 'cloud'
  driver?: DriverName
  /** Defaults applied when creating a connection of this kind. */
  defaults?: Partial<Connection> & { tlsMode?: TLSMode; hostHint?: string }
}

export const databases: DbKind[] = [
  { id: 'postgres', name: 'PostgreSQL', detail: 'SQL · port 5432', icon: siPostgresql, status: 'ready', group: 'database', driver: 'postgres', defaults: { port: 5432, user: 'postgres', database: 'postgres', host: 'localhost' } },
  { id: 'mysql', name: 'MySQL', detail: 'SQL · port 3306', icon: siMysql, status: 'ready', group: 'database', driver: 'mysql', defaults: { port: 3306, user: 'root', host: 'localhost' } },
  { id: 'mariadb', name: 'MariaDB', detail: 'SQL · port 3306', icon: siMariadb, darkBrand: true, status: 'ready', group: 'database', driver: 'mysql', defaults: { port: 3306, user: 'root', host: 'localhost' } },
  { id: 'sqlite', name: 'SQLite', detail: 'SQL · local file', icon: siSqlite, darkBrand: true, status: 'ready', group: 'database', driver: 'sqlite' },
  { id: 'supabase', name: 'Supabase', detail: 'Hosted Postgres', icon: siSupabase, status: 'ready', group: 'cloud', driver: 'postgres', defaults: { port: 5432, user: 'postgres', database: 'postgres', tlsMode: 'require', hostHint: 'db.<project>.supabase.co' } },
  { id: 'neon', name: 'Neon', detail: 'Serverless Postgres', icon: siNeon, status: 'ready', group: 'cloud', driver: 'postgres', defaults: { port: 5432, database: 'neondb', tlsMode: 'require', hostHint: 'ep-<name>.<region>.aws.neon.tech' } },
  { id: 'cockroach', name: 'CockroachDB', detail: 'Distributed SQL', icon: siCockroachlabs, status: 'ready', group: 'cloud', driver: 'postgres', defaults: { port: 26257, database: 'defaultdb', tlsMode: 'verify', hostHint: '<cluster>.cockroachlabs.cloud' } },
  { id: 'planetscale', name: 'PlanetScale', detail: 'Hosted MySQL', icon: siPlanetscale, darkBrand: true, status: 'ready', group: 'cloud', driver: 'mysql', defaults: { port: 3306, tlsMode: 'verify', hostHint: 'aws.connect.psdb.cloud' } },
  { id: 'tidb', name: 'TiDB', detail: 'MySQL compatible', icon: siTidb, status: 'ready', group: 'cloud', driver: 'mysql', defaults: { port: 4000, tlsMode: 'verify', hostHint: 'gateway01.<region>.prod.aws.tidbcloud.com' } },
  { id: 'redis', name: 'Redis', detail: 'Key-value · port 6379', icon: siRedis, status: 'soon', group: 'database' },
  { id: 'mongodb', name: 'MongoDB', detail: 'Documents · port 27017', icon: siMongodb, status: 'soon', group: 'database' },
  { id: 'clickhouse', name: 'ClickHouse', detail: 'Analytics', icon: siClickhouse, status: 'soon', group: 'database' },
  { id: 'neo4j', name: 'Neo4j', detail: 'Graph', icon: siNeo4j, status: 'soon', group: 'database' },
  { id: 'memcached', name: 'Memcached', detail: 'Cache', status: 'soon', group: 'database' },
  { id: 'dynamodb', name: 'DynamoDB', detail: 'AWS key-value', status: 'soon', group: 'cloud' },
]

export const kindOf = (c: Pick<Connection, 'preset' | 'driver'>): DbKind =>
  databases.find((d) => d.id === c.preset) ?? databases.find((d) => d.id === c.driver)!

export const dialectName: Record<DriverName, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' }

/** Parse a connection URL such as postgres://user:pass@host:5432/db?sslmode=require. */
export function parseConnectionUrl(raw: string): { conn: Partial<Connection>; password?: string } | null {
  const m = raw.trim().match(/^(postgres(?:ql)?|mysql|mariadb):\/\//i)
  if (!m) return null
  try {
    const u = new URL(raw.trim().replace(m[0], 'http://'))
    const scheme = m[1].toLowerCase()
    const driver: DriverName = scheme.startsWith('postgres') ? 'postgres' : 'mysql'
    const ssl = (u.searchParams.get('sslmode') ?? u.searchParams.get('ssl-mode') ?? '').toLowerCase()
    const tlsMode: TLSMode | undefined =
      ssl === 'disable' || ssl === 'disabled' ? 'off'
      : ssl === 'require' || ssl === 'required' ? 'require'
      : ssl.startsWith('verify') ? 'verify'
      : ssl ? 'prefer' : undefined
    return {
      conn: {
        driver,
        preset: scheme === 'mariadb' ? 'mariadb' : undefined,
        host: decodeURIComponent(u.hostname),
        port: u.port ? Number(u.port) : undefined,
        user: decodeURIComponent(u.username) || undefined,
        database: decodeURIComponent(u.pathname.replace(/^\//, '')) || undefined,
        tls: tlsMode ? { mode: tlsMode } : { mode: 'prefer' },
      },
      password: u.password ? decodeURIComponent(u.password) : undefined,
    }
  } catch {
    return null
  }
}
