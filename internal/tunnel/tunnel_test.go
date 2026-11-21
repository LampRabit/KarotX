package tunnel

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/lamprabit/karotx/internal/model"
	"github.com/lamprabit/karotx/internal/tunnel/sshtest"
)

// isolate points known_hosts at an empty temp file for every test.
func isolate(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "known_hosts")
	old := KnownHostsPath
	KnownHostsPath = path
	t.Cleanup(func() { KnownHostsPath = old })
	return path
}

func roundTrip(t *testing.T, tun *Tunnel, target string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, err := tun.Dial(ctx, "tcp", target)
	if err != nil {
		t.Fatalf("dial through tunnel: %v", err)
	}
	defer c.Close()
	c.Write([]byte("hello karotx"))
	buf := make([]byte, 12)
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadFull(c, buf); err != nil || string(buf) != "hello karotx" {
		t.Fatalf("echo through tunnel: %q %v", buf, err)
	}
}

func open(t *testing.T, cfg *model.SSH, secrets ...string) (*Tunnel, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tun, err := Open(ctx, cfg, secrets)
	if err == nil {
		t.Cleanup(func() { tun.Close() })
	}
	return tun, err
}

func TestPasswordLoginAndHostKeyPinning(t *testing.T) {
	isolate(t)
	srv := sshtest.Start(t, sshtest.Options{User: "kx", Password: "secret"})
	echo := sshtest.Echo(t)
	hop := model.SSHHop{Host: srv.Host, Port: srv.Port, User: "kx", Auth: "password"}

	// First contact: unknown host key, reported with its fingerprint.
	_, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}}, "secret")
	var uh *UnknownHostError
	if !errors.As(err, &uh) || uh.Changed || uh.Fingerprint != ssh.FingerprintSHA256(srv.HostKey) || uh.Hop != 0 {
		t.Fatalf("want unknown-host error with fingerprint, got %v", err)
	}

	// Once trusted (pinned), login works and traffic flows.
	hop.HostKey = uh.Fingerprint
	tun, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}}, "secret")
	if err != nil {
		t.Fatal(err)
	}
	roundTrip(t, tun, echo)

	// Wrong password is refused.
	if _, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}}, "nope"); err == nil || !strings.Contains(err.Error(), "SSH login") {
		t.Fatalf("wrong password: %v", err)
	}
}

func TestChangedHostKeyIsFlagged(t *testing.T) {
	isolate(t)
	srv := sshtest.Start(t, sshtest.Options{User: "kx", Password: "secret"})
	hop := model.SSHHop{Host: srv.Host, Port: srv.Port, User: "kx", Auth: "password", HostKey: "SHA256:somethingElseEntirely"}
	_, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}}, "secret")
	var uh *UnknownHostError
	if !errors.As(err, &uh) || !uh.Changed {
		t.Fatalf("want changed-host-key error, got %v", err)
	}
}

func TestKnownHostsFileIsTrusted(t *testing.T) {
	path := isolate(t)
	srv := sshtest.Start(t, sshtest.Options{User: "kx", Password: "secret"})
	line := knownhosts.Line([]string{knownhosts.Normalize(srv.Addr)}, srv.HostKey)
	os.WriteFile(path, []byte(line+"\n"), 0o600)
	hop := model.SSHHop{Host: srv.Host, Port: srv.Port, User: "kx", Auth: "password"}
	if _, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}}, "secret"); err != nil {
		t.Fatalf("host in known_hosts should be trusted without pinning: %v", err)
	}

	// A different key for the same host in known_hosts means "changed".
	other := sshtest.Start(t, sshtest.Options{User: "kx", Password: "secret"})
	line = knownhosts.Line([]string{knownhosts.Normalize(other.Addr)}, srv.HostKey)
	os.WriteFile(path, []byte(line+"\n"), 0o600)
	hop = model.SSHHop{Host: other.Host, Port: other.Port, User: "kx", Auth: "password"}
	_, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}}, "secret")
	var uh *UnknownHostError
	if !errors.As(err, &uh) || !uh.Changed {
		t.Fatalf("mismatching known_hosts entry should be flagged as changed, got %v", err)
	}
}

