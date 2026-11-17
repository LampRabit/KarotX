# Progress

## Status
Phase 1 (relational core) done. Next: Phase 2 (Query Commander).

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

## Next
- Phase 2: Query Commander (visual query builder).
- Known gaps to pick up:
  - Expanded tree state isn't persisted.
  - The SQLite file path is typed by hand (no file browser yet).
  - Postgres shows only the connected database (no database switcher yet).

## Open questions
None right now.
