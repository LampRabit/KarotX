// Package sshtest runs small in-process SSH servers for tests: password and
// public-key login, and "direct-tcpip" forwarding (what tunnels use).
package sshtest

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"io"
	"net"
	"strconv"
	"sync"
	"testing"

	"golang.org/x/crypto/ssh"
)

type Server struct {
	Addr    string
	Host    string
	Port    int
	HostKey ssh.PublicKey
	mu      sync.Mutex
	Logins  []string // users that logged in
}

// Options choose which logins the server accepts.
type Options struct {
	User          string
	Password      string        // accepted if non-empty
	AuthorizedKey ssh.PublicKey // accepted if non-nil
}

// Start listens on 127.0.0.1 and serves until the test ends.
func Start(t testing.TB, o Options) *Server {
	t.Helper()
	_, hostPriv, _ := ed25519.GenerateKey(rand.Reader)
	hostSigner, err := ssh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{HostKey: hostSigner.PublicKey()}
	cfg := &ssh.ServerConfig{}
	if o.Password != "" {
		cfg.PasswordCallback = func(c ssh.ConnMetadata, pw []byte) (*ssh.Permissions, error) {
			if c.User() == o.User && string(pw) == o.Password {
				return nil, nil
			}
			return nil, errDenied
		}
	}
	if o.AuthorizedKey != nil {
		want := o.AuthorizedKey.Marshal()
		cfg.PublicKeyCallback = func(c ssh.ConnMetadata, k ssh.PublicKey) (*ssh.Permissions, error) {
			if c.User() == o.User && string(k.Marshal()) == string(want) {
				return nil, nil
			}
			return nil, errDenied
		}
	}
	cfg.AddHostKey(hostSigner)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	s.Addr = ln.Addr().String()
	host, port, _ := net.SplitHostPort(s.Addr)
	s.Host = host
	s.Port, _ = strconv.Atoi(port)

	go func() {
		for {
			raw, err := ln.Accept()
			if err != nil {
				return
			}
			go s.serve(raw, cfg)
		}
	}()
	return s
}

type deniedErr struct{}

func (deniedErr) Error() string { return "access denied" }

var errDenied = deniedErr{}

func (s *Server) serve(raw net.Conn, cfg *ssh.ServerConfig) {
	conn, chans, reqs, err := ssh.NewServerConn(raw, cfg)
	if err != nil {
		raw.Close()
		return
	}
	s.mu.Lock()
	s.Logins = append(s.Logins, conn.User())
	s.mu.Unlock()
	go ssh.DiscardRequests(reqs)
	for nc := range chans {
		if nc.ChannelType() != "direct-tcpip" {
			nc.Reject(ssh.UnknownChannelType, "only direct-tcpip")
			continue
		}
		var req struct {
			Host     string
			Port     uint32
			OrigHost string
			OrigPort uint32
		}
		if err := ssh.Unmarshal(nc.ExtraData(), &req); err != nil {
			nc.Reject(ssh.ConnectionFailed, "bad request")
			continue
		}
		target, err := net.Dial("tcp", net.JoinHostPort(req.Host, strconv.Itoa(int(req.Port))))
		if err != nil {
			nc.Reject(ssh.ConnectionFailed, err.Error())
			continue
		}
		ch, chReqs, err := nc.Accept()
		if err != nil {
			target.Close()
			continue
		}
		go ssh.DiscardRequests(chReqs)
		go func() {
			defer ch.Close()
			defer target.Close()
			done := make(chan struct{}, 2)
			go func() { io.Copy(ch, target); done <- struct{}{} }()
			go func() { io.Copy(target, ch); done <- struct{}{} }()
			<-done
		}()
	}
}

// Users returns who has logged in so far.
func (s *Server) Users() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.Logins...)
}

// NewKey returns an ed25519 key pair with its private key in OpenSSH PEM
// format, encrypted when passphrase is non-empty.
func NewKey(t testing.TB, passphrase string) (ssh.Signer, []byte) {
	t.Helper()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	var block *pem.Block
	if passphrase == "" {
		block, err = ssh.MarshalPrivateKey(priv, "karotx-test")
	} else {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(priv, "karotx-test", []byte(passphrase))
	}
	if err != nil {
		t.Fatal(err)
	}
	return signer, pem.EncodeToMemory(block)
}

// NewRawKey returns an ed25519 private key and its signer (e.g. to load into an agent).
func NewRawKey(t testing.TB) (ed25519.PrivateKey, ssh.Signer) {
	t.Helper()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	return priv, signer
}

// Echo starts a TCP server that echoes what it receives; returns its address.
func Echo(t testing.TB) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() { io.Copy(c, c); c.Close() }()
		}
	}()
	return ln.Addr().String()
}
