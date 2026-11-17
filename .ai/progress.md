# Progress

## Status
Phase 0 (foundation) done. Next: Phase 1 (relational core).

## Done
- Requirements gathered (see context.md, decisions.md).
- Phase 0: CLI flags, encrypted state file (key in OS keychain), optional password auth (session cookie, 30 days), embedded React UI, theme token system with `karot` theme (light/dark/system), app shell (sidebar, welcome screen, login).
  - Verified: state survives restart, wrong-password rejection, SPA fallback, screenshots in both modes.
- Phase 0.5 (owner feedback): `.kxs` extension; password moved from CLI to Settings → Security (keychain, local-only); full UI redesign.
  - Redesign: home with database tiles, status bar with live activity, settings dialog (Appearance / Security / About), lock screen, boot screen, toasts.
  - Verified end-to-end with Playwright on Edge: set password → lock → wrong password → unlock → remove password. Screenshots in light and dark.
  - "New connection" and the database tiles currently show a "coming next" toast. Phase 1 replaces it with the wizard.

## Next
- Phase 1: driver interface + connection manager, Postgres/MySQL/SQLite drivers, SSH tunnel, connection wizard, schema tree, data grid, SQL editor, tabs persistence.

## Open questions
None right now.
