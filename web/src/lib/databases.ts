import {
  siClickhouse, siCockroachlabs, siMariadb, siMongodb, siMysql, siNeo4j, siNeon,
  siPlanetscale, siPostgresql, siRedis, siSqlite, siSupabase, siTidb,
  type SimpleIcon,
} from 'simple-icons'

export type DbKind = {
  id: string
  name: string
  detail: string
  icon?: SimpleIcon
  /** Brand colour too dark to show on a dark background. */
  darkBrand?: boolean
  status: 'ready' | 'soon'
  group: 'database' | 'cloud'
}

export const databases: DbKind[] = [
  { id: 'postgres', name: 'PostgreSQL', detail: 'SQL · port 5432', icon: siPostgresql, status: 'ready', group: 'database' },
  { id: 'mysql', name: 'MySQL', detail: 'SQL · port 3306', icon: siMysql, status: 'ready', group: 'database' },
  { id: 'mariadb', name: 'MariaDB', detail: 'SQL · port 3306', icon: siMariadb, darkBrand: true, status: 'ready', group: 'database' },
  { id: 'sqlite', name: 'SQLite', detail: 'SQL · local file', icon: siSqlite, darkBrand: true, status: 'ready', group: 'database' },
  { id: 'redis', name: 'Redis', detail: 'Key-value · port 6379', icon: siRedis, status: 'ready', group: 'database' },
  { id: 'mongodb', name: 'MongoDB', detail: 'Documents · port 27017', icon: siMongodb, status: 'ready', group: 'database' },
  { id: 'supabase', name: 'Supabase', detail: 'Hosted Postgres', icon: siSupabase, status: 'ready', group: 'cloud' },
  { id: 'neon', name: 'Neon', detail: 'Serverless Postgres', icon: siNeon, status: 'ready', group: 'cloud' },
  { id: 'cockroach', name: 'CockroachDB', detail: 'Distributed SQL', icon: siCockroachlabs, status: 'ready', group: 'cloud' },
  { id: 'planetscale', name: 'PlanetScale', detail: 'Hosted MySQL', icon: siPlanetscale, darkBrand: true, status: 'ready', group: 'cloud' },
  { id: 'tidb', name: 'TiDB', detail: 'MySQL compatible', icon: siTidb, status: 'ready', group: 'cloud' },
  { id: 'clickhouse', name: 'ClickHouse', detail: 'Analytics', icon: siClickhouse, status: 'soon', group: 'database' },
  { id: 'neo4j', name: 'Neo4j', detail: 'Graph', icon: siNeo4j, status: 'soon', group: 'database' },
  { id: 'memcached', name: 'Memcached', detail: 'Cache', status: 'soon', group: 'database' },
  { id: 'dynamodb', name: 'DynamoDB', detail: 'AWS key-value', status: 'soon', group: 'cloud' },
]
