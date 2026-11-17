// Package tunnel opens SSH connections (optionally through jump hosts) and
// dials databases through them.
package tunnel

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/lamprabit/karotx/internal/model"
)

// UnknownHostError is returned when a server's host key isn't trusted yet.
// The UI shows the fingerprint and, if the user accepts, pins it on the hop.
type UnknownHostError struct {
	Hop         int    `json:"hop"`
	Host        string `json:"host"`
	Fingerprint string `json:"fingerprint"`
	Changed     bool   `json:"changed"` // a pinned key no longer matches (possible attack)
}

func (e *UnknownHostError) Error() string {
	if e.Changed {
		return fmt.Sprintf("the SSH host key for %s has changed (%s)", e.Host, e.Fingerprint)
	}
	return fmt.Sprintf("unknown SSH host key for %s (%s)", e.Host, e.Fingerprint)
}

type Tunnel struct {
	clients []*ssh.Client // in hop order; last one dials the target
	done    chan struct{}
}

// Open connects through every hop. secrets[i] is the password or key
// passphrase for hop i.
func Open(ctx context.Context, cfg *model.SSH, secrets []string) (*Tunnel, error) {
	t := &Tunnel{done: make(chan struct{})}
	for i, hop := range cfg.Hops {
		secret := ""
		if i < len(secrets) {
			secret = secrets[i]
		}
		auth, err := authMethod(hop, secret)
		if err != nil {
			t.Close()
			return nil, fmt.Errorf("SSH %s: %w", hop.Host, err)
		}
		addr := net.JoinHostPort(hop.Host, strconv.Itoa(hop.Port))
		conf := &ssh.ClientConfig{
			User:            hop.User,
			Auth:            auth,
			HostKeyCallback: hostKeyCallback(i, hop),
			Timeout:         15 * time.Second,
		}

		var raw net.Conn
		if i == 0 {
			var d net.Dialer
			raw, err = d.DialContext(ctx, "tcp", addr)
		} else {
			raw, err = t.clients[i-1].DialContext(ctx, "tcp", addr)
		}
		if err != nil {
			t.Close()
			return nil, fmt.Errorf("reach SSH server %s: %w", addr, err)
		}
		c, chans, reqs, err := ssh.NewClientConn(raw, addr, conf)
		if err != nil {
			raw.Close()
			t.Close()
			var uh *UnknownHostError
			if errors.As(err, &uh) {
				return nil, uh
			}
			return nil, fmt.Errorf("SSH login to %s: %w", addr, err)
		}
		t.clients = append(t.clients, ssh.NewClient(c, chans, reqs))
	}
	go t.keepalive()
	return t, nil
}

// Dial opens a TCP connection to addr from the last SSH server.
func (t *Tunnel) Dial(ctx context.Context, _, addr string) (net.Conn, error) {
	return t.clients[len(t.clients)-1].DialContext(ctx, "tcp", addr)
}

func (t *Tunnel) Close() error {
	select {
	case <-t.done:
	default:
		close(t.done)
	}
	for i := len(t.clients) - 1; i >= 0; i-- {
		t.clients[i].Close()
	}
	return nil
}

func (t *Tunnel) keepalive() {
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-t.done:
			return
		case <-tick.C:
			for _, c := range t.clients {
				c.SendRequest("keepalive@openssh.com", true, nil)
			}
		}
	}
}

func authMethod(hop model.SSHHop, secret string) ([]ssh.AuthMethod, error) {
	switch hop.Auth {
	case "password":
		return []ssh.AuthMethod{ssh.Password(secret)}, nil
	case "key":
		pem, err := os.ReadFile(expandHome(hop.KeyFile))
		if err != nil {
			return nil, fmt.Errorf("read private key: %w", err)
		}
		var signer ssh.Signer
		if secret != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(pem, []byte(secret))
		} else {
			signer, err = ssh.ParsePrivateKey(pem)
		}
		var missing *ssh.PassphraseMissingError
		if errors.As(err, &missing) {
			return nil, errors.New("this private key needs a passphrase")
		}
		if err != nil {
			return nil, fmt.Errorf("private key: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	case "agent":
		conn, err := dialAgent()
		if err != nil {
			return nil, fmt.Errorf("SSH agent not available: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeysCallback(agent.NewClient(conn).Signers)}, nil
	}
	return nil, fmt.Errorf("unknown SSH auth method %q", hop.Auth)
}

// hostKeyCallback trusts a pinned fingerprint, else ~/.ssh/known_hosts, else
// reports UnknownHostError so the user can decide.
func hostKeyCallback(i int, hop model.SSHHop) ssh.HostKeyCallback {
	return func(host string, remote net.Addr, key ssh.PublicKey) error {
		fp := ssh.FingerprintSHA256(key)
		if hop.HostKey != "" {
			if hop.HostKey == fp {
				return nil
			}
			return &UnknownHostError{Hop: i, Host: hop.Host, Fingerprint: fp, Changed: true}
		}
		if kh, err := knownhosts.New(expandHome("~/.ssh/known_hosts")); err == nil {
			err := kh(host, remote, key)
			var ke *knownhosts.KeyError
			if err == nil {
				return nil
			}
			if errors.As(err, &ke) && len(ke.Want) > 0 {
				return &UnknownHostError{Hop: i, Host: hop.Host, Fingerprint: fp, Changed: true}
			}
		}
		return &UnknownHostError{Hop: i, Host: hop.Host, Fingerprint: fp}
	}
}

func expandHome(p string) string {
	if len(p) > 1 && p[0] == '~' {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[1:])
		}
	}
	return p
}
