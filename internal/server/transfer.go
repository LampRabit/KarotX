package server

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/lamprabit/karotx/internal/driver"
)

func (s *Server) routeTransfer(api *http.ServeMux) {
	a := s.authed
	api.HandleFunc("POST /api/connections/{id}/export", a(s.export))
	api.HandleFunc("POST /api/connections/{id}/import/rows", a(s.importRows))
	api.HandleFunc("POST /api/connections/{id}/import/script", a(s.importScript))
	api.HandleFunc("POST /api/connections/{id}/redis/import", a(s.redisImport))
}

// exportSpec describes what to export. Schema/Table double as MongoDB
// database/collection; DB is the Redis database number.
type exportSpec struct {
	Source   string `json:"source"` // table | query | database | redis
	Format   string `json:"format"` // csv | json | jsonl | sql | zip
	Database string `json:"database"`
	Schema   string `json:"schema"`
	Table    string `json:"table"`
	Where    string `json:"where"`
	OrderBy  string `json:"orderBy"`
	Desc     bool   `json:"desc"`
	SQL      string `json:"sql"`
	// SQL output: table name for INSERTs of a query result; dump options.
	InsertTable string   `json:"insertTable"`
	DDL         bool     `json:"ddl"`
	Data        bool     `json:"data"`
	Drop        bool     `json:"drop"`
	Tables      []string `json:"tables"` // dump subset; empty = all
	// CSV options.
	Delimiter string `json:"delimiter"`
	Header    bool   `json:"header"`
	Null      string `json:"null"`
	// MongoDB.
	Filter json.RawMessage `json:"filter"`
	Sort   json.RawMessage `json:"sort"`
	// Redis.
	DB      int    `json:"db"`
	Pattern string `json:"pattern"`
	Type    string `json:"type"`

	connName string // for the dump header
}

// lazyWriter sends the 200 header on the first write, so an error found
// before any output still becomes a normal JSON error response.
type lazyWriter struct {
	w       http.ResponseWriter
	ct      string
	started bool
}

func (l *lazyWriter) Write(p []byte) (int, error) {
	if !l.started {
		l.started = true
		l.w.Header().Set("Content-Type", l.ct)
		l.w.Header().Set("X-Content-Type-Options", "nosniff")
		l.w.WriteHeader(http.StatusOK)
	}
	return l.w.Write(p)
}

var mimes = map[string]string{
	"csv": "text/csv; charset=utf-8", "json": "application/json", "jsonl": "application/x-ndjson",
	"sql": "application/sql; charset=utf-8", "zip": "application/zip",
}

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	var sp exportSpec
	if !readJSON(w, r, &sp) {
		return
	}
	ct, ok := mimes[sp.Format]
	if !ok {
		writeErr(w, http.StatusBadRequest, "unknown export format "+strconv.Quote(sp.Format))
		return
	}
	c, err := s.opt.Conns.SessionDB(r.Context(), r.PathValue("id"), sp.Database)
	if err != nil {
		connErr(w, err)
		return
	}
	sp.connName = s.connConfig(r.PathValue("id")).Name
	lw := &lazyWriter{w: w, ct: ct}
	out := bufio.NewWriterSize(lw, 64<<10)
	ctx := r.Context()
	switch c := c.(type) {
	case driver.SQL:
		tr, _ := c.(driver.Transfer)
		err = exportSQL(ctx, c, tr, sp, out)
	case driver.Document:
		err = exportDocs(ctx, c, sp, out)
	case driver.KeyValue:
		err = exportKeys(ctx, c, sp, out)
	default:
		err = errors.New("export isn't available for this database")
	}
	if err == nil {
		err = out.Flush()
	}
	if err != nil {
		if !lw.started {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		panic(http.ErrAbortHandler) // mid-stream: abort so the download fails instead of looking complete
	}
}

// ---- SQL ----

