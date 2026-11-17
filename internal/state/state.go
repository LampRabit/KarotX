// Package state persists KarotX workspace state (connections, open tabs,
// settings) in a single AES-256-GCM encrypted file. The key never lives in
// the file: each file gets a random key stored in the OS keychain.
//
// Workspace files use the .kxs extension.
//
// File layout: magic(4) | version(1) | fileID(16) | nonce(12) | ciphertext
// The header is authenticated as GCM additional data.
package state

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/lamprabit/karotx/internal/secrets"
)

var magic = []byte("KRTX")

const (
	formatVersion = 1
	idLen         = 16
	nonceLen      = 12
	headerLen     = 4 + 1 + idLen
)

// State is the persisted workspace. Secrets (passwords, keys) are never
// stored here; they live in the OS keychain.
type State struct {
	Settings    Settings          `json:"settings"`
	Connections []json.RawMessage `json:"connections"`
	Tabs        []json.RawMessage `json:"tabs"`
	ActiveTab   string            `json:"activeTab,omitempty"`
}

type Settings struct {
	Theme string `json:"theme"` // theme id, e.g. "karot"
	Mode  string `json:"mode"`  // "system" | "light" | "dark"
}

func defaults() State {
	return State{
		Settings:    Settings{Theme: "karot", Mode: "system"},
		Connections: []json.RawMessage{},
		Tabs:        []json.RawMessage{},
	}
}

// Store is a concurrency-safe handle to one state file.
type Store struct {
	mu     sync.Mutex
	path   string
	fileID []byte
	aead   cipher.AEAD
	state  State
}

// Open loads the state file at path, creating it (and its keychain key) if
// it doesn't exist yet.
func Open(path string) (*Store, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	s := &Store{path: path}

	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, s.create()
	}
	if err != nil {
		return nil, err
	}
	return s, s.load(data)
}

func (s *Store) create() error {
	s.fileID = randBytes(idLen)
	key := randBytes(32)
	if err := secrets.Set(keyName(s.fileID), base64.StdEncoding.EncodeToString(key)); err != nil {
		return fmt.Errorf("store state key in OS keychain: %w", err)
	}
	if err := s.initCipher(key); err != nil {
		return err
	}
	s.state = defaults()
	return s.write()
}

func (s *Store) load(data []byte) error {
	if len(data) < headerLen+nonceLen || !bytes.Equal(data[:4], magic) {
		return fmt.Errorf("%s is not a KarotX state file", s.path)
	}
	if data[4] != formatVersion {
		return fmt.Errorf("unsupported state file version %d", data[4])
	}
	s.fileID = append([]byte(nil), data[5:headerLen]...)

	enc, err := secrets.Get(keyName(s.fileID))
	if errors.Is(err, secrets.ErrNotFound) {
		return fmt.Errorf("the key for %s is not in this machine's keychain; the file was created on another machine or user account", s.path)
	}
	if err != nil {
		return err
	}
	key, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return fmt.Errorf("corrupt state key in keychain: %w", err)
	}
	if err := s.initCipher(key); err != nil {
		return err
	}

	nonce := data[headerLen : headerLen+nonceLen]
	plain, err := s.aead.Open(nil, nonce, data[headerLen+nonceLen:], data[:headerLen])
	if err != nil {
		return fmt.Errorf("decrypt %s: file is corrupt or was modified", s.path)
	}
	st := defaults()
	if err := json.Unmarshal(plain, &st); err != nil {
		return fmt.Errorf("parse state: %w", err)
	}
	s.state = st
	return nil
}

func (s *Store) initCipher(key []byte) error {
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	s.aead, err = cipher.NewGCM(block)
	return err
}

// write encrypts and atomically replaces the file. Caller holds s.mu (or is
// the constructor).
func (s *Store) write() error {
	plain, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	header := append(append(append([]byte{}, magic...), formatVersion), s.fileID...)
	nonce := randBytes(nonceLen)
	out := append(append(header, nonce...), s.aead.Seal(nil, nonce, plain, header)...)

	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".karotx-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(out); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.path)
}

// Path returns the absolute path of the state file.
func (s *Store) Path() string { return s.path }

// Get returns a copy of the current state.
func (s *Store) Get() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

// Update applies fn to the state and persists it. If saving fails the
// in-memory state is rolled back.
func (s *Store) Update(fn func(*State)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	prev := s.state
	fn(&s.state)
	if err := s.write(); err != nil {
		s.state = prev
		return err
	}
	return nil
}

func keyName(id []byte) string { return "state:" + hex.EncodeToString(id) }

func randBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	return b
}
