# LampRabit → KarotX: showing LampRabit's databases

This is how LampRabit tells KarotX which databases it runs, so they appear in
KarotX on their own and stay up to date as databases are added, removed,
started or stopped.

## How it works

1. LampRabit keeps **one JSON file** (the manifest) that lists every database it manages.
2. LampRabit starts KarotX with the path to that file:

   ```sh
   karotx --lamprabit /path/to/lamprabit/karotx-services.json --no-open
   ```

3. KarotX **watches the file**. Whenever LampRabit changes it, KarotX reloads it within
   about a second and the open browser updates by itself, with no refresh button and no restart.
   Databases appear in a **LampRabit** group in the sidebar.

There is no API to call and no extra port to open. LampRabit only has to keep the file correct.
The file may not exist yet when KarotX starts; KarotX picks it up as soon as LampRabit creates it.

## Manifest format

```json
{
  "version": 1,
  "databases": [
    {
      "id": "pg-main",
      "name": "Postgres 18",
      "type": "postgres",
      "host": "127.0.0.1",
      "port": 5432,
      "user": "postgres",
      "password": "secret",
      "database": "postgres",
      "status": "running"
    },
    { "id": "maria", "name": "MariaDB 12", "type": "mariadb", "host": "127.0.0.1", "port": 3306, "user": "root", "password": "", "status": "running" },
    { "id": "cache", "name": "Redis 8", "type": "redis", "host": "127.0.0.1", "port": 6379, "database": "0", "status": "stopped" },
    { "id": "app-sqlite", "name": "App DB", "type": "sqlite", "file": "/path/to/app.db", "status": "running" },
    { "id": "ch", "name": "ClickHouse", "type": "clickhouse", "host": "127.0.0.1", "port": 9000, "user": "default", "status": "running" }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `version` | yes | Always `1` for now. |
| `id` | yes | **Stable and unique.** KarotX uses it to keep open tabs attached to a database across reloads. Never reuse an id for a different database. |
| `name` | yes | Shown in the sidebar. |
| `type` | yes | One of `postgres`, `mysql`, `mariadb`, `sqlite`, `redis`, `mongodb`, `clickhouse`, `neo4j`, `memcached`. |
| `host`, `port` | yes, except sqlite | Use `127.0.0.1` for local services. |
| `user`, `password` | if the DB needs them | Leave them out, or use `""`, when there's no auth. |
| `database` | no | Default database, or the DB index for Redis (`"0"`). |
| `file` | sqlite only | Absolute path to the database file. |
| `status` | yes | `running` or `stopped`. KarotX greys out stopped databases and won't try to connect to them. |

**List every database LampRabit offers**, including types KarotX doesn't
support yet (`clickhouse`, `neo4j`, `memcached`). KarotX shows those as "coming soon" and
enables them on its own once support lands, so the manifest doesn't need to change.

## Rules for LampRabit

1. **Rewrite the whole file** whenever a database is added, removed, started or stopped.
2. **Write atomically:** write to `karotx-services.json.tmp`, then rename it over the
   real file, so KarotX never reads a half-written file.
3. **Lock the file down.** It holds passwords, so create it as owner-only (`0600` on
   macOS/Linux; on Windows, readable only by the current user).
4. **Removing an entry removes the database from KarotX.** A temporarily stopped
   database should stay in the file with `"status": "stopped"`.
5. If the file is deleted or invalid, KarotX keeps showing the last good list and shows a
   warning. It doesn't crash. Entries with a bad or duplicate `id` (allowed: letters, digits,
   `_ . -`, at most 64 characters) are skipped.

## What KarotX does with it

- LampRabit databases are **managed**: users can open them, query them and edit data, but can't
  edit or delete the connection itself. The manifest is the source of truth.
- Their passwords are read from the manifest at connect time and are never copied into
  KarotX's workspace file or the keychain.
- When an entry is removed, its tabs close. When its settings change (or it stops), open
  sessions are closed and reconnect on next use.
- Connections the user creates in KarotX stay separate and are unaffected.
