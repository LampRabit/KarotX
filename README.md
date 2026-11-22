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
| `--lamprabit` | — | LampRabit services file to watch; its databases appear live ([docs](docs/lamprabit-integration.md)) |

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

### Live tests

Unit tests run everywhere. Live tests against real servers are opt-in:

```sh
KAROTX_IT_PG=127.0.0.1:5432:postgres:postgres \
KAROTX_IT_MYSQL=127.0.0.1:3306:root,127.0.0.1:3307:root \
go test ./internal/driver/sqldb -run TestLive -v

KAROTX_IT_MONGO=127.0.0.1:27017 go test ./internal/driver/mongodrv -run TestLive -v
```

These connect through a real two-hop SSH tunnel (in-process SSH servers) and check TLS where the server offers it. Passwords, if needed, go in `KAROTX_IT_PG_PASSWORD` and `KAROTX_IT_MYSQL_PASSWORD`. Redis tests use an in-process fake (miniredis), so they always run.

## Release

CI (`.github/workflows/ci.yml`) runs on every push and pull request:
- Builds the UI.
- Runs `gofmt`, `go vet` and `go test -race`.
- Does a full **release dry run** that cross-compiles every platform without publishing.

To build a release draft, push a version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` then runs GoReleaser (`.goreleaser.yaml`). It builds single self-contained binaries for Windows, macOS and Linux (amd64 and arm64) with the UI embedded, and attaches them with `checksums.txt` to a **draft GitHub Release**. Review and publish the draft manually. Tags with a suffix such as `v0.2.0-rc1` are marked as pre-releases.
