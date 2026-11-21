package sqldb

import (
	"context"
	"database/sql"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/lamprabit/karotx/internal/driver"
)

func init() { driver.Register("postgres", Driver{postgres{}}) }

type postgres struct{}

func (postgres) name() string             { return "postgres" }
func (postgres) hashComments() bool       { return false }
func (postgres) placeholder(n int) string { return "$" + strconv.Itoa(n) }
func (postgres) quote(id string) string   { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

var pgSSLMode = map[string]string{"": "prefer", "off": "disable", "prefer": "prefer", "require": "require", "verify": "verify-full"}

func (postgres) open(_ context.Context, p driver.OpenParams) (*sql.DB, error) {
	c := p.Conn
	port := c.Port
	if port == 0 {
		port = 5432
	}
	q := url.Values{"sslmode": {pgSSLMode[c.TLS.Mode]}, "application_name": {"KarotX"}, "connect_timeout": {"15"}}
	if c.TLS.CAFile != "" {
		q.Set("sslrootcert", c.TLS.CAFile)
	}
	if c.TLS.CertFile != "" {
		q.Set("sslcert", c.TLS.CertFile)
		q.Set("sslkey", c.TLS.KeyFile)
	}
	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(c.User, p.Password),
		Host:     net.JoinHostPort(c.Host, strconv.Itoa(port)),
		Path:     "/" + c.Database,
		RawQuery: q.Encode(),
	}
	cfg, err := pgx.ParseConfig(u.String())
	if err != nil {
		return nil, err
	}
	if p.Dial != nil {
		cfg.DialFunc = pgconn.DialFunc(p.Dial)
		cfg.LookupFunc = func(_ context.Context, host string) ([]string, error) { return []string{host}, nil } // resolve on the SSH side
	}
	if c.ReadOnly {
		cfg.RuntimeParams["default_transaction_read_only"] = "on"
	}
	return stdlib.OpenDB(*cfg), nil
}

func (postgres) version(ctx context.Context, db *sql.DB) string {
	var v string
	db.QueryRowContext(ctx, "SELECT current_setting('server_version')").Scan(&v)
	if i := strings.IndexByte(v, ' '); i > 0 {
		v = v[:i]
	}
	return "PostgreSQL " + v
}

func (postgres) tree(ctx context.Context, db *sql.DB, path []string) ([]driver.Node, error) {
	switch len(path) {
	case 0:
		return queryNodes(ctx, db, path, false, `
			SELECT nspname, 'schema' FROM pg_namespace
			WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
			ORDER BY nspname <> 'public', nspname`)
	case 1:
		return queryNodes(ctx, db, path, false, `
			SELECT c.relname, CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m','f') AND NOT c.relispartition
			ORDER BY c.relname`, path[0])
	case 2:
		return queryNodes(ctx, db, path, true, `
			SELECT a.attname, 'column', format_type(a.atttypid, a.atttypmod),
			       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey))
			FROM pg_attribute a
			JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
			ORDER BY a.attnum`, path[0], path[1])
	}
	return []driver.Node{}, nil
}

func (p postgres) useSchema(schema string) string {
	return "SET search_path TO " + p.quote(schema) + ", public"
}

func (postgres) tables(ctx context.Context, db *sql.DB, schema string) ([]driver.TableInfo, error) {
	return queryTables(ctx, db, `
		SELECT c.relname, CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END,
		       CASE WHEN c.relkind = 'v' OR c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END,
		       CASE WHEN c.relkind = 'v' THEN NULL ELSE pg_total_relation_size(c.oid) END
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m','f') AND NOT c.relispartition
		ORDER BY c.relname`, schema)
}

func (postgres) columns(ctx context.Context, db *sql.DB, t driver.TableRef) ([]driver.ColumnInfo, error) {
	return queryColumns(ctx, db, `
		SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
		       pg_get_expr(d.adbin, d.adrelid),
		       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)),
		       a.attidentity <> '' OR COALESCE(pg_get_expr(d.adbin, d.adrelid), '') LIKE 'nextval(%',
		       (SELECT conname FROM pg_constraint WHERE conrelid = c.oid AND contype = 'p')
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum`, t.Schema, t.Table)
}

func (postgres) databases(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
