package sqldb

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite" // pure Go, no cgo

	"github.com/lamprabit/karotx/internal/driver"
)

func init() { driver.Register("sqlite", Driver{sqlite{}}) }

type sqlite struct{}

func (sqlite) name() string           { return "sqlite" }
func (sqlite) hashComments() bool     { return false }
func (sqlite) placeholder(int) string { return "?" }
func (sqlite) quote(id string) string { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

func (sqlite) open(_ context.Context, p driver.OpenParams) (*sql.DB, error) {
	path, err := filepath.Abs(p.Conn.File)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("can't open %s: %w", path, err)
	}
	q := url.Values{"_pragma": {"foreign_keys(1)", "busy_timeout(5000)"}}
	if p.Conn.ReadOnly {
		q.Add("_pragma", "query_only(1)")
	}
	return sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?"+q.Encode())
}

func (sqlite) version(ctx context.Context, db *sql.DB) string {
	var v string
	db.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&v)
	return "SQLite " + v
}

// SQLite has no schemas in the tree; tables live under "main" so table
// references stay uniform ({schema, table}).
func (sqlite) tree(ctx context.Context, db *sql.DB, path []string) ([]driver.Node, error) {
	switch len(path) {
	case 0:
		return queryNodes(ctx, db, []string{"main"}, false, `
			SELECT name, type FROM sqlite_master
			WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\_%' ESCAPE '\'
			ORDER BY name`)
	case 2:
		return queryNodes(ctx, db, path, true,
			`SELECT name, 'column', type, pk > 0 FROM pragma_table_info(?) ORDER BY cid`, path[1])
	}
	return []driver.Node{}, nil
}
