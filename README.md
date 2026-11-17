# KarotX

A fast, friendly database client that ships as a single binary. Start it from the terminal and use it in your browser.
Part of the [LampRabit](https://github.com/LampRabit) family.

> Early development. See [.ai/roadmap.md](.ai/roadmap.md) for what's planned.

## Run

```sh
karotx                      # http://localhost:8732, state in ./karotx.state
karotx --port 9000 --state ~/work.state --theme karot
KAROTX_PASSWORD=secret karotx   # protect the UI with a password
```

| Flag | Default | Description |
|------|---------|-------------|
| `--host` | `0.0.0.0` | Address to listen on |
| `--port` | `8732` | Port to listen on |
| `--state` | `karotx.state` | Encrypted state file (connections, open tabs) |
| `--theme` | from state file | UI theme id |
| `--password` | `$KAROTX_PASSWORD` | Require a password to open the UI |
| `--no-open` | `false` | Don't open the browser on start |

The state file is encrypted with a key stored in your OS keychain. Database passwords are also kept in the keychain, never in the file.

## Develop

Requires Go 1.24+, Node 22+ and pnpm.

```sh
pnpm -C web install
pnpm -C web build && go build -o karotx ./cmd/karotx   # full binary

# live UI development: run both
go run ./cmd/karotx --no-open
pnpm -C web dev                                        # http://localhost:5173, proxies /api
```
