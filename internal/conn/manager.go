// Package conn manages saved connections and live database sessions. Every
// session is independent (own pool, own tunnel), so a slow or broken
// database never affects the others.
package conn

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/lamprabit/karotx/internal/driver"
	_ "github.com/lamprabit/karotx/internal/driver/sqldb" // registers SQL drivers
	"github.com/lamprabit/karotx/internal/model"
	"github.com/lamprabit/karotx/internal/secrets"
	"github.com/lamprabit/karotx/internal/state"
	"github.com/lamprabit/karotx/internal/tunnel"
)

const connectTimeout = 25 * time.Second

var ErrNotFound = errors.New("connection not found")

// SecretsInput updates secrets; nil fields keep the stored value.
type SecretsInput struct {
	Password *string   `json:"password"`
	SSH      []*string `json:"ssh"`
}

// View is a connection as shown in the UI, with its live status.
type View struct {
	model.Connection
	Status      string       `json:"status"` // idle | connecting | connected | error
	Error       string       `json:"error,omitempty"`
	Info        *driver.Info `json:"info,omitempty"`
	HasPassword bool         `json:"hasPassword"`
}

type session struct {
	ready  chan struct{} // closed once connecting finishes
	conn   driver.Conn
	tunnel *tunnel.Tunnel
	err    error
}

func (s *session) close() {
	if s.conn != nil {
		s.conn.Close()
	}
	if s.tunnel != nil {
		s.tunnel.Close()
	}
}

type Manager struct {
	store    *state.Store
	mu       sync.Mutex
	sessions map[string]*session
	queries  map[string]context.CancelFunc
}

func NewManager(store *state.Store) *Manager {
	return &Manager{store: store, sessions: map[string]*session{}, queries: map[string]context.CancelFunc{}}
}

func secretKey(id string) string { return "conn:" + id }

func loadSecrets(id string) model.Secrets {
	var s model.Secrets
	if id == "" {
		return s
	}
	if raw, err := secrets.Get(secretKey(id)); err == nil {
		json.Unmarshal([]byte(raw), &s)
	}
	return s
}

func merge(s model.Secrets, in *SecretsInput, hops int) model.Secrets {
	if in != nil && in.Password != nil {
		s.Password = *in.Password
	}
	ssh := make([]string, hops)
	copy(ssh, s.SSH)
	if in != nil {
		for i, v := range in.SSH {
			if i < hops && v != nil {
				ssh[i] = *v
			}
		}
	}
	s.SSH = ssh
	return s
}

func hopCount(c model.Connection) int {
	if c.SSH == nil {
		return 0
	}
	return len(c.SSH.Hops)
}

func (m *Manager) find(id string) (model.Connection, error) {
	for _, c := range m.store.Get().Connections {
		if c.ID == id {
			return c, nil
		}
	}
	return model.Connection{}, ErrNotFound
}

func (m *Manager) List() []View {
	conns := m.store.Get().Connections
	out := make([]View, len(conns))
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, c := range conns {
		v := View{Connection: c, Status: "idle", HasPassword: loadSecrets(c.ID).Password != ""}
		if s, ok := m.sessions[c.ID]; ok {
			select {
			case <-s.ready:
				if s.err != nil {
					v.Status, v.Error = "error", s.err.Error()
				} else {
					info := s.conn.Info()
					v.Status, v.Info = "connected", &info
				}
			default:
				v.Status = "connecting"
			}
		}
		out[i] = v
	}
	return out
}

// Save creates (empty ID) or updates a connection and its secrets.
func (m *Manager) Save(c model.Connection, in *SecretsInput) (model.Connection, error) {
	if err := c.Validate(); err != nil {
		return c, err
	}
	isNew := c.ID == ""
	if isNew {
		b := make([]byte, 8)
		rand.Read(b)
		c.ID = hex.EncodeToString(b)
	} else if _, err := m.find(c.ID); err != nil {
		return c, err
	}

	sec := merge(loadSecrets(c.ID), in, hopCount(c))
	raw, _ := json.Marshal(sec)
	if err := secrets.Set(secretKey(c.ID), string(raw)); err != nil {
		return c, fmt.Errorf("save secrets to OS keychain: %w", err)
	}
	err := m.store.Update(func(st *state.State) {
		if isNew {
			st.Connections = append(st.Connections, c)
			return
		}
		for i := range st.Connections {
			if st.Connections[i].ID == c.ID {
				st.Connections[i] = c
			}
		}
	})
	if err != nil {
		return c, err
	}
	if !isNew {
		m.Disconnect(c.ID) // settings changed; reconnect on next use
	}
	return c, nil
}

