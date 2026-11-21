// Package sqldb implements driver.Conn on top of database/sql. Each SQL
// database plugs in a small dialect (connect, quoting, catalog queries).
package sqldb

import (
	"context"
	"database/sql"
	sqldriver "database/sql/driver"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lamprabit/karotx/internal/driver"
)

type dialect interface {
	name() string
	open(ctx context.Context, p driver.OpenParams) (*sql.DB, error)
	quote(ident string) string
	placeholder(n int) string // 1-based
	hashComments() bool
	version(ctx context.Context, db *sql.DB) string
	tree(ctx context.Context, db *sql.DB, path []string) ([]driver.Node, error)
	tables(ctx context.Context, db *sql.DB, schema string) ([]driver.TableInfo, error)
	columns(ctx context.Context, db *sql.DB, t driver.TableRef) ([]driver.ColumnInfo, error)
	// useSchema returns the statement that scopes a session to schema ("" = unsupported).
	useSchema(schema string) string
	// databases lists the server's databases when a connection is bound to one (nil = not applicable).
	databases(ctx context.Context, db *sql.DB) ([]string, error)
	// foreignKeys returns rows of (constraint, table, column, ref_table, ref_column), ordered by constraint and position.
	foreignKeys(ctx context.Context, db *sql.DB, schema string) (*sql.Rows, error)
}

// Driver adapts a dialect to driver.Driver.
type Driver struct{ d dialect }

