package redisdrv

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
)

func start(t *testing.T) (*miniredis.Miniredis, driver.KeyValue) {
	t.Helper()
	mr := miniredis.RunT(t)
	host, port, _ := strings.Cut(mr.Addr(), ":")
	p, _ := strconv.Atoi(port)
	kv, err := Open(context.Background(), driver.OpenParams{Conn: model.Connection{Driver: "redis", Host: host, Port: p}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { kv.Close() })
	return mr, kv
}

func TestRedisBrowseAndEdit(t *testing.T) {
	ctx := context.Background()
	mr, kv := start(t)
	mr.Set("user:1:name", "Ann")
	mr.SetTTL("user:1:name", time.Hour)
	mr.HSet("user:1", "name", "Ann", "city", "Pune")
	mr.Lpush("queue", "b")
	mr.Lpush("queue", "a")
	mr.SetAdd("tags", "go", "redis")
	mr.ZAdd("scores", 10, "ann")
	mr.ZAdd("scores", 7, "bob")
	mr.Select(2)
	mr.Set("other", "x")
	mr.Select(0)

	nodes, err := kv.Tree(ctx, nil)
	if err != nil || len(nodes) != 2 || nodes[0].Name != "db0" || nodes[0].Detail != "5 keys" || nodes[1].Path[0] != "2" {
		t.Fatalf("tree: %v %+v", err, nodes)
	}

	page, err := kv.Scan(ctx, 0, "user:*", "0", 100, "")
	if err != nil || len(page.Keys) != 2 || page.Keys[0].Key != "user:1" || page.Keys[0].Type != "hash" || page.Keys[1].TTL <= 0 || page.Keys[0].TTL != -1 {
		t.Fatalf("scan: %v %+v", err, page)
	}
	if page, _ := kv.Scan(ctx, 0, "*", "0", 100, "zset"); len(page.Keys) != 1 || page.Keys[0].Key != "scores" {
		t.Fatalf("scan by type: %+v", page)
	}

	h, _ := kv.GetKey(ctx, 0, "user:1")
	if pairs := h.Value.([][2]string); h.Length != 2 || pairs[0] != [2]string{"city", "Pune"} {
		t.Fatalf("hash: %+v", h)
	}
	l, _ := kv.GetKey(ctx, 0, "queue")
	if items := l.Value.([]string); len(items) != 2 || items[0] != "a" {
		t.Fatalf("list: %+v", l)
	}
	z, _ := kv.GetKey(ctx, 0, "scores")
	if ms := z.Value.([]driver.ZMember); ms[0].Member != "bob" || ms[0].Score != 7 {
		t.Fatalf("zset: %+v", z)
	}
	if _, err := kv.GetKey(ctx, 0, "missing"); err == nil {
		t.Fatal("missing key should error")
	}

	// Edits go through Do; database 2 is independent.
	if _, err := kv.Do(ctx, 0, []string{"HSET", "user:1", "city", "Goa"}); err != nil {
		t.Fatal(err)
	}
	if v, _ := mr.DB(0).HGet("user:1", "city"), ""; v != "Goa" {
		t.Fatalf("HSET didn't apply: %q", v)
	}
	if v, err := kv.Do(ctx, 2, []string{"GET", "other"}); err != nil || v != "x" {
		t.Fatalf("db 2 GET: %v %v", v, err)
	}
	if v, err := kv.Do(ctx, 0, []string{"GET", "nope"}); err != nil || v != nil {
		t.Fatalf("missing GET should be nil: %v %v", v, err)
	}
	if _, err := kv.Do(ctx, 0, []string{"SELECT", "3"}); err == nil {
		t.Fatal("SELECT must be refused (the database is chosen per request)")
	}
	if n, _ := kv.DBSize(ctx, 0); n != 5 {
		t.Fatalf("dbsize: %d", n)
	}
}

func TestIsWrite(t *testing.T) {
	_, kv := start(t)
	cases := map[string]bool{
		"GET a": false, "HGETALL h": false, "SCAN 0": false, "CONFIG GET maxmemory": false, "CLIENT LIST": false,
		"SET a 1": true, "DEL a": true, "HSET h f v": true, "FLUSHDB": true, "CONFIG SET maxmemory 1mb": true,
		"CLIENT KILL ID 1": true, "EXPIRE a 10": true, "EVAL x 0": true,
	}
	for line, want := range cases {
		args, _ := driver.SplitCommand(line)
		if got := kv.IsWrite(args); got != want {
			t.Errorf("IsWrite(%q) = %v, want %v", line, got, want)
		}
	}
}

func TestSplitCommand(t *testing.T) {
	got, err := driver.SplitCommand(`SET "my key" 'it''s' "a \"b\"\n"  plain`)
	want := []string{"SET", "my key", "its", "a \"b\"\n", "plain"}
	if err != nil || strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got %q %v", got, err)
	}
	if _, err := driver.SplitCommand(`GET "open`); err == nil {
		t.Fatal("unclosed quote should error")
	}
}

func TestDumpRestore(t *testing.T) {
	ctx := context.Background()
	mr, kv := start(t)
	mr.Set("s", "hello")
	mr.SetTTL("s", time.Hour)
	mr.Set("bin", "\x00\xff")
	mr.HSet("h", "a", "1", "b", "2")
	for i := 0; i < 1500; i++ { // more than the display limit
		mr.Push("l", strconv.Itoa(i))
	}
	mr.SetAdd("set", "x", "y")
	mr.ZAdd("z", 1.5, "m")
	mr.XAdd("st", "1-1", []string{"f", "v"})

	var dumps []driver.KeyData
	for _, k := range []string{"s", "bin", "h", "l", "set", "z", "st"} {
		d, err := kv.Dump(ctx, 0, k)
		if err != nil || d.Truncated {
			t.Fatalf("dump %s: %v %+v", k, err, d)
		}
		// Round-trip through JSON, as export and import do.
		b, _ := json.Marshal(d)
		var back driver.KeyData
		json.Unmarshal(b, &back)
		dumps = append(dumps, back)
	}
	if dumps[1].Encoding != "base64" || len(dumps[3].Value.([]any)) != 1500 {
		t.Fatalf("dump shape: %+v", dumps[1])
	}
	// Existing keys are skipped unless replace is set.
	if ok, err := kv.Restore(ctx, 0, dumps[0], false); ok || err != nil {
		t.Fatalf("skip: %v %v", ok, err)
	}
	for _, d := range dumps {
		if ok, err := kv.Restore(ctx, 1, d, true); !ok || err != nil {
			t.Fatalf("restore %s: %v", d.Key, err)
		}
	}
	mr.Select(1)
	if v, _ := mr.Get("bin"); v != "\x00\xff" {
		t.Errorf("binary %q", v)
	}
	if mr.TTL("s") <= 0 || mr.HGet("h", "b") != "2" {
		t.Error("string ttl / hash")
	}
	if l, _ := mr.List("l"); len(l) != 1500 || l[1499] != "1499" {
		t.Error("list")
	}
	if sc, _ := mr.ZScore("z", "m"); sc != 1.5 {
		t.Error("zset")
	}
	if ok, _ := mr.SIsMember("set", "y"); !ok {
		t.Error("set")
	}
	if s, _ := mr.Stream("st"); len(s) != 1 || s[0].ID != "1-1" {
		t.Error("stream")
	}
}
