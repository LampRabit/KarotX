package sqldb

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
)

// testPKI writes a CA, a server cert for "db.local" and a client cert into dir.
func testPKI(t *testing.T, dir string) (ca, serverCert, serverKey, clientCert, clientKey string) {
	t.Helper()
	write := func(name, typ string, der []byte) string {
		p := filepath.Join(dir, name)
		os.WriteFile(p, pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: der}), 0o600)
		return p
	}
	newKey := func() *ecdsa.PrivateKey { k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader); return k }
	caKey := newKey()
	caTpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "KarotX Test CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, KeyUsage: x509.KeyUsageCertSign, BasicConstraintsValid: true}
	caDER, _ := x509.CreateCertificate(rand.Reader, caTpl, caTpl, &caKey.PublicKey, caKey)
	caCert, _ := x509.ParseCertificate(caDER)
	issue := func(serial int64, cn string, usage x509.ExtKeyUsage, dns []string) ([]byte, []byte) {
		k := newKey()
		tpl := &x509.Certificate{SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: cn}, DNSNames: dns, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), ExtKeyUsage: []x509.ExtKeyUsage{usage}, KeyUsage: x509.KeyUsageDigitalSignature}
		der, _ := x509.CreateCertificate(rand.Reader, tpl, caCert, &k.PublicKey, caKey)
		kder, _ := x509.MarshalECPrivateKey(k)
		return der, kder
	}
	sDER, sKey := issue(2, "db.local", x509.ExtKeyUsageServerAuth, []string{"db.local"})
	cDER, cKey := issue(3, "karotx", x509.ExtKeyUsageClientAuth, nil)
	return write("ca.pem", "CERTIFICATE", caDER),
		write("server.pem", "CERTIFICATE", sDER), write("server-key.pem", "EC PRIVATE KEY", sKey),
		write("client.pem", "CERTIFICATE", cDER), write("client-key.pem", "EC PRIVATE KEY", cKey)
}

// TestMySQLTLSConfig checks the verify / require / client-cert options with a
// real TLS handshake against a server that demands a client certificate.
func TestMySQLTLSConfig(t *testing.T) {
	dir := t.TempDir()
	ca, sCert, sKey, cCert, cKey := testPKI(t, dir)
	pair, err := tls.LoadX509KeyPair(sCert, sKey)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	caPEM, _ := os.ReadFile(ca)
	pool.AppendCertsFromPEM(caPEM)
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{pair}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool})
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() { c.(*tls.Conn).Handshake(); c.Close() }()
		}
	}()
	handshake := func(cfg *tls.Config) error {
		raw, err := net.Dial("tcp", ln.Addr().String())
		if err != nil {
			return err
		}
		defer raw.Close()
		return tls.Client(raw, cfg).Handshake()
	}

	// Verify mode: correct CA + host name + client cert succeeds.
	cfg, err := tlsConfig("db.local", true, ca, cCert, cKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := handshake(cfg); err != nil {
		t.Fatalf("verify with CA + client cert: %v", err)
	}
	// Verify mode with the wrong host name fails.
	cfg, _ = tlsConfig("other.local", true, ca, cCert, cKey)
	if err := handshake(cfg); err == nil {
		t.Fatal("host name mismatch was accepted in verify mode")
	}
	// Verify mode without the CA (unknown issuer) fails.
	cfg, _ = tlsConfig("db.local", true, "", cCert, cKey)
	if err := handshake(cfg); err == nil {
		t.Fatal("unknown CA was accepted in verify mode")
	}
	// Require mode encrypts without checking the certificate.
	cfg, _ = tlsConfig("anything", false, "", cCert, cKey)
	if err := handshake(cfg); err != nil {
		t.Fatalf("require mode: %v", err)
	}
	// A file that isn't a CA bundle is reported.
	if _, err := tlsConfig("db.local", true, cKey, "", ""); err == nil {
		t.Fatal("bad CA file accepted")
	}
}

// TestPostgresTLSParams checks the TLS options reach pgx (CA loaded, full verification).
func TestPostgresTLSParams(t *testing.T) {
	ca, _, _, cCert, cKey := testPKI(t, t.TempDir())
	c := model.Connection{Host: "db.local", Port: 5432, User: "u", Database: "d", TLS: model.TLS{Mode: "verify", CAFile: ca, CertFile: cCert, KeyFile: cKey}}
	db, err := (postgres{}).open(context.Background(), driver.OpenParams{Conn: c})
	if err != nil {
		t.Fatalf("verify + CA + client cert should configure: %v", err)
	}
	db.Close()
	c.TLS.CAFile = filepath.Join(t.TempDir(), "missing.pem")
	if _, err := (postgres{}).open(context.Background(), driver.OpenParams{Conn: c}); err == nil {
		t.Fatal("missing CA file should fail")
	}
}
