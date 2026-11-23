// Package memcachedrv implements the Memcached driver (key-value capability)
// over the text and meta protocols (memcached 1.6+). It accepts Redis-style
// commands (GET, SET, DEL, EXPIRE, …) so the key browser works unchanged.
package memcachedrv

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/lamprabit/karotx/internal/driver"
)

func init() { driver.Register("memcached", Driver{}) }

// shortcut: Scan lists at most this many matching keys (one metadump, no paging); page with a cursor if caches this big need browsing.
const maxScan = 10000

// Expiry times above 30 days are read by memcached as Unix timestamps.
const relativeLimit = 30 * 24 * 3600

type Driver struct{}

type conn struct {
	dial func(ctx context.Context) (net.Conn, error)
	user string
	pass string

	mu   sync.Mutex
	nc   net.Conn
	rd   *bufio.Reader
	info driver.Info
}

func (Driver) Open(ctx context.Context, p driver.OpenParams) (driver.Conn, error) {
	c := p.Conn
	port := c.Port
	if port == 0 {
		port = 11211
	}
	addr := net.JoinHostPort(c.Host, strconv.Itoa(port))
	var tc *tls.Config
	if c.TLS.Mode == "require" || c.TLS.Mode == "verify" {
		var err error
		if tc, err = driver.TLSConfig(c.Host, c.TLS.Mode == "verify", c.TLS.CAFile, c.TLS.CertFile, c.TLS.KeyFile); err != nil {
			return nil, err
		}
	}
	m := &conn{user: c.User, pass: p.Password}
	m.dial = func(ctx context.Context) (net.Conn, error) {
		var nc net.Conn
		var err error
		if p.Dial != nil {
			nc, err = p.Dial(ctx, "tcp", addr)
		} else {
			nc, err = (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", addr)
		}
		if err != nil || tc == nil {
			return nc, err
		}
		t := tls.Client(nc, tc)
		if err := t.HandshakeContext(ctx); err != nil {
			nc.Close()
			return nil, err
		}
		return t, nil
	}
	var version string
	err := m.with(ctx, func() error {
		line, err := m.cmd("version")
		version = strings.TrimPrefix(line, "VERSION ")
		return err
	})
	if err != nil {
		m.Close()
		return nil, err
	}
	m.info = driver.Info{Dialect: "memcached", ServerVersion: "Memcached " + version}
	return m, nil
}

// with runs fn on the (re)connected socket, holding the lock. A failed
// exchange drops the socket so the next call starts clean.
func (m *conn) with(ctx context.Context, fn func() error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.nc == nil {
		nc, err := m.dial(ctx)
		if err != nil {
			return err
		}
		m.nc, m.rd = nc, bufio.NewReader(nc)
		if m.pass != "" || m.user != "" {
			// Text-protocol auth (memcached -Y authfile): a set whose data is "user pass".
			cred := m.user + " " + m.pass
			if line, err := m.cmd(fmt.Sprintf("set _ 0 0 %d\r\n%s", len(cred), cred)); err != nil || line != "STORED" {
				m.drop()
				return cmp(err, errors.New("authentication failed"))
			}
		}
	}
	dl, ok := ctx.Deadline()
	if !ok {
		dl = time.Now().Add(60 * time.Second)
	}
	m.nc.SetDeadline(dl)
	err := fn()
	var se serverError
	if err != nil && !errors.As(err, &se) {
		m.drop()
	}
	return err
}

func cmp(a, b error) error {
	if a != nil {
		return a
	}
	return b
}

func (m *conn) drop() {
	if m.nc != nil {
		m.nc.Close()
		m.nc = nil
	}
}

// serverError is a protocol-level error reply; the socket stays usable.
type serverError string

func (e serverError) Error() string { return string(e) }

// cmd sends one line and reads one reply line.
func (m *conn) cmd(line string) (string, error) {
	if _, err := io.WriteString(m.nc, line+"\r\n"); err != nil {
		return "", err
	}
	return m.line()
}

func (m *conn) line() (string, error) {
	s, err := m.rd.ReadString('\n')
	if err != nil {
		return "", err
	}
	s = strings.TrimRight(s, "\r\n")
	for _, p := range []string{"ERROR", "CLIENT_ERROR", "SERVER_ERROR"} {
		if s == p || strings.HasPrefix(s, p+" ") {
			msg := strings.TrimSpace(strings.TrimPrefix(s, p))
			if msg == "" {
				msg = "unknown command"
			}
			return "", serverError("memcached: " + msg)
		}
	}
	return s, nil
}

// validKey rejects keys the text protocol can't carry (this also prevents
// injecting extra commands through a key).
func validKey(k string) error {
	if k == "" || len(k) > 250 {
		return errors.New("memcached keys must be 1–250 bytes")
	}
	for i := 0; i < len(k); i++ {
		if k[i] <= ' ' || k[i] == 0x7f {
			return errors.New("memcached keys can't contain spaces or control characters")
		}
	}
	return nil
}

func exptime(sec int64) int64 {
	if sec > relativeLimit {
		return time.Now().Unix() + sec
	}
	return sec
}

func (m *conn) Info() driver.Info { return m.info }

func (m *conn) Ping(ctx context.Context) error {
	return m.with(ctx, func() error { _, err := m.cmd("version"); return err })
}

func (m *conn) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.drop()
	return nil
}

