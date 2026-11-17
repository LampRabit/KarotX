# Progress

## Status
Phase 0 (foundation) done. Next: Phase 1 (relational core).

## Done
- Requirements gathered (see context.md, decisions.md).
- Phase 0: CLI flags, encrypted state file (key in OS keychain), optional password auth (session cookie, 30 days), embedded React UI, theme token system with `karot` theme (light/dark/system), app shell (sidebar, welcome screen, login).
  - Verified: state survives restart, wrong-password rejection, SPA fallback, screenshots in both modes.

## Next
- Phase 1: driver interface + connection manager, Postgres/MySQL/SQLite drivers, SSH tunnel, connection wizard, schema tree, data grid, SQL editor, tabs persistence.

## Open questions
None right now.
