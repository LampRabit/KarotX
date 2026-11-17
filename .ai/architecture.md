# Architecture

```
karotx (Go binary)
├── CLI ─────────────── flags → config
├── HTTP server ─────── REST JSON API + embedded React app (embed.FS)
│     └── auth ──────── optional password → session cookie
├── State store ─────── encrypted file (AES-256-GCM), key in OS keychain
├── Secrets ─────────── OS keychain (DB passwords, SSH keys/passphrases)
└── Connection manager
      ├── session per connection (own pool, own context, query timeout/cancel)
      ├── tunnel (SSH, golang.org/x/crypto/ssh) — optional per connection
      └── drivers (one package each, behind a common interface)
```

## Planned layout

```
cmd/karotx/          main: flag parsing, startup
internal/server/     HTTP routes, auth, static file serving
internal/state/      encrypted state file read/write (atomic)
internal/secrets/    keychain wrapper (github.com/zalando/go-keyring)
internal/conn/       connection manager + sessions
internal/tunnel/     SSH tunnel
internal/driver/     Driver interface + registry
internal/driver/{postgres,mysql,sqlite,redis,mongo}/
web/                 Vite + React + TS app; built to web/dist and embedded
.ai/                 shared agent/human context
```

## Driver contract (draft)

Every driver implements a small core. Optional features are declared as **capabilities**, so the UI shows only what a driver supports.

```go
type Driver interface {
    Open(ctx, cfg ConnConfig) (Conn, error)
}
type Conn interface {
    Ping(ctx) error
    Tree(ctx, path []string) ([]Node, error)   // schema/keys/collections browser, lazy
    Query(ctx, q Query) (*Result, error)       // run a statement / command
    Capabilities() Caps                        // editGrid, sqlDialect, commander, ...
    Close() error
}
```

- `Tree` is lazy (expand on demand) so large schemas stay fast.
- Results are paged and streamed in chunks, and the grid is virtualized, so big tables never load fully into memory.
- Every query runs under a cancellable context, and the UI has a Stop button.

## State file format
`header (magic "KRTX", version, fileID, nonce) + AES-256-GCM(JSON payload)`.
The key is stored in the keychain under service `karotx`, account `state:<fileID>`. Writes are atomic: write to a temp file, then rename.
Consequence: the file only opens on the machine and user account whose keychain holds the key. Moving it to another machine needs a future export/import command.

## Frontend
- Vite + React + TypeScript, Tailwind, shadcn/ui (Radix primitives give accessibility), CodeMirror 6 for the editor, and TanStack Table plus virtualization for the grids.
- Theme tokens are CSS variables. A theme is `{ id, name, light: Tokens, dark: Tokens }`. Mode can be system, light or dark.
- Query Commander builds an AST in the frontend → dialect-aware SQL generator → shows the SQL, which the user can edit before running.

## CLI (draft)
```
karotx [--host 0.0.0.0] [--port 8732] [--state ./karotx.state]
       [--theme <id>] [--password <pw> | env KAROTX_PASSWORD] [--no-open]
```
Prints a warning when binding to a non-loopback address without a password.