func (m *conn) Tree(ctx context.Context, p []string) ([]driver.Node, error) {
	if len(p) > 0 {
		return []driver.Node{}, nil
	}
	n, err := m.DBSize(ctx, 0)
	if err != nil {
		return nil, err
	}
	detail := fmt.Sprintf("%d keys", n)
	if n == 1 {
		detail = "1 key"
	}
	return []driver.Node{{Name: "cache", Kind: "database", Path: []string{"0"}, Detail: detail}}, nil
}

func (m *conn) stats(ctx context.Context, arg string) (map[string]string, error) {
	out := map[string]string{}
	err := m.with(ctx, func() error {
		line, err := m.cmd(strings.TrimSpace("stats " + arg))
		for ; err == nil && line != "END"; line, err = m.line() {
			if rest, ok := strings.CutPrefix(line, "STAT "); ok {
				k, v, _ := strings.Cut(rest, " ")
				out[k] = v
			}
		}
		return err
	})
	return out, err
}

func (m *conn) DBSize(ctx context.Context, _ int) (int64, error) {
	s, err := m.stats(ctx, "")
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(s["curr_items"], 10, 64)
}

// Scan lists keys with lru_crawler metadump (memcached 1.4.31+), filtered by glob.
func (m *conn) Scan(ctx context.Context, _ int, pattern, _ string, _ int, typ string) (*driver.KeyPage, error) {
	page := &driver.KeyPage{Keys: []driver.KeyInfo{}, Cursor: "0"}
	if typ != "" && typ != "string" {
		return page, nil
	}
	if pattern == "" {
		pattern = "*"
	}
	now := time.Now().Unix()
	err := m.with(ctx, func() error {
		line, err := m.cmd("lru_crawler metadump all")
		if err == nil && strings.HasPrefix(line, "BUSY") {
			return serverError("memcached is busy crawling; try again in a moment")
		}
		for ; err == nil && line != "END"; line, err = m.line() {
			k, exp := parseMeta(line)
			if k == "" || len(page.Keys) >= maxScan {
				continue // keep reading to END so the socket stays in sync
			}
			if ok, _ := path.Match(pattern, k); !ok {
				continue
			}
			ttl := int64(-1)
			if exp > 0 {
				ttl = max(exp-now, 0) * 1000
			}
			page.Keys = append(page.Keys, driver.KeyInfo{Key: k, Type: "string", TTL: ttl})
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(page.Keys, func(i, j int) bool { return page.Keys[i].Key < page.Keys[j].Key })
	return page, nil
}

// parseMeta reads "key=<uri-encoded> exp=<unix|-1> ..." from a metadump line.
func parseMeta(line string) (key string, exp int64) {
	for _, f := range strings.Fields(line) {
		if v, ok := strings.CutPrefix(f, "key="); ok {
			key, _ = url.PathUnescape(v)
		} else if v, ok := strings.CutPrefix(f, "exp="); ok {
			exp, _ = strconv.ParseInt(v, 10, 64)
		}
	}
	return
}

// get reads a value and its remaining TTL (seconds, -1 = none) with the meta
// protocol. ok is false when the key doesn't exist.
func (m *conn) get(ctx context.Context, key string) (val []byte, ttl int64, ok bool, err error) {
	if err = validKey(key); err != nil {
		return
	}
	err = m.with(ctx, func() error {
		line, err := m.cmd("mg " + key + " v t")
		if err != nil {
			return err
		}
		if line == "EN" {
			return nil
		}
		f := strings.Fields(line)
		if len(f) < 2 || f[0] != "VA" {
			return fmt.Errorf("unexpected reply %q", line)
		}
		n, err := strconv.Atoi(f[1])
		if err != nil {
			return err
		}
		ttl = -1
		for _, x := range f[2:] {
			if v, found := strings.CutPrefix(x, "t"); found {
				ttl, _ = strconv.ParseInt(v, 10, 64)
			}
		}
		buf := make([]byte, n+2)
		if _, err := io.ReadFull(m.rd, buf); err != nil {
			return err
		}
		val, ok = buf[:n], true
		return nil
	})
	return
}

// set stores a value. mode is the meta mode flag: S set, E add (only if missing).
func (m *conn) set(ctx context.Context, key string, val []byte, ttl int64, mode string) (bool, error) {
	if err := validKey(key); err != nil {
		return false, err
	}
	stored := false
	err := m.with(ctx, func() error {
		line, err := m.cmd(fmt.Sprintf("ms %s %d T%d M%s\r\n%s", key, len(val), exptime(max(ttl, 0)), mode, val))
		stored = line == "HD"
		if err == nil && !stored && line != "NS" {
			err = fmt.Errorf("unexpected reply %q", line)
		}
		return err
	})
	return stored, err
}

func (m *conn) del(ctx context.Context, key string) (bool, error) {
	if err := validKey(key); err != nil {
		return false, err
	}
	var line string
	err := m.with(ctx, func() (err error) { line, err = m.cmd("md " + key); return })
	return line == "HD", err
}

func (m *conn) touch(ctx context.Context, key string, ttl int64) (bool, error) {
	if err := validKey(key); err != nil {
		return false, err
	}
	var line string
	err := m.with(ctx, func() (err error) { line, err = m.cmd(fmt.Sprintf("touch %s %d", key, exptime(ttl))); return })
	return line == "TOUCHED", err
}

func (m *conn) GetKey(ctx context.Context, _ int, key string) (*driver.KeyData, error) {
	v, ttl, ok, err := m.get(ctx, key)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("key %q does not exist (it may have expired or been evicted)", key)
	}
	d := &driver.KeyData{Key: key, Type: "string", TTL: -1, Length: int64(len(v)), Value: string(v), Binary: !utf8.Valid(v)}
	if ttl >= 0 {
		d.TTL = ttl * 1000
	}
	return d, nil
}

func (m *conn) Dump(ctx context.Context, db int, key string) (*driver.KeyData, error) {
	d, err := m.GetKey(ctx, db, key)
	if err == nil && d.Binary {
		d.Value, d.Encoding = base64.StdEncoding.EncodeToString([]byte(d.Value.(string))), "base64"
	}
	return d, err
}

func (m *conn) Restore(ctx context.Context, _ int, d driver.KeyData, replace bool) (bool, error) {
	s, ok := d.Value.(string)
	if !ok || (d.Type != "" && d.Type != "string") {
		return false, fmt.Errorf("%s: memcached only stores strings", d.Key)
	}
	v := []byte(s)
	if d.Encoding == "base64" {
		var err error
		if v, err = base64.StdEncoding.DecodeString(s); err != nil {
			return false, err
		}
	}
	ttl := int64(0)
	if d.TTL > 0 {
		ttl = max(d.TTL/1000, 1)
	}
	mode := "E"
	if replace {
		mode = "S"
	}
	return m.set(ctx, d.Key, v, ttl, mode)
}

var writes = map[string]bool{
	"SET": true, "ADD": true, "DEL": true, "DELETE": true, "EXPIRE": true, "PERSIST": true, "TOUCH": true,
	"RENAME": true, "INCR": true, "DECR": true, "INCRBY": true, "DECRBY": true, "FLUSHALL": true, "FLUSH_ALL": true,
}

func (m *conn) IsWrite(args []string) bool { return len(args) > 0 && writes[strings.ToUpper(args[0])] }

const help = "supported: GET, SET key value [EX seconds] [KEEPTTL] [NX], DEL, EXISTS, TTL, EXPIRE, PERSIST, TOUCH, RENAME, INCR, INCRBY, DECR, DECRBY, STATS [section], VERSION, FLUSH_ALL"

// Do runs one Redis-style command, translated to memcached.
func (m *conn) Do(ctx context.Context, db int, args []string) (any, error) {
	if len(args) == 0 {
		return nil, errors.New("type a command")
	}
	name := strings.ToUpper(args[0])
	n := len(args) - 1
	need := func(k int) error {
		if n < k {
			return fmt.Errorf("%s needs %d argument(s)", name, k)
		}
		return nil
	}
	num := func(s string) (int64, error) {
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("%q is not a whole number", s)
		}
		return v, nil
	}
	b2i := func(ok bool, err error) (any, error) {
		if ok {
			return int64(1), err
		}
		return int64(0), err
	}
	switch name {
	case "GET":
		if err := need(1); err != nil {
			return nil, err
		}
		v, _, ok, err := m.get(ctx, args[1])
		if !ok {
			return nil, err
		}
		return string(v), err
	case "SET", "ADD":
		if err := need(2); err != nil {
			return nil, err
		}
		ttl, mode := int64(0), "S"
		if name == "ADD" {
			mode = "E"
		}
		for i := 3; i < len(args); i++ {
			switch strings.ToUpper(args[i]) {
			case "EX", "PX":
				if i+1 >= len(args) {
					return nil, errors.New("EX needs seconds")
				}
				v, err := num(args[i+1])
				if err != nil {
					return nil, err
				}
				if strings.ToUpper(args[i]) == "PX" {
					v = max(v/1000, 1)
				}
				ttl = v
				i++
			case "KEEPTTL":
				_, t, ok, err := m.get(ctx, args[1])
				if err != nil {
					return nil, err
				}
				if ok && t > 0 {
					ttl = t
				}
			case "NX":
				mode = "E"
			default:
				return nil, fmt.Errorf("unknown SET option %q", args[i])
			}
		}
		ok, err := m.set(ctx, args[1], []byte(args[2]), ttl, mode)
		if err != nil || !ok {
			return nil, err
		}
		return "OK", nil
	case "DEL", "DELETE":
		if err := need(1); err != nil {
			return nil, err
		}
		var count int64
		for _, k := range args[1:] {
			ok, err := m.del(ctx, k)
			if err != nil {
				return count, err
			}
			if ok {
				count++
			}
		}
		return count, nil
	case "EXISTS":
		if err := need(1); err != nil {
			return nil, err
		}
		_, _, ok, err := m.get(ctx, args[1])
		return b2i(ok, err)
	case "TTL":
		if err := need(1); err != nil {
			return nil, err
		}
		_, t, ok, err := m.get(ctx, args[1])
		if !ok {
			return int64(-2), err
		}
		return t, err
	case "EXPIRE", "TOUCH":
		if err := need(2); err != nil {
			return nil, err
		}
		s, err := num(args[2])
		if err != nil {
			return nil, err
		}
		return b2i(m.touch(ctx, args[1], s))
	case "PERSIST":
		if err := need(1); err != nil {
			return nil, err
		}
		return b2i(m.touch(ctx, args[1], 0))
	case "RENAME":
		if err := need(2); err != nil {
			return nil, err
		}
		v, ttl, ok, err := m.get(ctx, args[1])
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errors.New("no such key")
		}
		if _, err := m.set(ctx, args[2], v, max(ttl, 0), "S"); err != nil {
			return nil, err
		}
		if _, err := m.del(ctx, args[1]); err != nil {
			return nil, err
		}
		return "OK", nil
	case "INCR", "DECR", "INCRBY", "DECRBY":
		if err := need(1); err != nil {
			return nil, err
		}
		if err := validKey(args[1]); err != nil {
			return nil, err
		}
		by := int64(1)
		if strings.HasSuffix(name, "BY") {
			if err := need(2); err != nil {
				return nil, err
			}
			v, err := num(args[2])
			if err != nil {
				return nil, err
			}
			by = v
		}
		op := "incr"
		if strings.HasPrefix(name, "DECR") != (by < 0) {
			op = "decr"
		}
		if by < 0 {
			by = -by
		}
		var line string
		err := m.with(ctx, func() (err error) { line, err = m.cmd(fmt.Sprintf("%s %s %d", op, args[1], by)); return })
		if err != nil {
			return nil, err
		}
		if line == "NOT_FOUND" {
			return nil, errors.New("no such key (memcached can only increment existing numeric values)")
		}
		return num(line)
	case "STATS", "INFO":
		arg := ""
		if n > 0 {
			arg = strings.ToLower(args[1])
			if arg != "items" && arg != "slabs" && arg != "settings" && arg != "sizes" && arg != "conns" {
				return nil, errors.New("STATS sections: items, slabs, settings, sizes, conns")
			}
		}
		s, err := m.stats(ctx, arg)
		keys := make([]string, 0, len(s))
		for k := range s {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make([]string, len(keys))
		for i, k := range keys {
			out[i] = k + " " + s[k]
		}
		return out, err
	case "VERSION":
		return strings.TrimPrefix(m.info.ServerVersion, "Memcached "), nil
	case "FLUSHALL", "FLUSH_ALL":
		var line string
		err := m.with(ctx, func() (err error) { line, err = m.cmd("flush_all"); return })
		return line, err
	case "PING":
		return "PONG", m.Ping(ctx)
	}
	return nil, fmt.Errorf("unknown command %s; %s", name, help)
}