func exportSQL(ctx context.Context, c driver.SQL, tr driver.Transfer, sp exportSpec, w io.Writer) error {
	if tr == nil {
		return errors.New("export isn't available for this database")
	}
	qualified := func(t string) string {
		if sp.Schema == "" {
			return tr.Quote(t)
		}
		return tr.Quote(sp.Schema) + "." + tr.Quote(t)
	}
	switch sp.Source {
	case "table":
		q := "SELECT * FROM " + qualified(sp.Table)
		if w := strings.TrimSpace(sp.Where); w != "" {
			q += " WHERE (" + w + ")"
		}
		if sp.OrderBy != "" {
			q += " ORDER BY " + tr.Quote(sp.OrderBy)
			if sp.Desc {
				q += " DESC"
			}
		}
		return streamRows(ctx, tr, q, sp.Schema, newRowWriter(sp, w, tr, sp.Table))
	case "query":
		stmts := driver.SplitSQL(sp.SQL, c.Info().Dialect == "mysql")
		if len(stmts) != 1 || !driver.ReturnsRows(stmts[0]) {
			return errors.New("only a single statement that returns rows can be exported")
		}
		name := sp.InsertTable
		if name == "" {
			name = "query_result"
		}
		return streamRows(ctx, tr, stmts[0], sp.Schema, newRowWriter(sp, w, tr, name))
	case "database":
		if sp.Format != "sql" {
			return errors.New("databases export as SQL")
		}
		return dumpSQL(ctx, c, tr, sp, w, qualified)
	}
	return fmt.Errorf("unknown export source %q", sp.Source)
}

func streamRows(ctx context.Context, tr driver.Transfer, query, schema string, rw rowWriter) error {
	if err := tr.StreamRows(ctx, query, schema, rw.head, rw.row); err != nil {
		return err
	}
	return rw.close()
}

// dumpSQL writes CREATE TABLE and INSERT statements for a schema's tables,
// ordered so referenced tables come first.
func dumpSQL(ctx context.Context, c driver.SQL, tr driver.Transfer, sp exportSpec, w io.Writer, qualified func(string) string) error {
	tables, err := c.Tables(ctx, sp.Schema)
	if err != nil {
		return err
	}
	want := map[string]bool{}
	for _, t := range sp.Tables {
		want[t] = true
	}
	var names []string
	for _, t := range tables {
		if t.Kind == "table" && (len(want) == 0 || want[t.Name]) {
			names = append(names, t.Name)
		}
	}
	if len(names) == 0 {
		return errors.New("there are no tables to export")
	}
	fks, _ := c.ForeignKeys(ctx, sp.Schema)
	names = fkOrder(names, fks)
	dialect := c.Info().Dialect

	label := sp.Schema
	if label == "" || dialect == "sqlite" {
		label = sp.connName
	}
	fmt.Fprintf(w, "-- KarotX export of %s (%s), %s\n-- Tables: %d\n\n", label, dialect, time.Now().UTC().Format(time.RFC3339), len(names))
	switch dialect {
	case "mysql":
		io.WriteString(w, "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n")
	case "sqlite":
		io.WriteString(w, "PRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n\n")
	default:
		io.WriteString(w, "BEGIN;\n\n")
	}
	for _, t := range names {
		ref := driver.TableRef{Database: sp.Database, Schema: sp.Schema, Table: t}
		fmt.Fprintf(w, "-- Table %s\n", t)
		if sp.Drop {
			cascade := ""
			if dialect == "postgres" {
				cascade = " CASCADE"
			}
			fmt.Fprintf(w, "DROP TABLE IF EXISTS %s%s;\n", tr.Quote(t), cascade)
		}
		if sp.DDL {
			ddl, err := tr.CreateTableSQL(ctx, ref)
			if err != nil {
				return fmt.Errorf("%s: %w", t, err)
			}
			fmt.Fprintf(w, "%s;\n", ddl)
		}
		if sp.Data {
			if err := streamRows(ctx, tr, "SELECT * FROM "+qualified(t), sp.Schema, &sqlRows{w: w, tr: tr, table: t}); err != nil {
				return fmt.Errorf("%s: %w", t, err)
			}
			if dialect == "postgres" {
				// Explicit ids don't advance identity sequences; move them past the data.
				cols, _ := c.Columns(ctx, ref)
				for _, col := range cols {
					if col.AutoIncrement {
						fmt.Fprintf(w, "SELECT setval(pg_get_serial_sequence(%s, %s), COALESCE(MAX(%s), 0) + 1, false) FROM %s;\n",
							tr.Literal(tr.Quote(t)), tr.Literal(col.Name), tr.Quote(col.Name), tr.Quote(t))
					}
				}
			}
		}
		io.WriteString(w, "\n")
	}
	if dialect == "postgres" && sp.DDL {
		in := map[string]bool{}
		for _, n := range names {
			in[n] = true
		}
		for _, fk := range fks {
			if in[fk.Table] && in[fk.RefTable] {
				fmt.Fprintf(w, "ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s);\n",
					tr.Quote(fk.Table), tr.Quote(fk.Name), quoteList(tr, fk.Columns), tr.Quote(fk.RefTable), quoteList(tr, fk.RefColumns))
			}
		}
	}
	switch dialect {
	case "mysql":
		io.WriteString(w, "SET FOREIGN_KEY_CHECKS = 1;\n")
	default:
		io.WriteString(w, "COMMIT;\n")
	}
	return nil
}

