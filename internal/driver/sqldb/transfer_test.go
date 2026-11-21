package sqldb

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
)

func TestSQLiteTransfer(t *testing.T) {
	ctx := context.Background()
	file := filepath.Join(t.TempDir(), "t.db")
	db, _ := openRaw(file)
	db.Exec(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL, data BLOB)`)
	db.Close()
	c, err := Driver{sqlite{}}.OpenSQL(ctx, driver.OpenParams{Conn: model.Connection{File: file}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	tr := c.(driver.Transfer)
	ref := driver.TableRef{Schema: "main", Table: "items"}

	// Insert in more than one chunk; strings convert by column affinity.
	rows := make([][]any, 1200)
	for i := range rows {
		rows[i] = []any{"item", "1.5"}
	}
	rows[0] = []any{"it's", nil}
	if n, err := tr.InsertRows(ctx, ref, []string{"name", "price"}, rows, false); err != nil || n != 1200 {
		t.Fatalf("insert: %d %v", n, err)
	}
	if _, err := tr.InsertRows(ctx, ref, []string{"name"}, [][]any{{"a", "b"}}, false); err == nil {
		t.Fatal("expected an error for a row with too many values")
	}
	// A failing batch leaves the table as it was (one transaction), even with clear.
	if _, err := tr.InsertRows(ctx, ref, []string{"name"}, [][]any{{"ok"}, {nil}}, true); err == nil {
		t.Fatal("expected NOT NULL to fail")
	}

	c.Query(ctx, "UPDATE items SET data = x'00ff' WHERE id = 2", driver.QueryOptions{})
	var got [][]any
	var cols []driver.Column
	err = tr.StreamRows(ctx, "SELECT id, name, price, data FROM items ORDER BY id LIMIT 2", "",
		func(c []driver.Column) error { cols = c; return nil },
		func(v []any) error { got = append(got, append([]any(nil), v...)); return nil })
	if err != nil || len(cols) != 4 || len(got) != 2 || got[0][1] != "it's" || got[0][2] != nil || got[1][2] != 1.5 {
		t.Fatalf("stream: %v %v %v", err, cols, got)
	}
	if b, ok := got[1][3].([]byte); !ok || len(b) != 2 || tr.Literal(b) != "X'00ff'" {
		t.Fatalf("binary: %#v", got[1][3])
	}
	// Exports are read-only.
	if err := tr.StreamRows(ctx, "DELETE FROM items RETURNING id", "", func([]driver.Column) error { return nil }, func([]any) error { return nil }); err == nil {
		t.Fatal("expected a read-only error")
	}

	ddl, err := tr.CreateTableSQL(ctx, ref)
	if err != nil || !strings.HasPrefix(ddl, "CREATE TABLE items") {
		t.Fatalf("ddl: %q %v", ddl, err)
	}

	// Scripts: progress per statement; stop or continue on errors.
	var done []int
	var errs int
	script := "CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1); INSERT INTO nope VALUES (1); INSERT INTO t VALUES (2)"
	err = tr.ExecScript(ctx, script, "", false, func(d, total int, e error, _ string) {
		done = append(done, d)
		if e != nil {
			errs++
		}
		if total != 4 {
			t.Errorf("total %d", total)
		}
	})
	if err == nil || len(done) != 3 || errs != 1 {
		t.Fatalf("stop on error: %v %v", err, done)
	}
	c.Query(ctx, "DROP TABLE t", driver.QueryOptions{})
	done = nil
	if err = tr.ExecScript(ctx, script, "", true, func(d, _ int, _ error, _ string) { done = append(done, d) }); err == nil || len(done) != 4 {
		t.Fatalf("continue: %v %v", err, done)
	}
	res, _ := c.Query(ctx, "SELECT count(*) FROM t", driver.QueryOptions{})
	if res[0].Rows[0][0] != int64(2) {
		t.Fatalf("script rows: %v", res[0].Rows)
	}
}

func TestLiteral(t *testing.T) {
	my := &conn{d: mysqlDialect{}}
	pg := &conn{d: postgres{}}
	if got := my.Literal(`a\'b`); got != `'a\\''b'` {
		t.Errorf("mysql: %s", got)
	}
	if got := pg.Literal(`a\'b`); got != `'a\''b'` {
		t.Errorf("postgres: %s", got)
	}
	if got := pg.Literal([]byte{1, 255}); got != `'\x01ff'::bytea` {
		t.Errorf("bytea: %s", got)
	}
	if pg.Literal(nil) != "NULL" || pg.Literal(true) != "TRUE" || pg.Literal(int64(3)) != "3" {
		t.Error("scalars")
	}
}
