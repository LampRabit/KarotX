package sqldb

import (
	"context"
	"database/sql"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"

	"github.com/lamprabit/karotx/internal/driver"
)

func init() { driver.Register("clickhouse", Driver{clickhouseDialect{}}) }

// clickhouseDialect talks the native protocol (port 9000, 9440 with TLS).
// Databases play the role of schemas, as in MySQL. Rows have no unique key,
// so the grid is read-only; changes go through SQL, import or the designer.
type clickhouseDialect struct{}

func (clickhouseDialect) name() string           { return "clickhouse" }
func (clickhouseDialect) hashComments() bool     { return false }
func (clickhouseDialect) placeholder(int) string { return "?" }
func (clickhouseDialect) quote(id string) string {
	return "`" + strings.ReplaceAll(id, "`", "``") + "`"
}

func (clickhouseDialect) open(_ context.Context, p driver.OpenParams) (*sql.DB, error) {
	c := p.Conn
	port := c.Port
	if port == 0 {
		port = 9000
	}
	o := &clickhouse.Options{
		Addr:        []string{net.JoinHostPort(c.Host, strconv.Itoa(port))},
		Auth:        clickhouse.Auth{Database: c.Database, Username: c.User, Password: p.Password},
		DialTimeout: 15 * time.Second,
		Settings:    clickhouse.Settings{},
	}
	if o.Auth.Username == "" {
		o.Auth.Username = "default"
	}
	if p.Dial != nil {
		o.DialContext = func(ctx context.Context, addr string) (net.Conn, error) { return p.Dial(ctx, "tcp", addr) }
	}
	if c.TLS.Mode == "require" || c.TLS.Mode == "verify" {
		t, err := driver.TLSConfig(c.Host, c.TLS.Mode == "verify", c.TLS.CAFile, c.TLS.CertFile, c.TLS.KeyFile)
		if err != nil {
			return nil, err
		}
		o.TLS = t
	}
	if c.ReadOnly {
		o.Settings["readonly"] = 2 // reads and SET only
	}
	return clickhouse.OpenDB(o), nil
}

func (clickhouseDialect) version(ctx context.Context, db *sql.DB) string {
	var v string
	db.QueryRowContext(ctx, "SELECT version()").Scan(&v)
	return "ClickHouse " + v
}

func (clickhouseDialect) tree(ctx context.Context, db *sql.DB, path []string) ([]driver.Node, error) {
	switch len(path) {
	case 0:
		return queryNodes(ctx, db, path, false, `
			SELECT name, 'database' FROM system.databases
			WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
			ORDER BY name`)
	case 1:
		return queryNodes(ctx, db, path, false, `
			SELECT name, if(engine LIKE '%View', 'view', 'table') FROM system.tables
			WHERE database = ? AND NOT is_temporary ORDER BY name`, path[0])
	case 2:
		return queryNodes(ctx, db, path, true, `
			SELECT name, 'column', type, is_in_primary_key = 1
			FROM system.columns WHERE database = ? AND table = ? ORDER BY position`, path[0], path[1])
	}
	return []driver.Node{}, nil
}

func (d clickhouseDialect) useSchema(schema string) string { return "USE " + d.quote(schema) }

func (clickhouseDialect) tables(ctx context.Context, db *sql.DB, schema string) ([]driver.TableInfo, error) {
	return queryTables(ctx, db, `
		SELECT name, if(engine LIKE '%View', 'view', 'table'), toInt64OrNull(toString(total_rows)), toInt64OrNull(toString(total_bytes))
		FROM system.tables WHERE database = ? AND NOT is_temporary ORDER BY name`, schema)
}

func (clickhouseDialect) columns(ctx context.Context, db *sql.DB, t driver.TableRef) ([]driver.ColumnInfo, error) {
	return queryColumns(ctx, db, `
		SELECT name, type, startsWith(type, 'Nullable('),
		       if(default_kind = 'DEFAULT' AND default_expression != '', default_expression, NULL),
		       is_in_primary_key = 1, false, NULL
		FROM system.columns WHERE database = ? AND table = ? ORDER BY position`, t.Schema, t.Table)
}

func (clickhouseDialect) databases(context.Context, *sql.DB) ([]string, error) { return nil, nil }

// ClickHouse has no foreign keys.
func (clickhouseDialect) foreignKeys(ctx context.Context, db *sql.DB, _ string) (*sql.Rows, error) {
	return db.QueryContext(ctx, `SELECT '', '', '', '', '' WHERE 0`)
}