func quoteList(tr driver.Transfer, cols []string) string {
	q := make([]string, len(cols))
	for i, c := range cols {
		q[i] = tr.Quote(c)
	}
	return strings.Join(q, ", ")
}

// fkOrder sorts tables so each comes after the tables it references
// (alphabetical otherwise). Cycles keep their alphabetical order at the end.
func fkOrder(names []string, fks []driver.ForeignKey) []string {
	sort.Strings(names)
	deps := map[string]map[string]bool{}
	for _, fk := range fks {
		if fk.Table != fk.RefTable {
			if deps[fk.Table] == nil {
				deps[fk.Table] = map[string]bool{}
			}
			deps[fk.Table][fk.RefTable] = true
		}
	}
	in := map[string]bool{}
	for _, n := range names {
		in[n] = true
	}
	done := map[string]bool{}
	var out []string
	for len(out) < len(names) {
		progressed := false
		for _, n := range names {
			if done[n] {
				continue
			}
			ready := true
			for d := range deps[n] {
				if in[d] && !done[d] {
					ready = false
					break
				}
			}
			if ready {
				done[n], progressed = true, true
				out = append(out, n)
			}
		}
		if !progressed { // a cycle: emit the rest as they are
			for _, n := range names {
				if !done[n] {
					done[n] = true
					out = append(out, n)
				}
			}
		}
	}
	return out
}

// ---- row writers ----

type rowWriter interface {
	head([]driver.Column) error
	row([]any) error
	close() error
}

func newRowWriter(sp exportSpec, w io.Writer, tr driver.Transfer, table string) rowWriter {
	switch sp.Format {
	case "csv":
		cw := csv.NewWriter(w)
		if d := []rune(sp.Delimiter); len(d) == 1 {
			cw.Comma = d[0]
		}
		return &csvRows{w: cw, header: sp.Header, null: sp.Null}
	case "sql":
		return &sqlRows{w: w, tr: tr, table: table}
	default:
		return &jsonRows{w: w, lines: sp.Format == "jsonl"}
	}
}

type csvRows struct {
	w      *csv.Writer
	header bool
	null   string
	buf    []string
}

func (c *csvRows) head(cols []driver.Column) error {
	c.buf = make([]string, len(cols))
	if !c.header {
		return nil
	}
	for i, col := range cols {
		c.buf[i] = col.Name
	}
	return c.w.Write(c.buf)
}

func (c *csvRows) row(vals []any) error {
	for i, v := range vals {
		c.buf[i] = cellText(v, c.null)
	}
	return c.w.Write(c.buf)
}

func (c *csvRows) close() error { c.w.Flush(); return c.w.Error() }

