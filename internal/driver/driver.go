// Package driver defines the contract every database driver implements:
// a small base Conn plus optional capability interfaces (SQL, KeyValue,
// Document) so each kind of database exposes what it actually supports.
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

// Conn is what every driver provides. Further capabilities are separate
// interfaces (SQL, TableLister, KeyValue, Document) that a driver's
// connection may also implement; the server type-asserts for them.
type Conn interface {
	Info() Info
	Ping(ctx context.Context) error
	// Tree lists children of the node at path (empty = root). Lazy by design.
	Tree(ctx context.Context, path []string) ([]Node, error)
	Close() error
}

// TableLister lists tables (SQL) or collections (MongoDB) with size estimates.
type TableLister interface {
	Tables(ctx context.Context, schema string) ([]TableInfo, error)
}

// SQL is implemented by relational drivers (Postgres, MySQL/MariaDB, SQLite).
type SQL interface {
	Conn
	TableLister
	// Query runs one or more statements, returning a result per statement.
	Query(ctx context.Context, sql string, opt QueryOptions) ([]*Result, error)
	// Columns describes a table's columns (for the table designer).
	Columns(ctx context.Context, t TableRef) ([]ColumnInfo, error)
	// Databases lists other databases on the same server for drivers whose
	// connection is bound to one database (Postgres); nil otherwise.
	Databases(ctx context.Context) ([]string, error)
	// ForeignKeys lists the foreign keys between tables of a schema (for join suggestions).
	ForeignKeys(ctx context.Context, schema string) ([]ForeignKey, error)
	Browse(ctx context.Context, r BrowseRequest) (*Result, error)
	// Apply runs grid edits in one transaction. With dryRun it only returns the SQL.
	Apply(ctx context.Context, r ApplyRequest, dryRun bool) ([]string, error)
}

type Info struct {
	Dialect       string `json:"dialect"`       // postgres | mysql | sqlite | redis | mongodb
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

type QueryOptions struct {
	MaxRows int
	// Schema scopes the run (MySQL: USE db; Postgres: search_path).
	Schema string
}

type TableInfo struct {
	Name  string `json:"name"`
	Kind  string `json:"kind"`            // table | view
	Rows  *int64 `json:"rows,omitempty"`  // estimate
	Bytes *int64 `json:"bytes,omitempty"` // data + indexes
}

type ColumnInfo struct {
	Name          string  `json:"name"`
	Type          string  `json:"type"`
	Nullable      bool    `json:"nullable"`
	Default       *string `json:"default"`
	PrimaryKey    bool    `json:"primaryKey"`
	AutoIncrement bool    `json:"autoIncrement"`
	// PrimaryKeyName is the PK constraint name (Postgres), needed to change the key.
	PrimaryKeyName string `json:"primaryKeyName,omitempty"`
}

// ForeignKey links Columns of Table to RefColumns of RefTable (same order).
type ForeignKey struct {
	Name       string   `json:"name"`
	Table      string   `json:"table"`
	Columns    []string `json:"columns"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
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
	// Database selects another database on the same server (Postgres); empty = the connection's own.
	Database string `json:"database,omitempty"`
	Schema   string `json:"schema"`
	Table    string `json:"table"`
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
