package sqldb

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
)

func TestSQLiteEndToEnd(t *testing.T) {
	ctx := context.Background()
	file := filepath.Join(t.TempDir(), "t.db")

	if _, err := (sqlite{}).open(ctx, driver.OpenParams{Conn: model.Connection{File: file}}); err == nil {
		t.Fatal("expected an error for a missing file")
	}
	db, err := openRaw(file)
	if err != nil {
		t.Fatal(err)
	}
	db.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, note TEXT)`)
	db.Close()

	c, err := Driver{sqlite{}}.Open(ctx, driver.OpenParams{Conn: model.Connection{File: file}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	res, err := c.Query(ctx, "insert into users(name) values ('ann'), ('bob'); select * from users order by id", driver.QueryOptions{})
	if err != nil || len(res) != 2 || res[0].Error != "" || *res[0].RowsAffected != 2 || len(res[1].Rows) != 2 {
		t.Fatalf("query: %v %+v", err, res)
	}

	nodes, err := c.Tree(ctx, nil)
	if err != nil || len(nodes) != 1 || nodes[0].Name != "users" || strings.Join(nodes[0].Path, ".") != "main.users" {
		t.Fatalf("tree root: %v %+v", err, nodes)
	}
	cols, _ := c.Tree(ctx, nodes[0].Path)
	if len(cols) != 3 || !cols[0].PrimaryKey {
		t.Fatalf("tree cols: %+v", cols)
	}

	ref := driver.TableRef{Schema: "main", Table: "users"}
	b, err := c.Browse(ctx, driver.BrowseRequest{TableRef: ref, Limit: 1, OrderBy: "id", Desc: true})
	if err != nil || len(b.Rows) != 1 || !b.Truncated || b.Rows[0][1] != "bob" || b.PrimaryKey[0] != "id" {
		t.Fatalf("browse: %v %+v", err, b)
	}

	changes := []driver.Change{
		{Kind: "update", Key: map[string]any{"id": 1}, Values: map[string]any{"note": "it's ? $1"}},
		{Kind: "delete", Key: map[string]any{"id": 2}},
		{Kind: "insert", Values: map[string]any{"name": "cy"}},
	}
	preview, err := c.Apply(ctx, driver.ApplyRequest{TableRef: ref, Changes: changes}, true)
	if err != nil || preview[0] != `UPDATE "main"."users" SET "note" = 'it''s ? $1' WHERE "id" = 1` {
		t.Fatalf("preview: %v %q", err, preview)
	}
	if _, err := c.Apply(ctx, driver.ApplyRequest{TableRef: ref, Changes: changes}, false); err != nil {
		t.Fatal(err)
	}
	res, _ = c.Query(ctx, "select name, note from users order by id", driver.QueryOptions{})
	if got := res[0].Rows; len(got) != 2 || got[0][1] != "it's ? $1" || got[1][0] != "cy" {
		t.Fatalf("after apply: %+v", got)
	}

	// A stale edit must fail and roll back everything.
	_, err = c.Apply(ctx, driver.ApplyRequest{TableRef: ref, Changes: []driver.Change{
		{Kind: "insert", Values: map[string]any{"name": "zed"}},
		{Kind: "update", Key: map[string]any{"id": 99}, Values: map[string]any{"name": "x"}},
	}}, false)
	if err == nil || !strings.Contains(err.Error(), "no row matched") {
		t.Fatalf("stale edit: %v", err)
	}
	res, _ = c.Query(ctx, "select count(*) from users", driver.QueryOptions{})
	if res[0].Rows[0][0] != int64(2) {
		t.Fatalf("rollback failed: %+v", res[0].Rows)
	}

	tables, err := c.Tables(ctx, "main")
	if err != nil || len(tables) != 1 || tables[0].Kind != "table" {
		t.Fatalf("tables: %v %+v", err, tables)
	}
	info, err := c.Columns(ctx, ref)
	// INTEGER PRIMARY KEY without the AUTOINCREMENT keyword is not reported as auto-increment.
	if err != nil || len(info) != 3 || !info[0].PrimaryKey || info[0].AutoIncrement || !info[1].Nullable {
		t.Fatalf("columns: %v %+v", err, info)
	}
	c.Query(ctx, "CREATE TABLE seq (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)", driver.QueryOptions{})
	if info, _ := c.Columns(ctx, driver.TableRef{Schema: "main", Table: "seq"}); len(info) != 2 || !info[0].AutoIncrement {
		t.Fatalf("autoincrement column: %+v", info)
	}

	// A rebuild script (as the table designer generates for SQLite) with a trigger body.
	res, err = c.Query(ctx, `PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;
BEGIN;
CREATE TABLE "_kx_new_seq" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "v" INTEGER NOT NULL DEFAULT 0);
INSERT INTO "_kx_new_seq" ("id", "v") SELECT "id", "v" FROM "seq";
DROP TABLE "seq";
ALTER TABLE "_kx_new_seq" RENAME TO "seq";
CREATE TRIGGER seq_t AFTER INSERT ON seq BEGIN UPDATE seq SET v = v + 1 WHERE id = new.id; END;
COMMIT;
PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON`, driver.QueryOptions{})
	for _, r := range res {
		if r.Error != "" {
			t.Fatalf("rebuild: %s → %s", r.Statement, r.Error)
		}
	}
	if err != nil || len(res) != 11 {
		t.Fatalf("rebuild ran %d statements: %v", len(res), err)
	}
	if info, _ := c.Columns(ctx, driver.TableRef{Schema: "main", Table: "seq"}); info[1].Type != "INTEGER" || info[1].Nullable {
		t.Fatalf("after rebuild: %+v", info)
	}

	// Creating a new database file.
	newFile := filepath.Join(t.TempDir(), "new.db")
	if err := CreateSQLiteFile(newFile); err != nil {
		t.Fatal(err)
	}
	if err := CreateSQLiteFile(newFile); err == nil {
		t.Fatal("CreateSQLiteFile overwrote an existing file")
	}
	if nc, err := (Driver{sqlite{}}).Open(ctx, driver.OpenParams{Conn: model.Connection{File: newFile}}); err != nil {
		t.Fatalf("open new file: %v", err)
	} else {
		nc.Close()
	}

	// Read-only sessions reject writes.
	ro, err := Driver{sqlite{}}.Open(ctx, driver.OpenParams{Conn: model.Connection{File: file, ReadOnly: true}})
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	res, _ = ro.Query(ctx, "delete from users", driver.QueryOptions{})
	if res[0].Error == "" {
		t.Fatal("read-only connection allowed a delete")
	}
}

func openRaw(file string) (*sql.DB, error) { return sql.Open("sqlite", file) }
