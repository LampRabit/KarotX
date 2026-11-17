// Package driver defines the contract every database driver implements.
// Optional features are advertised through Info.Caps so the UI only shows
// what a driver supports.
package driver

import (
	"context"
	"fmt"
	"net"

	"github.com/lamprabit/karotx/internal/model"
)

// DialFunc opens network connections (directly or through an SSH tunnel).
type DialFunc func(ctx context.Context, network, addr string) (net.Conn, error)

type OpenParams struct {
	Conn     model.Connection
	Password string
	Dial     DialFunc // nil = dial directly
}

type Driver interface {
	Open(ctx context.Context, p OpenParams) (Conn, error)
}

type Conn interface {
	Info() Info
	Ping(ctx context.Context) error
	// Tree lists children of the node at path (empty = root). Lazy by design.
	Tree(ctx context.Context, path []string) ([]Node, error)
	// Query runs one or more statements, returning a result per statement.
	Query(ctx context.Context, sql string, maxRows int) ([]*Result, error)
	Browse(ctx context.Context, r BrowseRequest) (*Result, error)
	// Apply runs grid edits in one transaction. With dryRun it only returns the SQL.
	Apply(ctx context.Context, r ApplyRequest, dryRun bool) ([]string, error)
	Close() error
}

type Info struct {
	Dialect       string `json:"dialect"`       // postgres | mysql | sqlite
	ServerVersion string `json:"serverVersion"` // e.g. "PostgreSQL 16.2"
	Database      string `json:"database"`
}

type Node struct {
	Name        string   `json:"name"`
	Kind        string   `json:"kind"` // database | schema | table | view | column
	Path        []string `json:"path"`
	HasChildren bool     `json:"hasChildren"`
	Detail      string   `json:"detail,omitempty"` // e.g. column type
	PrimaryKey  bool     `json:"primaryKey,omitempty"`
}

type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type Result struct {
	Statement    string   `json:"statement"`
	Columns      []Column `json:"columns,omitempty"`
	Rows         [][]any  `json:"rows,omitempty"`
	RowsAffected *int64   `json:"rowsAffected,omitempty"`
	Truncated    bool     `json:"truncated,omitempty"` // more rows exist than returned
	DurationMs   float64  `json:"durationMs"`
	PrimaryKey   []string `json:"primaryKey,omitempty"` // Browse only: enables editing
	Error        string   `json:"error,omitempty"`
}

// TableRef identifies a table. Schema is empty for SQLite.
type TableRef struct {
	Schema string `json:"schema"`
	Table  string `json:"table"`
}

type BrowseRequest struct {
	TableRef
	Offset  int    `json:"offset"`
	Limit   int    `json:"limit"`
	OrderBy string `json:"orderBy,omitempty"`
	Desc    bool   `json:"desc,omitempty"`
	Where   string `json:"where,omitempty"` // raw SQL condition typed by the user
}

type Change struct {
	Kind   string         `json:"kind"` // insert | update | delete
	Key    map[string]any `json:"key,omitempty"`
	Values map[string]any `json:"values,omitempty"`
}

type ApplyRequest struct {
	TableRef
	Changes []Change `json:"changes"`
}

var registry = map[string]Driver{}

func Register(name string, d Driver) { registry[name] = d }

func Get(name string) (Driver, error) {
	d, ok := registry[name]
	if !ok {
		return nil, fmt.Errorf("unsupported database type %q", name)
	}
	return d, nil
}
