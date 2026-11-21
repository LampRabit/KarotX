# Progress

## Status
**Phase 1 complete** (2026-11-21), all caveats closed. Next: Phase 2 (Query Commander, built UI-first).

## Done
- Requirements gathered (see context.md, decisions.md).
- Phase 0: CLI flags, encrypted state file (key in OS keychain), optional password auth (session cookie, 30 days), embedded React UI, theme token system with `karot` theme (light/dark/system), app shell (sidebar, welcome screen, login).
  - Verified: state survives restart, wrong-password rejection, SPA fallback, screenshots in both modes.
- Phase 0.5 (owner feedback): `.kxs` extension; password moved from CLI to Settings → Security (keychain, local-only); full UI redesign.
  - Redesign: home with database tiles, status bar with live activity, settings dialog (Appearance / Security / About), lock screen, boot screen, toasts.
  - Verified end-to-end with Playwright on Edge: set password → lock → wrong password → unlock → remove password. Screenshots in light and dark.
  - "New connection" and the database tiles currently show a "coming next" toast. Phase 1 replaces it with the wizard.

- Phase 1: relational core.
  - Backend: `model`, `driver` (interface, SQL splitter and classifier), `driver/sqldb` (one database/sql core plus postgres/mysql/sqlite dialects), `conn` (manager: sessions, secrets, cancellable queries), `tunnel` (SSH with password/key/agent, jump hosts, host-key pinning).
  - API: connection CRUD/test/connect, tree, query, browse, apply (with dry-run), cancel, workspace tabs.
  - UI: connection wizard (URL paste, TLS, SSH hops, production/read-only), sidebar tree, tabs (restored on reload), table grid (virtualized, sort, filter, paging, inline edit / insert / delete, then review SQL, then a transactional save), SQL editor (CodeMirror, schema autocomplete, multi-statement results, stop).
  - Brand: the owner's logo (web/public/KarotX-logo.svg) drives the mark, the wordmark and the `karot` theme colours.
  - Verified:
    - Go tests (splitter, SQLite end-to-end).
    - A Playwright UI walkthrough on SQLite.
    - API end-to-end on LampRabit's Postgres 18 and MariaDB 12: types, edits, cancel, production guard, read-only.
  - Live verification gaps were closed on 2026-11-21 (see below).

- 2026-11-18 UX round (owner feedback):
  - SQLite file browser.
  - "+" opens a database tab with table cards and a growing query box.
  - Custom context menus (tree, cards, grid cells, tabs, connections).
  - The new-connection button is now an icon next to the logo.
  - Redesigned tabs and a WHERE filter bar.
  - Data/Structure views for tables.
  - Table designer (create/alter), create/drop database or schema, empty/drop table with typed confirmation.
  - Command palette and keyboard shortcuts.
  - Verified: a Playwright walkthrough (SQLite), plus DDL, tables/columns and scope-isolation checks on Postgres 18 and MariaDB 12.

- 2026-11-18 follow-ups:
  - Primary-key changes (Postgres/MySQL/MariaDB), SQLite table rebuilds, and creating new SQLite files.
  - A query box in table tabs, a single-row table toolbar, a designer without horizontal scroll, and no empty context menus.
  - Verified:
    - Go tests (rebuild with trigger, new file).
    - Playwright at 1065×648 (no horizontal scroll; rebuild kept rows; NULL filled with default).
    - Primary-key moves on Postgres 18 and MariaDB 12 using the real ddl.ts.

- Release pipeline: CI (UI build, gofmt, vet, race tests, cross-platform GoReleaser dry run) is green on GitHub. Pushing a `v*` tag publishes a release. No release has been tagged yet.

- 2026-11-21 Phase 1 completion:
  - Guiding principle recorded: **UI first, query second** (context.md, README rule 0).
  - SSH tunnels are verified with in-process SSH servers (`internal/tunnel/sshtest`):
    - Password, key, key with passphrase, and agent logins.
    - Two-hop jump hosts.
    - Host-key trust on first contact, changed-key warning, and known_hosts.
    - Live: Postgres 18, MariaDB 12 and MySQL 26 through a two-hop tunnel.
  - TLS:
    - Unit tests with a generated CA run real handshakes for verify, host-name mismatch, unknown CA, require, and client certificates.
    - Live: MariaDB and MySQL connect encrypted, and verify refuses their self-signed certificates.
    - The local Postgres has TLS off, so its live TLS case is skipped; the pgx TLS options are unit-tested.
  - Oracle MySQL 26 passes the full API suites (queries, edits, production guard, read-only, designer DDL, scope isolation, primary-key moves).
  - Postgres database switcher:
    - The tree lists the server's databases; each database gets its own session.
    - The database tab shows a Database / Schema picker.
    - Create and drop database or schema from the UI.
  - Expanded sidebar folders are saved in the workspace and restored (they reconnect and load on start).
  - Live tests run with `KAROTX_IT_PG` / `KAROTX_IT_MYSQL` (see README → Develop).

## Next
- Phase 2: Query Commander, UI-first.
  - A visual builder (tables, columns, FK-aware joins, filters, grouping, sorting) with live, editable SQL as the second view.
  - The same filter builder replaces the raw WHERE box as the table filter's main mode (raw WHERE stays as an option).

## Open questions
None right now.