func cellText(v any, null string) string {
	switch x := v.(type) {
	case nil:
		return null
	case string:
		return x
	case []byte:
		return `\x` + hex.EncodeToString(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case map[string]any, []any:
		return string(jsonBytes(x))
	}
	return fmt.Sprint(v)
}

type jsonRows struct {
	w       io.Writer
	lines   bool
	names   [][]byte
	numeric []bool
	n       int
	buf     bytes.Buffer
}

func (j *jsonRows) head(cols []driver.Column) error {
	j.names, j.numeric = make([][]byte, len(cols)), make([]bool, len(cols))
	for i, c := range cols {
		j.names[i] = jsonBytes(c.Name)
		j.numeric[i] = numericType(c.Type)
	}
	return nil
}

func (j *jsonRows) row(vals []any) error {
	j.buf.Reset()
	if !j.lines {
		if j.n == 0 {
			j.buf.WriteString("[\n")
		} else {
			j.buf.WriteString(",\n")
		}
	}
	j.n++
	j.buf.WriteByte('{')
	for i, v := range vals {
		if i > 0 {
			j.buf.WriteByte(',')
		}
		j.buf.Write(j.names[i])
		j.buf.WriteByte(':')
		switch x := v.(type) {
		case string:
			if j.numeric[i] && isNumber(x) { // MySQL sends numbers as text
				j.buf.WriteString(x)
			} else {
				j.buf.Write(jsonBytes(x))
			}
		case []byte:
			j.buf.Write(jsonBytes(`\x` + hex.EncodeToString(x)))
		default:
			j.buf.Write(jsonBytes(x))
		}
	}
	j.buf.WriteByte('}')
	if j.lines {
		j.buf.WriteByte('\n')
	}
	_, err := j.w.Write(j.buf.Bytes())
	return err
}

func (j *jsonRows) close() error {
	if j.lines {
		return nil
	}
	if j.n == 0 {
		_, err := io.WriteString(j.w, "[]\n")
		return err
	}
	_, err := io.WriteString(j.w, "\n]\n")
	return err
}

// sqlRows writes multi-row INSERT statements, 100 rows each.
type sqlRows struct {
	w       io.Writer
	tr      driver.Transfer
	table   string
	cols    string
	pending []string
	buf     []string
}

func (s *sqlRows) head(cols []driver.Column) error {
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = c.Name
	}
	s.cols = quoteList(s.tr, names)
	s.buf = make([]string, len(cols))
	return nil
}

func (s *sqlRows) row(vals []any) error {
	for i, v := range vals {
		s.buf[i] = s.tr.Literal(v)
	}
	s.pending = append(s.pending, "("+strings.Join(s.buf, ", ")+")")
	if len(s.pending) == 100 {
		return s.flush()
	}
	return nil
}

func (s *sqlRows) flush() error {
	if len(s.pending) == 0 {
		return nil
	}
	_, err := fmt.Fprintf(s.w, "INSERT INTO %s (%s) VALUES\n  %s;\n", s.tr.Quote(s.table), s.cols, strings.Join(s.pending, ",\n  "))
	s.pending = s.pending[:0]
	return err
}

func (s *sqlRows) close() error { return s.flush() }

func jsonBytes(v any) []byte {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if e.Encode(v) != nil {
		return []byte("null")
	}
	return bytes.TrimRight(b.Bytes(), "\n")
}

func numericType(t string) bool {
	t = strings.TrimPrefix(strings.TrimSpace(t), "unsigned ")
	for _, p := range []string{"int", "tinyint", "smallint", "mediumint", "bigint", "integer", "decimal", "numeric", "float", "double", "real"} {
		if t == p || strings.HasPrefix(t, p+"(") || (strings.HasPrefix(t, p) && len(t) == len(p)+1 && t[len(p)] >= '0' && t[len(p)] <= '9') {
			return true
		}
	}
	return false
}

func isNumber(s string) bool {
	return s != "" && (s[0] == '-' || (s[0] >= '0' && s[0] <= '9')) && json.Valid([]byte(s))
}

// ---- MongoDB ----

func exportDocs(ctx context.Context, d driver.Document, sp exportSpec, w io.Writer) error {
	if sp.Source == "database" {
		return exportMongoDatabase(ctx, d, sp.Schema, w)
	}
	q := driver.FindRequest{Filter: sp.Filter, Sort: sp.Sort}
	switch sp.Format {
	case "json", "jsonl":
		n := 0
		err := d.Each(ctx, sp.Schema, sp.Table, q, func(doc json.RawMessage) error {
			var err error
			switch {
			case sp.Format == "jsonl":
				_, err = fmt.Fprintf(w, "%s\n", doc)
			case n == 0:
				_, err = fmt.Fprintf(w, "[\n%s", doc)
			default:
				_, err = fmt.Fprintf(w, ",\n%s", doc)
			}
			n++
			return err
		})
		if err == nil && sp.Format == "json" {
			if n == 0 {
				_, err = io.WriteString(w, "[]\n")
			} else {
				_, err = io.WriteString(w, "\n]\n")
			}
		}
		return err
	case "csv":
		fields, err := d.Fields(ctx, sp.Schema, sp.Table)
		if err != nil {
			return err
		}
		var cols []driver.Column
		for _, f := range fields {
			if !strings.Contains(f.Path, ".") {
				cols = append(cols, driver.Column{Name: f.Path})
			}
		}
		cw := &csvRows{w: csv.NewWriter(w), header: sp.Header, null: sp.Null}
		if dl := []rune(sp.Delimiter); len(dl) == 1 {
			cw.w.Comma = dl[0]
		}
		if err := cw.head(cols); err != nil {
			return err
		}
		vals := make([]any, len(cols))
		err = d.Each(ctx, sp.Schema, sp.Table, q, func(doc json.RawMessage) error {
			var m map[string]any
			dec := json.NewDecoder(bytes.NewReader(doc))
			dec.UseNumber()
			if err := dec.Decode(&m); err != nil {
				return err
			}
			for i, c := range cols {
				vals[i] = mongoCell(m[c.Name])
			}
			return cw.row(vals)
		})
		if err != nil {
			return err
		}
		return cw.close()
	}
	return fmt.Errorf("collections export as JSON, JSON Lines or CSV")
}

