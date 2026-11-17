# Decision log

Newest at the bottom. Format: **date — decision.** Why.

- **2026-11-17 — Go backend, single binary, React frontend embedded via `embed.FS`.** Best driver coverage for the target databases, easy cross-compilation and cheap concurrency. Rust was considered but rejected because its drivers for Neo4j, Memcached and others are weaker.
- **2026-11-17 — Browser UI served by the binary (mailpit model), no desktop wrapper.** Simplest to ship, and it fits LampRabit's service model.
- **2026-11-17 — Bind `0.0.0.0` by default with an optional password.** The owner chose this. KarotX prints a startup warning when there is no password and it isn't bound to loopback.
- **2026-11-17 — Encrypted state file, key in OS keychain.** A key embedded in an open-source binary is only obfuscation. A random per-file key in the keychain gives real protection. Trade-off: the file isn't portable without export.
- **2026-11-17 — Credentials in the OS keychain only** (`zalando/go-keyring`).
- **2026-11-17 — State restores connections and open tabs only.** Unsaved query text, scroll positions and similar UI state are not restored.
- **2026-11-17 — MVP DBs: Postgres-family, MySQL/MariaDB, SQLite, Redis, MongoDB.** The owner chose a wide MVP.
- **2026-11-17 — UI stack: Tailwind + shadcn/ui + CodeMirror 6 + TanStack Table.** Accessible primitives keep the binary small. Monaco was rejected because it adds about 3–5 MB.
- **2026-11-17 — SQLite driver: `modernc.org/sqlite` (pure Go).** It avoids cgo, so cross-compiling stays trivial.
- **2026-11-17 — Tooling: pnpm for the frontend.** Commits are made by the agent under the owner's identity, without AI attribution.
- **2026-11-17 — Module path `github.com/lamprabit/karotx`, repo `github.com/LampRabit/KarotX`.** GitHub and the Go proxy resolve the path case-insensitively, so the lowercase module path works.
- **2026-11-17 — Default port `8732`**, changeable with `--port`.
- **2026-11-17 — Per-connection "production" flag.** It marks the connection read-only by default and asks for confirmation before destructive statements.
- **2026-11-17 — SSH: support every common method.** Password, private key (with passphrase), ssh-agent, and jump hosts (chained hops).
- **2026-11-17 — Import/export (CSV, JSON, SQL dump) deferred to the release after the MVP.**
- **2026-11-17 — UI-first meaning:** users should rarely need to write queries by hand. The grid, filters and Commander cover everyday work, and the editor is for power use.
- **2026-11-17 — Workspace file extension `.kxs`**, default `./karotx.kxs`. A path given without an extension gets `.kxs` added.
- **2026-11-17 — UI password is set from the UI, not the CLI.** It's stored as an Argon2id hash in the OS keychain (`karotx` / `auth:password`), applies to every workspace for the OS user, and is configured once. It can only be set, changed or removed from loopback requests, so nobody on the network can claim it first. Changing it revokes all sessions.
- **2026-11-17 — UI quality bar raised.** Inter font (bundled), `motion` for animation, `sonner` for toasts, Radix Dialog and Tooltip for accessibility, a global activity tracker, and a loader kit (spinner, skeleton, progress, top bar). Brand logos come from `simple-icons`.
- **2026-11-17 — One database/sql core for all SQL drivers** (`driver/sqldb`) with small dialects (connect, quoting, placeholders, catalog queries). Postgres uses pgx via stdlib, MySQL/MariaDB uses go-sql-driver, SQLite uses modernc (pure Go).
- **2026-11-17 — SSH tunnels dial through the driver's own dial hook** (pgx DialFunc, mysql RegisterDialContext), not through a local port forward. This keeps TLS server-name checks correct.
- **2026-11-17 — SSH host keys:** a pinned fingerprint wins, then `~/.ssh/known_hosts`, otherwise the API returns 409 with the fingerprint and the UI asks the user to trust it. A changed key is shown as a red warning.
- **2026-11-17 — Production safety is enforced server-side.** Destructive statements (DROP/DELETE/UPDATE/ALTER/TRUNCATE…) and grid saves on a production connection return 409 until confirmed. Read-only is enforced by the database session itself (default_transaction_read_only, transaction_read_only, query_only).
- **2026-11-17 — Grid edits need a primary key.** Edits are applied in one transaction, and an UPDATE/DELETE that matches 0 rows aborts the whole save (protects against stale data).
- **2026-11-17 — Query editor runs every statement on one session,** so SET, BEGIN and temp tables carry over between statements in a run. It stops at the first error.
- **2026-11-17 — Tabs persist with their SQL text.** Restored tabs mount (and query) only when first shown.
- **2026-11-17 — Brand palette from the logo.** Navy #16243a, carrot #f2673a/#ff8053, leaf #82b67a. The wordmark is rendered as live text so dark mode works, and the carrot mark is an inline SVG (`Logo.tsx`).
