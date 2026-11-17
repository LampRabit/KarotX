// Package auth manages the optional UI password. The password is configured
// from the UI once and stored (as an Argon2id hash) in the OS keychain, so it
// applies to every KarotX workspace for this OS user.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"

	"github.com/lamprabit/karotx/internal/secrets"
)

const (
	keychainKey = "auth:password"
	sessionTTL  = 30 * 24 * time.Hour
	minLength   = 8
)

var ErrWrongPassword = errors.New("wrong password")

type Manager struct {
	mu       sync.Mutex
	hash     string // "" = no password configured
	sessions map[string]time.Time
}

// Load reads any configured password hash from the keychain.
func Load() (*Manager, error) {
	h, err := secrets.Get(keychainKey)
	if err != nil && !errors.Is(err, secrets.ErrNotFound) {
		return nil, fmt.Errorf("read password from OS keychain: %w", err)
	}
	return &Manager{hash: h, sessions: map[string]time.Time{}}, nil
}

func (m *Manager) Enabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.hash != ""
}

// Login checks the password and returns a new session token.
func (m *Manager) Login(password string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.hash == "" || !verify(m.hash, password) {
		return "", ErrWrongPassword
	}
	return m.newSession(), nil
}

// Valid reports whether token is a live session (always true without a password).
func (m *Manager) Valid(token string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.hash == "" {
		return true
	}
	exp, ok := m.sessions[token]
	if ok && time.Now().Before(exp) {
		return true
	}
	delete(m.sessions, token)
	return false
}

func (m *Manager) Logout(token string) {
	m.mu.Lock()
	delete(m.sessions, token)
	m.mu.Unlock()
}

// Set configures or changes the password. If one exists, current must match.
// All existing sessions are revoked; a fresh session for the caller is returned.
func (m *Manager) Set(current, next string) (string, error) {
	if len(next) < minLength {
		return "", fmt.Errorf("password must be at least %d characters", minLength)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.hash != "" && !verify(m.hash, current) {
		return "", ErrWrongPassword
	}
	h := hash(next)
	if err := secrets.Set(keychainKey, h); err != nil {
		return "", fmt.Errorf("save password to OS keychain: %w", err)
	}
	m.hash = h
	m.sessions = map[string]time.Time{}
	return m.newSession(), nil
}

// Remove disables password protection after verifying current.
func (m *Manager) Remove(current string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.hash == "" {
		return nil
	}
	if !verify(m.hash, current) {
		return ErrWrongPassword
	}
	if err := secrets.Delete(keychainKey); err != nil {
		return err
	}
	m.hash = ""
	m.sessions = map[string]time.Time{}
	return nil
}

func (m *Manager) newSession() string {
	now := time.Now()
	for t, exp := range m.sessions { // prune expired
		if now.After(exp) {
			delete(m.sessions, t)
		}
	}
	b := make([]byte, 32)
	rand.Read(b)
	t := hex.EncodeToString(b)
	m.sessions[t] = now.Add(sessionTTL)
	return t
}

// Argon2id, encoded as "argon2id$<salt>$<hash>" (base64, fixed params).
const (
	aTime, aMem, aThreads, aKeyLen = 2, 64 * 1024, 2, 32
)

func hash(pw string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	k := argon2.IDKey([]byte(pw), salt, aTime, aMem, aThreads, aKeyLen)
	enc := base64.RawStdEncoding
	return "argon2id$" + enc.EncodeToString(salt) + "$" + enc.EncodeToString(k)
}

func verify(encoded, pw string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 3 || parts[0] != "argon2id" {
		return false
	}
	enc := base64.RawStdEncoding
	salt, err1 := enc.DecodeString(parts[1])
	want, err2 := enc.DecodeString(parts[2])
	if err1 != nil || err2 != nil {
		return false
	}
	got := argon2.IDKey([]byte(pw), salt, aTime, aMem, aThreads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}
