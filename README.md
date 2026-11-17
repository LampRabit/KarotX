# KarotX

A fast, friendly database client that ships as a single binary. Start it from the terminal and use it in your browser.
Part of the [LampRabit](https://github.com/LampRabit) family.

> Early development. See [.ai/roadmap.md](.ai/roadmap.md) for what's planned.

## Run

```sh
karotx                      # http://localhost:8732, workspace in ./karotx.kxs
karotx --port 9000 --state ~/work.kxs --theme karot
```

| Flag | Default | Description |
|------|---------|-------------|
| `--host` | `0.0.0.0` | Address to listen on |
| `--port` | `8732` | Port to listen on |
| `--state` | `karotx.kxs` | Encrypted workspace file (connections, open tabs) |
| `--theme` | from state file | UI theme id |
| `--no-open` | `false` | Don't open the browser on start |

The workspace file (`.kxs`) is encrypted with a key stored in your OS keychain. Database passwords are also kept in the keychain, never in the file.

**Password protection** is set once from **Settings → Security**. It's stored as an Argon2id hash in your OS keychain and applies to every workspace. For safety, it can only be set or changed from the computer running KarotX.

## Develop

Requires Go 1.26+, Node 22+ and pnpm.

```sh
pnpm -C web install
pnpm -C web build && go build -o karotx ./cmd/karotx   # full binary

# live UI development: run both
go run ./cmd/karotx --no-open
pnpm -C web dev                                        # http://localhost:5173, proxies /api
```
