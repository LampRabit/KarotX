package driver

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"os"
)

// TLSConfig builds a client TLS config. verify=false encrypts without
// checking the certificate ("require"); caFile adds a private CA; certFile +
// keyFile present a client certificate.
func TLSConfig(host string, verify bool, caFile, certFile, keyFile string) (*tls.Config, error) {
	t := &tls.Config{ServerName: host, InsecureSkipVerify: !verify, MinVersion: tls.VersionTLS12}
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, err
		}
		t.RootCAs = x509.NewCertPool()
		if !t.RootCAs.AppendCertsFromPEM(pem) {
			return nil, errors.New("the CA file contains no certificates")
		}
	}
	if certFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, err
		}
		t.Certificates = []tls.Certificate{cert}
	}
	return t, nil
}