func (m *Manager) Delete(id string) error {
	m.Disconnect(id)
	if err := m.store.Update(func(st *state.State) {
		st.Connections = slices.DeleteFunc(st.Connections, func(c model.Connection) bool { return c.ID == id })
	}); err != nil {
		return err
	}
	return secrets.Delete(secretKey(id))
}

// Reorder sets the sidebar order of connections.
func (m *Manager) Reorder(ids []string) error {
	return m.store.Update(func(st *state.State) {
		pos := map[string]int{}
		for i, id := range ids {
			pos[id] = i
		}
		slices.SortStableFunc(st.Connections, func(a, b model.Connection) int {
			pa, oka := pos[a.ID]
			pb, okb := pos[b.ID]
			if !oka || !okb {
				return 0
			}
			return pa - pb
		})
	})
}

func open(ctx context.Context, c model.Connection, sec model.Secrets) (*session, error) {
	d, err := driver.Get(c.Driver)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()

	s := &session{}
	var dial driver.DialFunc
	if c.SSH != nil && c.Driver != "sqlite" {
		if s.tunnel, err = tunnel.Open(ctx, c.SSH, sec.SSH); err != nil {
			return nil, err
		}
		dial = s.tunnel.Dial
	}
	s.conn, err = d.Open(ctx, driver.OpenParams{Conn: c, Password: sec.Password, Dial: dial})
	if err != nil {
		s.close()
		return nil, err
	}
	return s, nil
}

// Test opens a throwaway session with unsaved settings. For an existing
// connection, stored secrets fill in anything not re-entered.
func (m *Manager) Test(ctx context.Context, c model.Connection, in *SecretsInput) (driver.Info, error) {
	if err := c.Validate(); err != nil {
		return driver.Info{}, err
	}
	s, err := open(ctx, c, merge(loadSecrets(c.ID), in, hopCount(c)))
	if err != nil {
		return driver.Info{}, err
	}
	defer s.close()
	return s.conn.Info(), nil
}

// Session returns a live session, connecting on first use. Concurrent
// callers share one connection attempt.
func (m *Manager) Session(ctx context.Context, id string) (driver.Conn, error) {
	m.mu.Lock()
	s, ok := m.sessions[id]
	if ok {
		select {
		case <-s.ready:
			if s.err != nil { // retry after a failed attempt
				delete(m.sessions, id)
				ok = false
			}
		default:
		}
	}
	if !ok {
		c, err := m.find(id)
		if err != nil {
			m.mu.Unlock()
			return nil, err
		}
		s = &session{ready: make(chan struct{})}
		m.sessions[id] = s
		go func() {
			opened, err := open(context.Background(), c, loadSecrets(id))
			if err == nil {
				s.conn, s.tunnel = opened.conn, opened.tunnel
			}
			s.err = err
			close(s.ready)
		}()
	}
	m.mu.Unlock()

	select {
	case <-s.ready:
		if s.err != nil {
			return nil, s.err
		}
		return s.conn, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (m *Manager) Disconnect(id string) {
	m.mu.Lock()
	s, ok := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if ok {
		go func() { <-s.ready; s.close() }()
	}
}

// Run executes work under a cancellable context registered as queryID.
func (m *Manager) Run(ctx context.Context, queryID string, work func(context.Context) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if queryID != "" {
		m.mu.Lock()
		m.queries[queryID] = cancel
		m.mu.Unlock()
		defer func() {
			m.mu.Lock()
			delete(m.queries, queryID)
			m.mu.Unlock()
		}()
	}
	return work(ctx)
}

func (m *Manager) Cancel(queryID string) bool {
	m.mu.Lock()
	cancel, ok := m.queries[queryID]
	m.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

// Close shuts every session down (on server exit).
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, s := range m.sessions {
		go func() { <-s.ready; s.close() }()
		delete(m.sessions, id)
	}
}
