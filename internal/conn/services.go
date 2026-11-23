package conn

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/lamprabit/karotx/internal/model"
)

// A services file is a JSON list of databases written by another tool (a
// local dev stack such as LampRabit, a script, ...). KarotX watches it and
// shows those databases as managed connections: kept in memory only, never
// written to the workspace file or the keychain. Format: docs/services-file.md.

// managedPrefix keeps managed IDs apart from saved ones. "lr-" is kept from
// the first (LampRabit-only) version so restored tabs stay attached.
const managedPrefix = "lr-"

type services struct {
	Version   int    `json:"version"`
	Source    string `json:"source"` // tool name, shown as the sidebar group
	Databases []struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Type     string `json:"type"`
		Host     string `json:"host"`
		Port     int    `json:"port"`
		User     string `json:"user"`
		Password string `json:"password"`
		Database string `json:"database"`
		File     string `json:"file"`
		Status   string `json:"status"`
	} `json:"databases"`
}

type managed struct {
	source      string
	conn        model.Connection
	password    string
	unavailable string // why it can't be opened; "" = usable
}

var serviceID = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)

// driverFor maps a services-file type to a KarotX driver; "" = not supported yet.
var driverFor = map[string]string{
	"postgres": "postgres", "mysql": "mysql", "mariadb": "mysql",
	"sqlite": "sqlite", "redis": "redis", "mongodb": "mongodb",
	"clickhouse": "clickhouse", "neo4j": "neo4j", "memcached": "memcached", "dynamodb": "dynamodb",
}

func parseServices(data []byte) ([]managed, error) {
	var s services
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	if s.Version != 1 {
		return nil, fmt.Errorf("unsupported version %d (expected 1)", s.Version)
	}
	src := strings.TrimSpace(s.Source)
	if src == "" {
		src = "Services"
	}
	if len(src) > 40 {
		src = src[:40]
	}
	out := make([]managed, 0, len(s.Databases))
	seen := map[string]bool{}
	for _, d := range s.Databases {
		if !serviceID.MatchString(d.ID) || seen[d.ID] {
			continue // skip entries we can't address safely
		}
		seen[d.ID] = true
		c := model.Connection{
			ID: managedPrefix + d.ID, Name: d.Name, Driver: driverFor[d.Type], Preset: d.Type,
			Host: d.Host, Port: d.Port, User: d.User, Database: d.Database, File: d.File,
		}
		if c.Name == "" {
			c.Name = d.ID
		}
		if d.Type == "redis" && c.Database == "" {
			c.Database = "0"
		}
		m := managed{source: src, conn: c, password: d.Password}
		switch {
		case c.Driver == "":
			m.conn.Driver = d.Type
			m.unavailable = "KarotX doesn't support " + d.Type + " databases"
		case d.Status != "running":
			m.unavailable = "Stopped in " + src
		default:
			if err := m.conn.Validate(); err != nil {
				m.unavailable = "Incomplete entry in the services file: " + err.Error()
			}
		}
		out = append(out, m)
	}
	return out, nil
}

func (m *Manager) findManaged(id string) (managed, bool) {
	m.lr.RLock()
	defer m.lr.RUnlock()
	for _, x := range m.managed {
		if x.conn.ID == id {
			return x, true
		}
	}
	return managed{}, false
}

func (m *Manager) errManaged(id string) error {
	x, _ := m.findManaged(id)
	return fmt.Errorf("this connection is managed by %s; change it there", cmp.Or(x.source, "the services file"))
}

// Changed returns a channel that is closed the next time the services list
// changes. Call it again after it fires.
func (m *Manager) Changed() <-chan struct{} {
	m.lr.RLock()
	defer m.lr.RUnlock()
	return m.changed
}

// ServicesError is the last problem reading the services file ("" = fine).
func (m *Manager) ServicesError() string {
	m.lr.RLock()
	defer m.lr.RUnlock()
	return m.servicesErr
}

// applyServices replaces the managed list (or records an error and keeps the
// last good list), closes sessions whose settings changed, and notifies.
func (m *Manager) applyServices(list []managed, loadErr error) {
	m.lr.Lock()
	var stale []string
	if loadErr == nil {
		next := map[string]managed{}
		for _, x := range list {
			next[x.conn.ID] = x
		}
		for _, old := range m.managed {
			if n, ok := next[old.conn.ID]; !ok || !sameManaged(old, n) {
				stale = append(stale, old.conn.ID)
			}
		}
		m.managed, m.servicesErr = list, ""
	} else {
		m.servicesErr = "Services file: " + loadErr.Error()
	}
	close(m.changed)
	m.changed = make(chan struct{})
	m.lr.Unlock()
	for _, id := range stale {
		m.Disconnect(id)
	}
}

func sameManaged(a, b managed) bool {
	ja, _ := json.Marshal(a.conn)
	jb, _ := json.Marshal(b.conn)
	return string(ja) == string(jb) && a.password == b.password && a.unavailable == b.unavailable
}

// WatchServices loads the services file and reloads it whenever it
// changes, until ctx ends.
// shortcut: polls mtime+size every second instead of OS file events; a
// same-size rewrite within one mtime tick is missed. Switch to fsnotify if
// that ever matters.
func (m *Manager) WatchServices(ctx context.Context, path string) {
	var lastMod time.Time
	var lastSize int64 = -1
	seen := false
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		fi, err := os.Stat(path)
		switch {
		case err != nil && !seen:
			// Not created yet: the owning tool will write it; nothing to show.
		case err != nil:
			if lastSize != -2 {
				m.applyServices(nil, errors.New("can't read it ("+err.Error()+"); showing the last known list"))
				lastSize = -2
			}
		case !fi.ModTime().Equal(lastMod) || fi.Size() != lastSize:
			lastMod, lastSize, seen = fi.ModTime(), fi.Size(), true
			data, err := os.ReadFile(path)
			if err == nil {
				var list []managed
				if list, err = parseServices(data); err == nil {
					m.applyServices(list, nil)
					break
				}
			}
			fmt.Fprintln(os.Stderr, "karotx: services file:", err)
			m.applyServices(nil, err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
