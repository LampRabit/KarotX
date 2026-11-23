package dynamodrv

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strconv"
	"testing"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
)

func TestFilterExpression(t *testing.T) {
	cases := map[string]string{
		`{"age":{"$gte":30},"name":"Ann"}`:                                  "#n0 >= :v0 AND #n1 = :v1",
		`{"$or":[{"city":{"$regex":"^Ber","$options":"i"}},{"city":null}]}`: "(begins_with(#n0, :v0)) OR ((attribute_not_exists(#n0) OR attribute_type(#n0, :null)))",
		`{"tags":{"$not":{"$regex":"a\\.b"}}}`:                              "NOT (contains(#n0, :v0))",
		`{"address.city":{"$in":["A","B"]}}`:                                "#n0.#n1 IN (:v0, :v1)",
	}
	for in, want := range cases {
		var f map[string]any
		if err := decode(json.RawMessage(in), &f); err != nil {
			t.Fatal(err)
		}
		got, err := newExpr().cond(f)
		if err != nil || got != want {
			t.Errorf("%s\n got %q (%v)\nwant %q", in, got, err, want)
		}
	}
	var f map[string]any
	decode(json.RawMessage(`{"name":{"$regex":"son$"}}`), &f)
	if _, err := newExpr().cond(f); err == nil {
		t.Error("ends-with should be refused")
	}
}

func TestValuesRoundTrip(t *testing.T) {
	in := `{"b":{"$binary":"AAE="},"big":12345678901234567890,"l":[1,"x",null,true],"m":{"n":1.5},"ns":{"$NS":[1,2]},"ss":{"$SS":["a"]}}`
	item, err := parseItem(json.RawMessage(in))
	if err != nil {
		t.Fatal(err)
	}
	if out := string(marshal(item)); out != in {
		t.Errorf("round trip\n got %s\nwant %s", out, in)
	}
}

// KAROTX_IT_DYNAMO=http://127.0.0.1:8000 runs against DynamoDB Local.
func TestLiveDynamoDB(t *testing.T) {
	raw := os.Getenv("KAROTX_IT_DYNAMO")
	if raw == "" {
		t.Skip("set KAROTX_IT_DYNAMO to run")
	}
	u, _ := url.Parse(raw)
	port, _ := strconv.Atoi(u.Port())
	ctx := context.Background()
	c, err := Driver{}.Open(ctx, driver.OpenParams{Conn: model.Connection{Driver: "dynamodb", Host: u.Hostname(), Port: port, User: "local", TLS: model.TLS{Mode: "off"}}, Password: "local"})
	if err != nil {
		t.Fatal(err)
	}
	d := c.(driver.Document)
	tbl := "karotx_it"
	d.DropCollection(ctx, "", tbl)
	if err := d.CreateCollection(ctx, "", tbl, []driver.KeyAttr{{Name: "pk", Type: "S"}, {Name: "sk", Type: "N"}}); err != nil {
		t.Fatal(err)
	}
	defer d.DropCollection(ctx, "", tbl)
	docs := []json.RawMessage{}
	for i := range 60 {
		docs = append(docs, json.RawMessage(`{"pk":"u`+strconv.Itoa(i%3)+`","sk":`+strconv.Itoa(i)+`,"name":"n`+strconv.Itoa(i)+`"}`))
	}
	if n, err := d.Insert(ctx, "", tbl, docs); err != nil || n != 60 {
		t.Fatalf("insert: %d %v", n, err)
	}
	if _, err := d.Insert(ctx, "", tbl, docs[:1]); err == nil {
		t.Error("single insert overwrote an existing key")
	}
	r, err := d.Find(ctx, "", tbl, driver.FindRequest{Filter: json.RawMessage(`{"pk":"u1","sk":{"$gte":30}}`), Limit: 5})
	if err != nil || len(r.Docs) != 5 || r.Total != 6 || len(r.Key) != 2 {
		t.Fatalf("query: %+v %v", r, err)
	}
	r, err = d.Find(ctx, "", tbl, driver.FindRequest{Filter: json.RawMessage(`{"pk":"u1","sk":{"$gte":30,"$lte":40}}`), Limit: 50})
	if err != nil || len(r.Docs) != 4 { // 31, 34, 37, 40 (falls back to a Scan)
		t.Fatalf("between: %d %v", len(r.Docs), err)
	}
	r, err = d.Find(ctx, "", tbl, driver.FindRequest{Filter: json.RawMessage(`{"name":{"$regex":"^n5"}}`), Limit: 50, Skip: 5})
	if err != nil || len(r.Docs) != 6 || r.Estimated { // n5, n50..n59 = 11, minus 5 skipped
		t.Fatalf("scan: %d docs, %+v %v", len(r.Docs), r, err)
	}
	if err := d.Replace(ctx, "", tbl, json.RawMessage(`{"pk":"u0","sk":0}`), json.RawMessage(`{"pk":"u0","sk":1000,"name":"moved"}`)); err != nil {
		t.Fatal(err)
	}
	if n, err := d.Delete(ctx, "", tbl, []json.RawMessage{json.RawMessage(`{"pk":"u0","sk":1000}`), json.RawMessage(`{"pk":"u0","sk":0}`)}); err != nil || n != 1 {
		t.Fatalf("delete: %d %v", n, err)
	}
	res, err := d.RunCommand(ctx, "", json.RawMessage(`{"statement":"SELECT * FROM \"karotx_it\" WHERE pk = ?","parameters":["u2"]}`))
	var items []any
	json.Unmarshal(res, &items)
	if err != nil || len(items) != 20 {
		t.Fatalf("partiql: %d %v", len(items), err)
	}
	if read, _ := d.ClassifyCommand(json.RawMessage(`{"statement":"DELETE FROM x WHERE pk='a'"}`)); read {
		t.Error("DELETE classified as read")
	}
	if n, err := d.DeleteAll(ctx, "", tbl); err != nil || n != 59 {
		t.Fatalf("delete all: %d %v", n, err)
	}
}