func TestPrivateKeyWithPassphrase(t *testing.T) {
	isolate(t)
	signer, pemBytes := sshtest.NewKey(t, "correct horse")
	srv := sshtest.Start(t, sshtest.Options{User: "deploy", AuthorizedKey: signer.PublicKey()})
	keyFile := filepath.Join(t.TempDir(), "id_ed25519")
	os.WriteFile(keyFile, pemBytes, 0o600)
	hop := model.SSHHop{Host: srv.Host, Port: srv.Port, User: "deploy", Auth: "key", KeyFile: keyFile, HostKey: ssh.FingerprintSHA256(srv.HostKey)}

	if _, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}}); err == nil || !strings.Contains(err.Error(), "needs a passphrase") {
		t.Fatalf("missing passphrase should be explained, got %v", err)
	}
	if _, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}}, "wrong"); err == nil {
		t.Fatal("wrong passphrase accepted")
	}
	tun, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}}, "correct horse")
	if err != nil {
		t.Fatal(err)
	}
	roundTrip(t, tun, sshtest.Echo(t))
}

func TestUnencryptedKey(t *testing.T) {
	isolate(t)
	signer, pemBytes := sshtest.NewKey(t, "")
	srv := sshtest.Start(t, sshtest.Options{User: "deploy", AuthorizedKey: signer.PublicKey()})
	keyFile := filepath.Join(t.TempDir(), "id_ed25519")
	os.WriteFile(keyFile, pemBytes, 0o600)
	hop := model.SSHHop{Host: srv.Host, Port: srv.Port, User: "deploy", Auth: "key", KeyFile: keyFile, HostKey: ssh.FingerprintSHA256(srv.HostKey)}
	tun, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}})
	if err != nil {
		t.Fatal(err)
	}
	roundTrip(t, tun, sshtest.Echo(t))
}

func TestJumpHosts(t *testing.T) {
	isolate(t)
	signer, pemBytes := sshtest.NewKey(t, "")
	keyFile := filepath.Join(t.TempDir(), "id_ed25519")
	os.WriteFile(keyFile, pemBytes, 0o600)
	bastion := sshtest.Start(t, sshtest.Options{User: "jump", Password: "pw1"})
	inner := sshtest.Start(t, sshtest.Options{User: "app", AuthorizedKey: signer.PublicKey()})
	echo := sshtest.Echo(t)

	hops := []model.SSHHop{
		{Host: bastion.Host, Port: bastion.Port, User: "jump", Auth: "password", HostKey: ssh.FingerprintSHA256(bastion.HostKey)},
		{Host: inner.Host, Port: inner.Port, User: "app", Auth: "key", KeyFile: keyFile},
	}
	// The second hop's key is unknown: the error must point at hop 1.
	_, err := open(t, &model.SSH{Hops: hops}, "pw1", "")
	var uh *UnknownHostError
	if !errors.As(err, &uh) || uh.Hop != 1 {
		t.Fatalf("want unknown host on hop 1, got %v", err)
	}
	hops[1].HostKey = ssh.FingerprintSHA256(inner.HostKey)
	tun, err := open(t, &model.SSH{Hops: hops}, "pw1", "")
	if err != nil {
		t.Fatal(err)
	}
	roundTrip(t, tun, echo)
	if got := bastion.Users(); len(got) == 0 || got[0] != "jump" {
		t.Fatalf("bastion logins: %v", got)
	}
	if got := inner.Users(); len(got) == 0 || got[0] != "app" {
		t.Fatalf("inner logins: %v", got)
	}
}

func TestAgentAuth(t *testing.T) {
	isolate(t)
	priv, signer := sshtest.NewRawKey(t)
	srv := sshtest.Start(t, sshtest.Options{User: "kx", AuthorizedKey: signer.PublicKey()})

	// Serve an in-memory agent over a unix socket and point SSH_AUTH_SOCK at it.
	keyring := agent.NewKeyring()
	if err := keyring.Add(agent.AddedKey{PrivateKey: priv}); err != nil {
		t.Fatal(err)
	}
	sock := filepath.Join(t.TempDir(), "agent.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Skipf("unix sockets unavailable: %v", err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go agent.ServeAgent(keyring, c)
		}
	}()
	t.Setenv("SSH_AUTH_SOCK", sock)

	hop := model.SSHHop{Host: srv.Host, Port: srv.Port, User: "kx", Auth: "agent", HostKey: ssh.FingerprintSHA256(srv.HostKey)}
	tun, err := open(t, &model.SSH{Hops: []model.SSHHop{hop}})
	if err != nil {
		t.Fatal(err)
	}
	roundTrip(t, tun, sshtest.Echo(t))
}
