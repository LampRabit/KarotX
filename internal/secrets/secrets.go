// Package secrets stores sensitive values in the OS keychain
// (Windows Credential Manager, macOS Keychain, Secret Service on Linux).
package secrets

import (
	"errors"

	"github.com/zalando/go-keyring"
)

const service = "karotx"

// ErrNotFound is returned when no secret exists for the key.
var ErrNotFound = errors.New("secret not found in OS keychain")

func Get(key string) (string, error) {
	v, err := keyring.Get(service, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNotFound
	}
	return v, err
}

func Set(key, value string) error { return keyring.Set(service, key, value) }

func Delete(key string) error {
	err := keyring.Delete(service, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}
