# Progress

## Status
Phase 1 done, plus the 2026-11-18 UX round (below). Next: Phase 2 (Query Commander).

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
  - **Not yet verified live:** an SSH tunnel (no SSH server available), TLS verify with custom CA/client certs, and Oracle MySQL (only MariaDB was tested).

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

## Next
- Phase 2: Query Commander (visual query builder).
- Known gaps to pick up:
  - Expanded tree state isn't persisted.
  - Postgres shows only the connected database (no database switcher yet).

## Open questions
None right now.
