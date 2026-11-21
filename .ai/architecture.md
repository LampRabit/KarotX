# Architecture

```
karotx (Go binary)
├── CLI ─────────────── flags → config
├── HTTP server ─────── REST JSON API + embedded React app (embed.FS)
│     └── auth ──────── optional password (Argon2id hash in keychain) → session cookie
├── State store ─────── encrypted file (AES-256-GCM), key in OS keychain
├── Secrets ─────────── OS keychain (DB passwords, SSH keys/passphrases)
└── Connection manager
      ├── session per connection (own pool, own context, query timeout/cancel)
      ├── tunnel (SSH, golang.org/x/crypto/ssh) — optional per connection
      └── drivers (one package each, behind a common interface)
```

## Layout

```
cmd/karotx/          main: flag parsing, startup
internal/server/     HTTP routes, auth, static file serving
internal/state/      encrypted workspace file (.kxs) read/write (atomic)
internal/auth/       UI password (set from the UI, stored in keychain) + sessions
internal/secrets/    keychain wrapper (github.com/zalando/go-keyring)
internal/model/      persisted connection config (no secrets)
internal/conn/       connection manager: sessions, keychain secrets, cancellable queries
internal/tunnel/     SSH tunnel (hops, auth methods, host-key pinning)
internal/driver/     Driver interface, registry, SQL splitter/classifier
internal/driver/sqldb/  database/sql core + postgres/mysql/sqlite dialects
(later) internal/driver/{redis,mongo,...}/
web/                 Vite + React + TS app; built to web/dist and embedded
.ai/                 shared agent/human context
```

## Driver contract

Every driver implements a small core. Optional features are declared as **capabilities**, so the UI shows only what a driver supports.

```go
type Driver interface {
    Open(ctx, OpenParams{Conn, Password, Dial}) (Conn, error)
}
type Conn interface {                 // every driver
    Info() Info
    Ping(ctx) error
    Tree(ctx, path []string) ([]Node, error) // lazy browser tree
    Close() error
}
// Capabilities, type-asserted by the server:
type TableLister interface { Tables(ctx, schema) ([]TableInfo, error) }          // SQL + Mongo cards
type SQL interface { Query; Columns; Databases; ForeignKeys; Browse; Apply }      // sqldb (Postgres/MySQL/SQLite)
type KeyValue interface { Scan; GetKey; Do; IsWrite(args); DBSize }               // redisdrv
type Document interface { Find; Fields; Insert; Replace; Delete; Aggregate; RunCommand; Create/Drop… } // mongodrv
```

- The server looks capabilities up per request (`asSQL`, `s.kv`, `s.doc`) and serves `/api/connections/{id}/redis/*` and `/mongo/*` routes. The frontend picks the tab by driver: SQL table tab, Mongo collection tab, Redis key-browser tab.
- Read-only and production rules for non-SQL drivers are enforced in the server: Redis classifies commands with `IsWrite` (COMMAND flags plus admin subcommands); MongoDB blocks writes, `$out`/`$merge` stages and non-read commands.

- `Tree` is lazy (expand on demand) so large schemas stay fast.
- Results are paged and streamed in chunks, and the grid is virtualized, so big tables never load fully into memory.
- Every query runs under a cancellable context, and the UI has a Stop button.

## Workspace file format (.kxs)
`header (magic "KRTX", version, fileID, nonce) + AES-256-GCM(JSON payload)`.
The key is stored in the keychain under service `karotx`, account `state:<fileID>`. Writes are atomic: write to a temp file, then rename.
Consequence: the file only opens on the machine and user account whose keychain holds the key. Moving it to another machine needs a future export/import command.

## Frontend
- Vite + React + TypeScript, Tailwind, shadcn/ui (Radix primitives give accessibility), CodeMirror 6 for the editor, and TanStack Table plus virtualization for the grids.
- Theme tokens are CSS variables. A theme is `{ id, name, light: Tokens, dark: Tokens }`. Mode can be system, light or dark.
- Query Commander builds an AST in the frontend → dialect-aware SQL generator → shows the SQL, which the user can edit before running.

## CLI (draft)
```
karotx [--host 0.0.0.0] [--port 8732] [--state ./karotx.kxs] [--theme <id>] [--no-open]
```
Prints a warning when binding to a non-loopback address without a password.

## Frontend conventions
- `components/ui/`: primitives (Button with `loading`, Input, Dialog, Tooltip, Spinner, Skeleton, Progress, Kbd).
- **Every async operation must show feedback.** Wrap it in `track(label, promise)` (lib/activity.ts). This drives the top progress line and the status-bar activity indicator. Then add the local loader that fits:
  - Button `loading` for actions.
  - `Skeleton` for content that is loading.
  - `Progress` for long jobs.
  - A toast (sonner) for results and errors.
- Use `useDelayed` to avoid loader flashes on fast operations.
- Motion: the `motion` library for presence and stagger animations; CSS keyframes (index.css) for dialogs and tooltips. Respect `prefers-reduced-motion`.
