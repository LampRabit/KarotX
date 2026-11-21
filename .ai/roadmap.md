# Roadmap

Phases 0–4 make up the MVP.

### Phase 0 — Foundation ✅
- Go module, CLI flags, embedded React app shell, `--no-open` / auto-open browser.
- Encrypted state store + keychain secrets.
- Optional password auth.
- Theme token system (one default theme with light and dark, plus system mode).
- App shell layout: connection sidebar, tab bar, main pane.

### Phase 1 — Relational core ✅
- Postgres (and Supabase/Neon/Cockroach presets), MySQL/MariaDB (and PlanetScale/TiDB presets), SQLite.
- New-connection wizard with **Test connection**, TLS options, SSH tunnel (password, key + passphrase, agent, jump hosts).
- Per-connection **production** flag: read-only by default, confirmation before destructive statements.
- Schema tree (lazy), table data grid (paged, virtualized), SQL editor with autocomplete, result grid, Stop button.
- Inline grid editing → staged changes → SQL preview → apply.
- Restore connections, tabs and expanded tree folders from the state file.
- Postgres: switch between databases on the same server.

### Phase 2 — Query Commander (UI first) ✅
- Visual builder: tables, columns, FK-aware joins, filters, group/aggregate, sort, limit. No typing needed.
- Live, editable SQL output for each dialect, as the second view.
- The same visual filter builder becomes the table filter's main mode (raw WHERE stays available).

### Phase 3 — Redis ✅
- Key browser (pattern scan, type-aware views for string/hash/list/set/zset/stream), TTL, command console.

### Phase 4 — MongoDB ✅
- Databases/collections tree, document view and table view, filter builder (the Commander for documents), JSON editing, aggregation console.

### Phase 4.5 — Import / export (v0.2) ✅
- Export tables, query results, collections and Redis keys to CSV / JSON / JSON Lines / SQL; whole databases as SQL dumps (MongoDB: zip of JSON Lines).
- Import CSV / JSON into new or existing tables and collections with column mapping; run .sql files; restore Redis exports; copy between connections.

### Phase 5 — More drivers
- ClickHouse, Neo4j (graph view), Memcached, DynamoDB.

### Phase 6 — Polish & ship
- More themes, final logo and brand.
- Release builds (goreleaser: Windows, macOS, Linux, amd64 and arm64).
- LampRabit service integration and website.
