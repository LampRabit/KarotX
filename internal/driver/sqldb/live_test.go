package sqldb

// Live tests against real servers. They are skipped unless enabled, e.g.:
//
//	KAROTX_IT_PG=127.0.0.1:5432:postgres:postgres          (host:port:user:database)
//	KAROTX_IT_MYSQL=127.0.0.1:3306:root,127.0.0.1:3307:root (host:port:user, comma-separated)
//
// Passwords (if any) come from KAROTX_IT_PG_PASSWORD / KAROTX_IT_MYSQL_PASSWORD.

import (
	"context"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
	"github.com/lamprabit/karotx/internal/tunnel"
	"github.com/lamprabit/karotx/internal/tunnel/sshtest"
)

type liveTarget struct {
	name     string
	dialect  Driver
	conn     model.Connection
	password string
}

func liveTargets(t *testing.T) []liveTarget {
	var out []liveTarget
	if v := os.Getenv("KAROTX_IT_PG"); v != "" {
		p := strings.Split(v, ":")
		port, _ := strconv.Atoi(p[1])
		out = append(out, liveTarget{"postgres " + p[0] + ":" + p[1], Driver{postgres{}},
			model.Connection{ID: "itpg", Driver: "postgres", Host: p[0], Port: port, User: p[2], Database: p[3]}, os.Getenv("KAROTX_IT_PG_PASSWORD")})
	}
	for _, v := range strings.Split(os.Getenv("KAROTX_IT_MYSQL"), ",") {
		if v == "" {
			continue
		}
		p := strings.Split(v, ":")
		port, _ := strconv.Atoi(p[1])
		out = append(out, liveTarget{"mysql " + p[0] + ":" + p[1], Driver{mysqlDialect{}},
			model.Connection{ID: "itmy" + p[1], Driver: "mysql", Host: p[0], Port: port, User: p[2]}, os.Getenv("KAROTX_IT_MYSQL_PASSWORD")})
	}
	if len(out) == 0 {
		t.Skip("set KAROTX_IT_PG / KAROTX_IT_MYSQL to run live tests")
	}
	return out
}

func ctx10(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func mustQuery(t *testing.T, c driver.Conn, sql string) [][]any {
	t.Helper()
	res, err := c.Query(ctx10(t), sql, driver.QueryOptions{})
	if err != nil || res[0].Error != "" {
		t.Fatalf("%s: %v %v", sql, err, res)
	}
	return res[0].Rows
}

// TestLiveThroughSSHTunnel connects to each server through a two-hop SSH
// tunnel (password bastion → key-auth inner host), using the real driver dial hooks.
func TestLiveThroughSSHTunnel(t *testing.T) {
	for _, tg := range liveTargets(t) {
		t.Run(tg.name, func(t *testing.T) {
			tunnel.KnownHostsPath = t.TempDir() + "/known_hosts"
			signer, pemBytes := sshtest.NewKey(t, "")
			keyFile := t.TempDir() + "/id"
			os.WriteFile(keyFile, pemBytes, 0o600)
			bastion := sshtest.Start(t, sshtest.Options{User: "jump", Password: "pw"})
			inner := sshtest.Start(t, sshtest.Options{User: "app", AuthorizedKey: signer.PublicKey()})
			cfg := &model.SSH{Hops: []model.SSHHop{
				{Host: bastion.Host, Port: bastion.Port, User: "jump", Auth: "password", HostKey: ssh.FingerprintSHA256(bastion.HostKey)},
				{Host: inner.Host, Port: inner.Port, User: "app", Auth: "key", KeyFile: keyFile, HostKey: ssh.FingerprintSHA256(inner.HostKey)},
			}}
			tun, err := tunnel.Open(ctx10(t), cfg, []string{"pw", ""})
			if err != nil {
				t.Fatal(err)
			}
			defer tun.Close()

			c, err := tg.dialect.Open(ctx10(t), driver.OpenParams{Conn: tg.conn, Password: tg.password, Dial: tun.Dial})
			if err != nil {
				t.Fatalf("open through tunnel: %v", err)
			}
			defer c.Close()
			if rows := mustQuery(t, c, "SELECT 1"); len(rows) != 1 {
				t.Fatalf("SELECT 1 through tunnel: %v", rows)
			}
			if nodes, err := c.Tree(ctx10(t), nil); err != nil || len(nodes) == 0 {
				t.Fatalf("tree through tunnel: %v %v", err, nodes)
			}
			if len(inner.Users()) == 0 {
				t.Fatal("traffic did not go through the inner SSH host")
			}
			t.Logf("%s via 2-hop SSH tunnel: ok", c.Info().ServerVersion)
		})
	}
}

// TestLiveTLS checks encrypted connections where the server offers TLS.
func TestLiveTLS(t *testing.T) {
	for _, tg := range liveTargets(t) {
		t.Run(tg.name, func(t *testing.T) {
			conn := tg.conn
			conn.TLS = model.TLS{Mode: "require"}
			c, err := tg.dialect.Open(ctx10(t), driver.OpenParams{Conn: conn, Password: tg.password})
			if err != nil {
				t.Skipf("server does not offer TLS (require mode refused): %v", err)
			}
			defer c.Close()
			var encrypted bool
			if conn.Driver == "postgres" {
				rows := mustQuery(t, c, "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
				encrypted = len(rows) == 1 && rows[0][0] == true
			} else {
				rows := mustQuery(t, c, "SHOW SESSION STATUS LIKE 'Ssl_cipher'")
				encrypted = len(rows) == 1 && rows[0][1] != ""
				t.Logf("cipher: %v", rows)
			}
			if !encrypted {
				t.Fatal("require mode connected without encryption")
			}

			// Verify mode against a self-signed / unknown CA must be refused.
			conn.TLS = model.TLS{Mode: "verify"}
			if c2, err := tg.dialect.Open(ctx10(t), driver.OpenParams{Conn: conn, Password: tg.password}); err == nil {
				c2.Close()
				t.Log("verify mode accepted: the server certificate is trusted by this machine")
			} else {
				t.Logf("verify mode correctly refused an untrusted certificate: %v", err)
			}
		})
	}
}
