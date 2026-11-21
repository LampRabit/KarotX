package server

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/lamprabit/karotx/internal/driver"
)

func TestFKOrder(t *testing.T) {
	fks := []driver.ForeignKey{
		{Table: "orders", RefTable: "users"}, {Table: "items", RefTable: "orders"},
		{Table: "a", RefTable: "b"}, {Table: "b", RefTable: "a"}, // cycle
		{Table: "users", RefTable: "users"}, // self reference
	}
	got := fkOrder([]string{"items", "orders", "users", "a", "b", "z"}, fks)
	pos := map[string]int{}
	for i, n := range got {
		pos[n] = i
	}
	if len(got) != 6 || pos["users"] > pos["orders"] || pos["orders"] > pos["items"] || pos["a"] < 4 || pos["b"] < 4 {
		t.Fatal(got)
	}
}

func TestRowWriters(t *testing.T) {
	cols := []driver.Column{{Name: "id", Type: "int"}, {Name: "name", Type: "varchar"}, {Name: "raw", Type: "blob"}}
	rows := [][]any{{"1", "a,\"b\"", []byte{0xff}}, {int64(2), nil, nil}}
	run := func(sp exportSpec) string {
		var b bytes.Buffer
		w := newRowWriter(sp, &b, nil, "t")
		w.head(cols)
		for _, r := range rows {
			w.row(r)
		}
		w.close()
		return b.String()
	}
	if got := run(exportSpec{Format: "csv", Header: true, Null: "NULL", Delimiter: ";"}); got != "id;name;raw\n1;\"a,\"\"b\"\"\";\\xff\n2;NULL;NULL\n" {
		t.Errorf("csv: %q", got)
	}
	got := run(exportSpec{Format: "json"})
	var parsed []map[string]any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil || parsed[0]["id"] != 1.0 || parsed[0]["name"] != `a,"b"` || parsed[1]["name"] != nil {
		t.Errorf("json: %v %s", err, got)
	}
	if got := run(exportSpec{Format: "jsonl"}); strings.Count(got, "\n") != 2 || !strings.HasPrefix(got, `{"id":1,"name":"a,\"b\"","raw":"\\xff"}`) {
		t.Errorf("jsonl: %q", got)
	}
	var empty bytes.Buffer
	w := newRowWriter(exportSpec{Format: "json"}, &empty, nil, "t")
	w.head(cols)
	w.close()
	if empty.String() != "[]\n" {
		t.Errorf("empty json: %q", empty.String())
	}
}

func TestHelpers(t *testing.T) {
	for typ, want := range map[string]bool{"int": true, "bigint": true, "unsigned int": true, "decimal(10,2)": true, "int4": true, "interval": false, "point": false, "text": false} {
		if numericType(typ) != want {
			t.Errorf("numericType(%q)", typ)
		}
	}
	if !isNumber("-1.5e3") || isNumber("1a") || isNumber("") || isNumber("NaN") {
		t.Error("isNumber")
	}
	if mongoCell(map[string]any{"$oid": "abc"}) != "abc" || mongoCell(map[string]any{"$date": "2024-01-01"}) != "2024-01-01" {
		t.Error("mongoCell")
	}
}