// mongoCell flattens Extended JSON wrappers ({"$oid": …}, {"$date": …}) to plain text for CSV.
func mongoCell(v any) any {
	m, ok := v.(map[string]any)
	if !ok || len(m) != 1 {
		return v
	}
	for k, x := range m {
		switch k {
		case "$oid", "$numberDecimal", "$numberLong", "$numberDouble", "$numberInt", "$symbol":
			return x
		case "$date":
			if inner, ok := x.(map[string]any); ok {
				if n, ok := inner["$numberLong"]; ok {
					return n
				}
			}
			return x
		}
	}
	return v
}

// exportMongoDatabase writes a zip with one JSON Lines file per collection (mongoimport-compatible).
func exportMongoDatabase(ctx context.Context, d driver.Document, db string, w io.Writer) error {
	colls, err := d.Tables(ctx, db)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(w)
	n := 0
	for _, c := range colls {
		if c.Kind != "table" {
			continue
		}
		f, err := zw.Create(c.Name + ".json")
		if err != nil {
			return err
		}
		n++
		if err := d.Each(ctx, db, c.Name, driver.FindRequest{}, func(doc json.RawMessage) error {
			_, err := fmt.Fprintf(f, "%s\n", doc)
			return err
		}); err != nil {
			return fmt.Errorf("%s: %w", c.Name, err)
		}
	}
	if n == 0 {
		return errors.New("there are no collections to export")
	}
	return zw.Close()
}

// ---- Redis ----

func exportKeys(ctx context.Context, kv driver.KeyValue, sp exportSpec, w io.Writer) error {
	pattern := sp.Pattern
	if pattern == "" {
		pattern = "*"
	}
	n := 0
	cursor := "0"
	for {
		page, err := kv.Scan(ctx, sp.DB, pattern, cursor, 1000, sp.Type)
		if err != nil {
			return err
		}
		for _, k := range page.Keys {
			d, err := kv.Dump(ctx, sp.DB, k.Key)
			if err != nil {
				continue // expired between scan and read
			}
			sep := ",\n"
			if n == 0 {
				sep = "[\n"
			}
			n++
			if _, err := fmt.Fprintf(w, "%s%s", sep, jsonBytes(d)); err != nil {
				return err
			}
		}
		if cursor = page.Cursor; cursor == "0" {
			break
		}
	}
	if n == 0 {
		_, err := io.WriteString(w, "[]\n")
		return err
	}
	_, err := io.WriteString(w, "\n]\n")
	return err
}

// ---- import ----

// readBig decodes a large JSON body (import batches), keeping numbers exact.
func readBig(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeErr(w, http.StatusUnsupportedMediaType, "expected application/json")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<20))
	dec.UseNumber()
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

func (s *Server) importRows(w http.ResponseWriter, r *http.Request) {
	var b struct {
		driver.TableRef
		Columns   []string `json:"columns"`
		Rows      [][]any  `json:"rows"`
		Clear     bool     `json:"clear"` // delete existing rows first (same transaction)
		Confirmed bool     `json:"confirmed"`
	}
	if !readBig(w, r, &b) {
		return
	}
	id := r.PathValue("id")
	if b.Clear && !s.guard(w, id, b.Confirmed, []string{"DELETE FROM " + b.Table + " (empty the table before importing)"}) {
		return
	}
	c, err := s.opt.Conns.SessionDB(r.Context(), id, b.Database)
	if err != nil {
		connErr(w, err)
		return
	}
	tr, ok := c.(driver.Transfer)
	if !ok {
		writeErr(w, http.StatusBadRequest, "import isn't available for this database")
		return
	}
	for _, row := range b.Rows {
		for i, v := range row {
			if n, ok := v.(json.Number); ok {
				row[i] = n.String()
			}
		}
	}
	n, err := tr.InsertRows(r.Context(), b.TableRef, b.Columns, b.Rows, b.Clear)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]int64{"inserted": n})
}

