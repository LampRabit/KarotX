# Services file: show another tool's databases in KarotX

A tool that runs databases for you, such as a local dev stack like
[LampRabit](https://github.com/LampRabit), a Docker Compose setup or your own script,
can list them in one JSON file. KarotX watches that file and shows the databases on their
own, staying up to date as they're added, removed, started or stopped.

## How it works

1. The tool keeps **one JSON file** (the services file) that lists every database it manages.
2. Start KarotX with the path to that file:

   ```sh
   karotx --services /path/to/karotx-services.json --no-open
   ```

   `--lamprabit` is an alias for `--services`.

3. KarotX **watches the file**. Whenever the tool changes it, KarotX reloads it within about
   a second and the open browser updates by itself, with no refresh and no restart. The databases
   appear in their own sidebar group, named after the file's `source`.

There's no API to call and no extra port to open. The tool only has to keep the file correct.
The file doesn't need to exist when KarotX starts; KarotX picks it up as soon as it's created.

## File format

```json
{
  "version": 1,
  "source": "LampRabit",
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
| `source` | no | Name of the tool, shown as the sidebar group and in messages ("Stopped in LampRabit"). Defaults to `Services`. |
| `id` | yes | **Stable and unique.** Letters, digits, `_ . -`, at most 64 characters. KarotX uses it to keep open tabs attached across reloads. Never reuse an id for a different database. |
| `name` | no | Shown in the sidebar. Defaults to the id. |
| `type` | yes | One of `postgres`, `mysql`, `mariadb`, `sqlite`, `redis`, `mongodb`, `clickhouse`, `neo4j`, `memcached`. |
| `host`, `port` | yes, except sqlite | Use `127.0.0.1` for local services. |
| `user`, `password` | if the database needs them | Leave them out, or use `""`, when there's no auth. |
| `database` | no | Default database, or the database index for Redis (`"0"`). |
| `file` | sqlite only | Absolute path to the database file. |
| `status` | yes | `running` or `stopped`. KarotX greys out stopped databases and won't connect to them. |

**List every database you offer**, including types KarotX doesn't support yet
(`clickhouse`, `neo4j`, `memcached`). KarotX shows those as "coming soon" and enables them
once support lands, so the file doesn't need to change.

## Rules for the tool writing the file

1. **Rewrite the whole file** whenever a database is added, removed, started or stopped.
2. **Write atomically:** write to `karotx-services.json.tmp`, then rename it over the real
   file, so KarotX never reads a half-written file.
3. **Lock the file down.** It holds passwords, so create it as owner-only (`0600` on
   macOS/Linux; on Windows, readable only by the current user).
4. **Removing an entry removes the database from KarotX.** A temporarily stopped database
   should stay in the file with `"status": "stopped"`.
5. If the file is deleted or invalid, KarotX keeps showing the last good list and shows a
   warning. It doesn't crash. Entries with a bad or duplicate `id` are skipped.

## What KarotX does with it

- These databases are **managed**: users can open them, query them and edit data, but can't
  edit or delete the connection itself. The file is the source of truth.
- Passwords are read from the file at connect time and are never copied into KarotX's
  workspace file or the keychain.
- When an entry is removed, its tabs close. When its settings change (or it stops), open
  sessions close and reconnect on next use.
- Connections the user creates in KarotX stay separate and are unaffected.
