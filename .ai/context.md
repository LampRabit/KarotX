# KarotX — product context

**KarotX** is a database client that ships as a single binary. You start it from a terminal (like mailpit) and use it in the browser.
It ships under the **LampRabit** namespace and brand. It will later be bundled into LampRabit as a service, and it is also published standalone so anyone can use it.

## Guiding principle: UI first, query second

Every task must be doable through the UI: clicking, picking, dragging, forms and visual builders. Writing SQL or commands is the **second choice**, always available for power users but never the only or the main path.

When designing a feature:
- Start from "how does a user do this without typing a query?".
- Then expose the generated SQL or command, so it can be reviewed, edited or copied.

Examples:
- Filters are built by picking a column, an operator and a value, with a raw WHERE as an alternative.
- Tables are created and changed in the designer.
- Rows are edited in the grid.
- The Query Commander builds SQL visually.

## Core requirements

1. **Many connections at once, no lag.** Each connection is isolated: its own pool, its own cancellation, and no global locks on the query path. A slow query on one database never blocks another.
2. **Many database types:**
   - **MVP:** PostgreSQL, MySQL, MariaDB, SQLite, Redis, MongoDB.
   - **Later:** ClickHouse, Neo4j, Memcached, DynamoDB.
3. **Cloud and local.** Supabase, Neon and CockroachDB connect over the Postgres wire protocol. PlanetScale and TiDB connect over the MySQL protocol. They appear as *presets* on those drivers. DynamoDB has its own driver.
4. **Persistent state.** The workspace file (extension `.kxs`) is passed on the CLI and defaults to `./karotx.kxs` in the current directory. It restores **connections and open tabs** only.
   - The file is encrypted (AES-256-GCM). The key lives in the OS keychain.
   - DB passwords and SSH secrets live in the **OS keychain**, never in the file.
5. **SSH tunnels** for any network driver.
6. **Server:** binds to `0.0.0.0` on a reserved default port. Both are changeable with CLI flags. An optional password protects the UI. It's configured once from the UI (not the CLI) and saved in the OS keychain.
7. **UI first, competitive quality.** Polished visuals, purposeful animation, and visible feedback for every ongoing operation, with a loader that suits each one. It must be beautiful and obvious enough for a newcomer, and powerful enough that most work happens without typing queries by hand.
8. **Query Commander.** A visual query builder, mainly for relational DBs: pick tables, columns, joins, filters, grouping and sorting. It produces live, editable SQL.
9. **Themeable.** Each theme has a light and a dark variant. Select a theme with `--theme`; otherwise it comes from the state file. Theming is structurally ready from day one, and the themes themselves come later.
10. **Logo** is in progress. Use a simple placeholder icon until it's ready, then align the default theme to it.

## Non-goals (for now)
- Multi-user accounts or roles.
- A desktop wrapper (Electron/Wails). The browser UI is the product.