// importScript runs an uploaded .sql file, streaming progress as JSON lines.
func (s *Server) importScript(w http.ResponseWriter, r *http.Request) {
	// A non-form content type means browsers must preflight cross-site requests (CSRF).
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/sql") {
		writeErr(w, http.StatusUnsupportedMediaType, "expected application/sql")
		return
	}
	q := r.URL.Query()
	id := r.PathValue("id")
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 512<<20))
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "the file is too large (512 MB at most)")
		return
	}
	script := string(body)
	var risky []string
	for _, st := range driver.SplitSQL(script, true) {
		if driver.IsDestructive(st) {
			if len(risky) == 20 {
				risky = append(risky, "… and more")
				break
			}
			risky = append(risky, st)
		}
	}
	if !s.guard(w, id, q.Get("confirmed") == "1", risky) {
		return
	}
	c, err := s.opt.Conns.SessionDB(r.Context(), id, q.Get("database"))
	if err != nil {
		connErr(w, err)
		return
	}
	tr, ok := c.(driver.Transfer)
	if !ok {
		writeErr(w, http.StatusBadRequest, "running SQL files isn't available for this database")
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	enc := json.NewEncoder(w)
	flush := func() {
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	type line struct {
		Done      int    `json:"done"`
		Total     int    `json:"total"`
		Error     string `json:"error,omitempty"`
		Statement string `json:"statement,omitempty"`
		Finished  bool   `json:"finished,omitempty"`
		Failed    int    `json:"failed,omitempty"`
	}
	last, failed, done, total := time.Time{}, 0, 0, 0
	err = tr.ExecScript(r.Context(), script, q.Get("schema"), q.Get("continue") == "1", func(d, t int, err error, stmt string) {
		done, total = d, t
		if err != nil {
			failed++
			if len(stmt) > 500 {
				stmt = stmt[:500] + "…"
			}
			enc.Encode(line{Done: d, Total: t, Error: err.Error(), Statement: stmt})
			flush()
		} else if time.Since(last) > 150*time.Millisecond {
			last = time.Now()
			enc.Encode(line{Done: d, Total: t})
			flush()
		}
	})
	end := line{Done: done, Total: total, Finished: true, Failed: failed}
	if err != nil && failed == 0 {
		end.Error = err.Error() // failed before any statement ran (e.g. empty file)
	}
	enc.Encode(end)
}

func (s *Server) redisImport(w http.ResponseWriter, r *http.Request) {
	var b struct {
		DB        int              `json:"db"`
		Items     []driver.KeyData `json:"items"`
		Replace   bool             `json:"replace"`
		Confirmed bool             `json:"confirmed"`
	}
	if !readBig(w, r, &b) {
		return
	}
	for i := range b.Items {
		b.Items[i].Value = plainNumbers(b.Items[i].Value)
	}
	if !s.writeGuard(w, r, b.Confirmed, true, fmt.Sprintf("Write %d keys into db%d", len(b.Items), b.DB)) {
		return
	}
	c, err := s.opt.Conns.Session(r.Context(), r.PathValue("id"))
	if err != nil {
		connErr(w, err)
		return
	}
	kv, ok := c.(driver.KeyValue)
	if !ok {
		writeErr(w, http.StatusBadRequest, "this action is only available for key-value databases")
		return
	}
	written, skipped := 0, 0
	for _, it := range b.Items {
		ok, err := kv.Restore(r.Context(), b.DB, it, b.Replace)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if ok {
			written++
		} else {
			skipped++
		}
	}
	writeJSON(w, map[string]int{"written": written, "skipped": skipped})
}

// plainNumbers turns json.Number back into float64 (zset scores) inside decoded values.
func plainNumbers(v any) any {
	switch x := v.(type) {
	case json.Number:
		f, _ := x.Float64()
		return f
	case []any:
		for i := range x {
			x[i] = plainNumbers(x[i])
		}
	case map[string]any:
		for k := range x {
			x[k] = plainNumbers(x[k])
		}
	}
	return v
}
