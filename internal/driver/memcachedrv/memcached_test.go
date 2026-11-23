package memcachedrv

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
)

// fake speaks just enough of the memcached text/meta protocol for the driver.
func fake(t *testing.T) string {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	var mu sync.Mutex
	data := map[string]string{}
	ttl := map[string]int64{}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				r := bufio.NewReader(c)
				for {
					line, err := r.ReadString('\n')
					if err != nil {
						return
					}
					f := strings.Fields(line)
					mu.Lock()
					switch f[0] {
					case "version":
						fmt.Fprint(c, "VERSION 1.6.40\r\n")
					case "stats":
						fmt.Fprintf(c, "STAT curr_items %d\r\nEND\r\n", len(data))
					case "lru_crawler":
						for k := range data {
							fmt.Fprintf(c, "key=%s exp=-1 la=0 cas=1 fetch=no cls=1 size=60\r\n", url.PathEscape(k))
						}
						fmt.Fprint(c, "END\r\n")
					case "mg":
						if v, ok := data[f[1]]; ok {
							fmt.Fprintf(c, "VA %d t%d\r\n%s\r\n", len(v), ttl[f[1]], v)
						} else {
							fmt.Fprint(c, "EN\r\n")
						}
					case "ms":
						n, _ := strconv.Atoi(f[2])
						buf := make([]byte, n+2)
						io.ReadFull(r, buf)
						if _, exists := data[f[1]]; exists && f[4] == "ME" {
							fmt.Fprint(c, "NS\r\n")
							break
						}
						data[f[1]] = string(buf[:n])
						t, _ := strconv.ParseInt(f[3][1:], 10, 64)
						ttl[f[1]] = map[bool]int64{true: -1, false: t}[t == 0]
						fmt.Fprint(c, "HD\r\n")
					case "md":
						_, ok := data[f[1]]
						delete(data, f[1])
						fmt.Fprint(c, map[bool]string{true: "HD\r\n", false: "NF\r\n"}[ok])
					case "touch":
						t, _ := strconv.ParseInt(f[2], 10, 64)
						ttl[f[1]] = map[bool]int64{true: -1, false: t}[t == 0]
						fmt.Fprint(c, "TOUCHED\r\n")
					case "incr":
						v, _ := strconv.Atoi(data[f[1]])
						d, _ := strconv.Atoi(f[2])
						data[f[1]] = strconv.Itoa(v + d)
						fmt.Fprintf(c, "%s\r\n", data[f[1]])
					default:
						fmt.Fprint(c, "ERROR\r\n")
					}
					mu.Unlock()
				}
			}()
		}
	}()
	return ln.Addr().String()
}

// KAROTX_IT_MEMCACHED=host:port runs the same checks against a real server.
func TestMemcached(t *testing.T) {
	addr := os.Getenv("KAROTX_IT_MEMCACHED")
	if addr == "" {
		addr = fake(t)
	}
	host, port, _ := net.SplitHostPort(addr)
	p, _ := strconv.Atoi(port)
	ctx := context.Background()
	c, err := Driver{}.Open(ctx, driver.OpenParams{Conn: model.Connection{Driver: "memcached", Host: host, Port: p}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	kv := c.(driver.KeyValue)
	if v := c.Info().ServerVersion; !strings.HasPrefix(v, "Memcached 1.6") {
		t.Errorf("version %q", v)
	}
	do := func(args ...string) any {
		t.Helper()
		r, err := kv.Do(ctx, 0, args)
		if err != nil {
			t.Fatalf("%v: %v", args, err)
		}
		return r
	}
	do("SET", "user:1", "Ann has spaces\r\nand lines")
	do("SET", "n", "1", "EX", "60")
	if r := do("INCRBY", "n", "4"); r != int64(5) {
		t.Errorf("incr = %v", r)
	}
	do("EXPIRE", "user:1", "30")
	do("SET", "user:1", "Bob", "KEEPTTL")
	d, err := kv.GetKey(ctx, 0, "user:1")
	if err != nil || d.Value != "Bob" || d.TTL != 30000 {
		t.Fatalf("get: %+v %v", d, err)
	}
	do("RENAME", "user:1", "user:2")
	page, err := kv.Scan(ctx, 0, "user:*", "0", 100, "")
	if err != nil || len(page.Keys) != 1 || page.Keys[0].Key != "user:2" {
		t.Fatalf("scan: %+v %v", page, err)
	}
	if ok, _ := kv.Restore(ctx, 0, driver.KeyData{Key: "user:2", Type: "string", Value: "x", TTL: -1}, false); ok {
		t.Error("restore without replace overwrote a key")
	}
	if n, _ := kv.DBSize(ctx, 0); n != 2 {
		t.Errorf("dbsize %d", n)
	}
	if r := do("DEL", "user:2", "missing"); r != int64(1) {
		t.Errorf("del = %v", r)
	}
	if _, err := kv.Do(ctx, 0, []string{"GET", "bad key\r\nflush_all"}); err == nil {
		t.Error("a key with spaces was accepted")
	}
	if !kv.IsWrite([]string{"flush_all"}) || kv.IsWrite([]string{"get", "x"}) {
		t.Error("IsWrite")
	}
}