func (dr Driver) Open(ctx context.Context, p driver.OpenParams) (driver.Conn, error) {
	db, err := dr.d.open(ctx, p)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetConnMaxIdleTime(5 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	c := &conn{d: dr.d, db: db}
	c.info = driver.Info{Dialect: dr.d.name(), ServerVersion: dr.d.version(ctx, db), Database: p.Conn.Database}
	return c, nil
}

type conn struct {
	d    dialect
	db   *sql.DB
	info driver.Info
}

func (c *conn) Info() driver.Info              { return c.info }
func (c *conn) Ping(ctx context.Context) error { return c.db.PingContext(ctx) }
func (c *conn) Close() error                   { return c.db.Close() }

func (c *conn) Tree(ctx context.Context, path []string) ([]driver.Node, error) {
	return c.d.tree(ctx, c.db, path)
}

// sessionKeywords change session state; a session that ran one is not
// returned to the pool, so the state can't leak into other tabs.
var sessionKeywords = map[string]bool{"USE": true, "SET": true, "RESET": true, "BEGIN": true, "START": true, "PRAGMA": true}

// Query runs each statement in order on one session, so SET/BEGIN/temp
// tables carry over between statements. It stops at the first error.
func (c *conn) Query(ctx context.Context, src string, opt driver.QueryOptions) ([]*driver.Result, error) {
	maxRows := opt.MaxRows
	stmts := driver.SplitSQL(src, c.d.hashComments())
	if len(stmts) == 0 {
		return nil, errors.New("nothing to run")
	}
	sc, err := c.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	dirty := false
	defer func() {
		if dirty { // discard instead of returning a modified session to the pool
			sc.Raw(func(any) error { return sqldriver.ErrBadConn })
		}
		sc.Close()
	}()
	for _, s := range stmts {
		if sessionKeywords[driver.FirstKeyword(s)] || strings.Contains(strings.ToUpper(s), "TEMP") {
			dirty = true
		}
	}
	if use := c.d.useSchema(opt.Schema); opt.Schema != "" && use != "" {
		if _, err := sc.ExecContext(ctx, use); err != nil {
			return nil, err
		}
		dirty = true
	}

	var out []*driver.Result
	for _, s := range stmts {
		r := &driver.Result{Statement: s}
		out = append(out, r)
		start := time.Now()
		if driver.ReturnsRows(s) {
			err = readRows(ctx, r, maxRows, func() (*sql.Rows, error) { return sc.QueryContext(ctx, s) })
		} else {
			var res sql.Result
			if res, err = sc.ExecContext(ctx, s); err == nil {
				if n, e := res.RowsAffected(); e == nil {
					r.RowsAffected = &n
				}
			}
		}
		r.DurationMs = ms(start)
		if err != nil {
			r.Error = err.Error()
			break
		}
	}
	return out, nil
}

func (c *conn) Tables(ctx context.Context, schema string) ([]driver.TableInfo, error) {
	return c.d.tables(ctx, c.db, schema)
}

func (c *conn) Columns(ctx context.Context, t driver.TableRef) ([]driver.ColumnInfo, error) {
	return c.d.columns(ctx, c.db, t)
}

func (c *conn) Databases(ctx context.Context) ([]string, error) {
	return c.d.databases(ctx, c.db)
}

// ForeignKeys groups the dialect's (constraint, table, column, ref_table, ref_column) rows.
func (c *conn) ForeignKeys(ctx context.Context, schema string) ([]driver.ForeignKey, error) {
	rows, err := c.d.foreignKeys(ctx, c.db, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []driver.ForeignKey{}
	for rows.Next() {
		var name, table, col, refTable, refCol string
		if err := rows.Scan(&name, &table, &col, &refTable, &refCol); err != nil {
			return nil, err
		}
		if n := len(out); n > 0 && out[n-1].Name == name && out[n-1].Table == table {
			out[n-1].Columns = append(out[n-1].Columns, col)
			out[n-1].RefColumns = append(out[n-1].RefColumns, refCol)
			continue
		}
		out = append(out, driver.ForeignKey{Name: name, Table: table, Columns: []string{col}, RefTable: refTable, RefColumns: []string{refCol}})
	}
	return out, rows.Err()
}

func (c *conn) qualify(t driver.TableRef) string {
	if t.Schema == "" {
		return c.d.quote(t.Table)
	}
	return c.d.quote(t.Schema) + "." + c.d.quote(t.Table)
}

func (c *conn) primaryKey(ctx context.Context, t driver.TableRef) ([]string, error) {
	cols, err := c.d.tree(ctx, c.db, []string{t.Schema, t.Table})
	if err != nil {
		return nil, err
	}
	var pk []string
	for _, col := range cols {
		if col.PrimaryKey {
			pk = append(pk, col.Name)
		}
	}
	return pk, nil
}

func (c *conn) Browse(ctx context.Context, b driver.BrowseRequest) (*driver.Result, error) {
	if b.Limit <= 0 || b.Limit > 1000 {
		b.Limit = 200
	}
	var q strings.Builder
	fmt.Fprintf(&q, "SELECT * FROM %s", c.qualify(b.TableRef))
	if w := strings.TrimSpace(b.Where); w != "" {
		fmt.Fprintf(&q, " WHERE (%s)", w)
	}
	if b.OrderBy != "" {
		dir := "ASC"
		if b.Desc {
			dir = "DESC"
		}
		fmt.Fprintf(&q, " ORDER BY %s %s", c.d.quote(b.OrderBy), dir)
	}
	fmt.Fprintf(&q, " LIMIT %d OFFSET %d", b.Limit+1, max(b.Offset, 0)) // +1 detects a next page

	r := &driver.Result{Statement: q.String()}
	start := time.Now()
	if err := readRows(ctx, r, b.Limit, func() (*sql.Rows, error) { return c.db.QueryContext(ctx, q.String()) }); err != nil {
		return nil, err
	}
	r.DurationMs = ms(start)
	pk, err := c.primaryKey(ctx, b.TableRef)
	if err != nil {
		return nil, err
	}
	r.PrimaryKey = pk
	return r, nil
}

func (c *conn) Apply(ctx context.Context, a driver.ApplyRequest, dryRun bool) ([]string, error) {
	type stmt struct {
		sql     string
		args    []any
		mustHit bool
	}
	var stmts []stmt
	table := c.qualify(a.TableRef)
	for _, ch := range a.Changes {
		var b strings.Builder
		var args []any
		ph := func(v any) string { args = append(args, v); return c.d.placeholder(len(args)) }
		where := func() error {
			if len(ch.Key) == 0 {
				return errors.New("this table has no primary key, so rows can't be safely edited")
			}
			b.WriteString(" WHERE ")
			for i, k := range sortedKeys(ch.Key) {
				if i > 0 {
					b.WriteString(" AND ")
				}
				if ch.Key[k] == nil {
					fmt.Fprintf(&b, "%s IS NULL", c.d.quote(k))
				} else {
					fmt.Fprintf(&b, "%s = %s", c.d.quote(k), ph(ch.Key[k]))
				}
			}
			return nil
		}
		switch ch.Kind {
		case "update":
			if len(ch.Values) == 0 {
				continue
			}
			fmt.Fprintf(&b, "UPDATE %s SET ", table)
			for i, k := range sortedKeys(ch.Values) {
				if i > 0 {
					b.WriteString(", ")
				}
				fmt.Fprintf(&b, "%s = %s", c.d.quote(k), ph(ch.Values[k]))
			}
			if err := where(); err != nil {
				return nil, err
			}
		case "delete":
			fmt.Fprintf(&b, "DELETE FROM %s", table)
			if err := where(); err != nil {
				return nil, err
			}
		case "insert":
			keys := sortedKeys(ch.Values)
			cols, vals := make([]string, len(keys)), make([]string, len(keys))
			for i, k := range keys {
				cols[i], vals[i] = c.d.quote(k), ph(ch.Values[k])
			}
			if len(keys) == 0 {
				fmt.Fprintf(&b, "INSERT INTO %s DEFAULT VALUES", table)
			} else {
				fmt.Fprintf(&b, "INSERT INTO %s (%s) VALUES (%s)", table, strings.Join(cols, ", "), strings.Join(vals, ", "))
			}
		default:
			return nil, fmt.Errorf("unknown change %q", ch.Kind)
		}
		stmts = append(stmts, stmt{b.String(), args, ch.Kind != "insert"})
	}

	preview := make([]string, len(stmts))
	for i, s := range stmts {
		preview[i] = c.render(s.sql, s.args)
	}
	if dryRun {
		return preview, nil
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for i, s := range stmts {
		res, err := tx.ExecContext(ctx, s.sql, s.args...)
		if err != nil {
			return nil, fmt.Errorf("%s\n→ %w", preview[i], err)
		}
		if n, _ := res.RowsAffected(); s.mustHit && n == 0 {
			return nil, fmt.Errorf("%s\n→ no row matched; it may have been changed or deleted by someone else. Nothing was saved", preview[i])
		}
	}
	return preview, tx.Commit()
}

// render inlines args for display only; execution always uses parameters.
// Single pass, so literal values are never re-substituted.
func (c *conn) render(q string, args []any) string {
	var b strings.Builder
	next := 0
	for i := 0; i < len(q); i++ {
		switch {
		case q[i] == '?' && next < len(args):
			b.WriteString(literal(args[next]))
			next++
		case q[i] == '$' && i+1 < len(q) && q[i+1] >= '0' && q[i+1] <= '9':
			j := i + 1
			for j < len(q) && q[j] >= '0' && q[j] <= '9' {
				j++
			}
			n, _ := strconv.Atoi(q[i+1 : j])
			if n >= 1 && n <= len(args) {
				b.WriteString(literal(args[n-1]))
				i = j - 1
				continue
			}
			b.WriteByte(q[i])
		default:
			b.WriteByte(q[i])
		}
	}
	return b.String()
}

func literal(v any) string {
	switch x := v.(type) {
	case nil:
		return "NULL"
	case string:
		return "'" + strings.ReplaceAll(x, "'", "''") + "'"
	case bool:
		if x {
			return "TRUE"
		}
		return "FALSE"
	default:
		return fmt.Sprint(x)
	}
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func readRows(ctx context.Context, r *driver.Result, maxRows int, query func() (*sql.Rows, error)) error {
	if maxRows <= 0 {
		maxRows = 1000
	}
	rows, err := query()
	if err != nil {
		return err
	}
	defer rows.Close()
	types, err := rows.ColumnTypes()
	if err != nil {
		return err
	}
	r.Columns = make([]driver.Column, len(types))
	for i, t := range types {
		r.Columns[i] = driver.Column{Name: t.Name(), Type: strings.ToLower(t.DatabaseTypeName())}
	}
	r.Rows = [][]any{}
	for rows.Next() {
		if len(r.Rows) == maxRows {
			r.Truncated = true
			break
		}
		vals := make([]any, len(types))
		ptrs := make([]any, len(types))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		for i, v := range vals {
			vals[i] = jsonValue(v)
		}
		r.Rows = append(r.Rows, vals)
	}
	return rows.Err()
}

const maxSafeInt = 1<<53 - 1

// jsonValue converts driver values to something JSON (and JavaScript) can
// represent without losing information.
func jsonValue(v any) any {
	switch x := v.(type) {
	case []byte:
		if utf8.Valid(x) {
			return string(x)
		}
		return `\x` + hex.EncodeToString(x)
	case time.Time:
		return x.Format("2006-01-02 15:04:05.999999999Z07:00")
	case int64:
		if x > maxSafeInt || x < -maxSafeInt {
			return strconv.FormatInt(x, 10)
		}
	case uint64:
		if x > maxSafeInt {
			return strconv.FormatUint(x, 10)
		}
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return strconv.FormatFloat(x, 'g', -1, 64)
		}
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:16])
	}
	return v
}

func ms(start time.Time) float64 {
	return float64(time.Since(start).Microseconds()) / 1000
}

// queryNodes runs a catalog query whose rows are (name, kind[, detail[, pk]]).
func queryNodes(ctx context.Context, db *sql.DB, parent []string, leaf bool, q string, args ...any) ([]driver.Node, error) {
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	nodes := []driver.Node{}
	for rows.Next() {
		var n driver.Node
		var detail sql.NullString
		var pk sql.NullBool
		dest := []any{&n.Name, &n.Kind, &detail, &pk}[:len(cols)]
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		n.Detail, n.PrimaryKey = detail.String, pk.Bool
		n.Path = append(append([]string{}, parent...), n.Name)
		n.HasChildren = !leaf
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

func queryTables(ctx context.Context, db *sql.DB, q string, args ...any) ([]driver.TableInfo, error) {
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []driver.TableInfo{}
	for rows.Next() {
		var t driver.TableInfo
		var n, b sql.NullInt64
		if err := rows.Scan(&t.Name, &t.Kind, &n, &b); err != nil {
			return nil, err
		}
		if n.Valid {
			t.Rows = &n.Int64
		}
		if b.Valid {
			t.Bytes = &b.Int64
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func queryColumns(ctx context.Context, db *sql.DB, q string, args ...any) ([]driver.ColumnInfo, error) {
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []driver.ColumnInfo{}
	for rows.Next() {
		var c driver.ColumnInfo
		var def, pkName sql.NullString
		if err := rows.Scan(&c.Name, &c.Type, &c.Nullable, &def, &c.PrimaryKey, &c.AutoIncrement, &pkName); err != nil {
			return nil, err
		}
		if def.Valid {
			c.Default = &def.String
		}
		if c.PrimaryKey {
			c.PrimaryKeyName = pkName.String
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
