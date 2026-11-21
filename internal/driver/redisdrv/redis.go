// Package redisdrv implements the Redis driver (key-value capability).
package redisdrv

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"

	"github.com/lamprabit/karotx/internal/driver"
)

func init() { driver.Register("redis", Driver{}) }

// How much of a big value is loaded for display.
const (
	maxItems  = 1000
	maxString = 1 << 20 // 1 MiB
)

type Driver struct{}

type conn struct {
	opts    redis.Options
	mu      sync.Mutex
	clients map[int]*redis.Client // one small pool per logical database
	info    driver.Info
	writes  map[string]bool // commands flagged "write" by the server (COMMAND)
}

func (Driver) Open(ctx context.Context, p driver.OpenParams) (driver.Conn, error) {
	return Open(ctx, p)
}

// Open connects and returns the key-value capability.
func Open(ctx context.Context, p driver.OpenParams) (driver.KeyValue, error) {
	c := p.Conn
	port := c.Port
	if port == 0 {
		port = 6379
	}
	db, _ := strconv.Atoi(c.Database)
	o := redis.Options{
		Addr:            net.JoinHostPort(c.Host, strconv.Itoa(port)),
		Username:        c.User,
		Password:        p.Password,
		DB:              db,
		Protocol:        2, // RESP2: simple, uniform reply types
		DialTimeout:     15 * time.Second,
		PoolSize:        4,
		DisableIdentity: true,
	}
	if p.Dial != nil {
		o.Dialer = func(ctx context.Context, network, addr string) (net.Conn, error) { return p.Dial(ctx, network, addr) }
	}
	if c.TLS.Mode == "require" || c.TLS.Mode == "verify" {
		t, err := driver.TLSConfig(c.Host, c.TLS.Mode == "verify", c.TLS.CAFile, c.TLS.CertFile, c.TLS.KeyFile)
		if err != nil {
			return nil, err
		}
		o.TLSConfig = t
	}
	r := &conn{opts: o, clients: map[int]*redis.Client{}}
	cl := r.client(db)
	if err := cl.Ping(ctx).Err(); err != nil {
		r.Close()
		return nil, err
	}
	version := "Redis"
	if info, err := cl.Info(ctx, "server").Result(); err == nil {
		if v := infoField(info, "redis_version"); v != "" {
			version = "Redis " + v
		}
		if v := infoField(info, "valkey_version"); v != "" {
			version = "Valkey " + v
		}
	}
	r.info = driver.Info{Dialect: "redis", ServerVersion: version, Database: strconv.Itoa(db)}
	// Learn which commands write, from the server itself (falls back to a static list).
	if cmds, err := cl.Command(ctx).Result(); err == nil {
		r.writes = map[string]bool{}
		for name, ci := range cmds {
			for _, f := range ci.Flags {
				if f == "write" {
					r.writes[strings.ToUpper(name)] = true
				}
			}
		}
	}
	return r, nil
}

func infoField(info, name string) string {
	for _, line := range strings.Split(info, "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), name+":"); ok {
			return v
		}
	}
	return ""
}

func (r *conn) client(db int) *redis.Client {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.clients[db]; ok {
		return c
	}
	o := r.opts
	o.DB = db
	c := redis.NewClient(&o)
	r.clients[db] = c
	return c
}

func (r *conn) Info() driver.Info              { return r.info }
func (r *conn) Ping(ctx context.Context) error { return r.client(r.opts.DB).Ping(ctx).Err() }

func (r *conn) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.clients {
		c.Close()
	}
	r.clients = map[int]*redis.Client{}
	return nil
}

// Tree lists logical databases that hold keys (plus the configured one).
func (r *conn) Tree(ctx context.Context, path []string) ([]driver.Node, error) {
	if len(path) > 0 {
		return []driver.Node{}, nil
	}
	counts := map[int]int64{r.opts.DB: 0}
	if info, err := r.client(r.opts.DB).Info(ctx, "keyspace").Result(); err == nil {
		for _, line := range strings.Split(info, "\n") {
			line = strings.TrimSpace(line)
			name, rest, ok := strings.Cut(line, ":")
			if !ok || !strings.HasPrefix(name, "db") {
				continue
			}
			n, err := strconv.Atoi(name[2:])
			if err != nil {
				continue
			}
			for _, kv := range strings.Split(rest, ",") {
				if v, ok := strings.CutPrefix(kv, "keys="); ok {
					counts[n], _ = strconv.ParseInt(v, 10, 64)
				}
			}
		}
	}
	if len(counts) == 1 && counts[r.opts.DB] == 0 {
		// INFO keyspace unavailable (restricted or emulated servers): count with
		// DBSIZE per database on one pipelined connection, then switch it back.
		pipe := r.client(r.opts.DB).Pipeline()
		sizes := make([]*redis.IntCmd, 16)
		for n := range sizes {
			pipe.Select(ctx, n)
			sizes[n] = pipe.DBSize(ctx)
		}
		pipe.Select(ctx, r.opts.DB)
		pipe.Exec(ctx)
		for n, s := range sizes {
			if v, err := s.Result(); err == nil && (v > 0 || n == r.opts.DB) {
				counts[n] = v
			}
		}
	}
	dbs := make([]int, 0, len(counts))
	for n := range counts {
		dbs = append(dbs, n)
	}
	sort.Ints(dbs)
	nodes := make([]driver.Node, len(dbs))
	for i, n := range dbs {
		nodes[i] = driver.Node{Name: fmt.Sprintf("db%d", n), Kind: "database", Path: []string{strconv.Itoa(n)}, Detail: keyCount(counts[n])}
	}
	return nodes, nil
}

func (r *conn) DBSize(ctx context.Context, db int) (int64, error) {
	return r.client(db).DBSize(ctx).Result()
}

func (r *conn) Scan(ctx context.Context, db int, pattern, cursor string, count int, typ string) (*driver.KeyPage, error) {
	if count <= 0 || count > 1000 {
		count = 200
	}
	if pattern == "" {
		pattern = "*"
	}
	cl := r.client(db)
	cur, _ := strconv.ParseUint(cursor, 10, 64)
	var keys []string
	// Sparse patterns can return few keys per SCAN call; keep going (bounded).
	for i := 0; i < 50; i++ {
		var batch []string
		var err error
		if typ != "" {
			batch, cur, err = cl.ScanType(ctx, cur, pattern, int64(count), typ).Result()
		} else {
			batch, cur, err = cl.Scan(ctx, cur, pattern, int64(count)).Result()
		}
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		if cur == 0 || len(keys) >= count {
			break
		}
	}
	page := &driver.KeyPage{Keys: make([]driver.KeyInfo, len(keys)), Cursor: strconv.FormatUint(cur, 10)}
	if len(keys) == 0 {
		return page, nil
	}
	pipe := cl.Pipeline()
	types := make([]*redis.StatusCmd, len(keys))
	ttls := make([]*redis.DurationCmd, len(keys))
	for i, k := range keys {
		types[i] = pipe.Type(ctx, k)
		ttls[i] = pipe.PTTL(ctx, k)
	}
	pipe.Exec(ctx) // per-command errors are read below
	for i, k := range keys {
		page.Keys[i] = driver.KeyInfo{Key: k, Type: types[i].Val(), TTL: ttlMs(ttls[i].Val())}
	}
	sort.Slice(page.Keys, func(i, j int) bool { return page.Keys[i].Key < page.Keys[j].Key })
	return page, nil
}

func ttlMs(d time.Duration) int64 {
	if d < 0 {
		return -1
	}
	return d.Milliseconds()
}

func (r *conn) GetKey(ctx context.Context, db int, key string) (*driver.KeyData, error) {
	return r.getKey(ctx, db, key, false)
}

// getKey reads a key; full reads the whole value (export) instead of the first part.
func (r *conn) getKey(ctx context.Context, db int, key string, full bool) (*driver.KeyData, error) {
	cl := r.client(db)
	items, str := int64(maxItems), int64(maxString)
	if full {
		items, str = 1<<62, 1<<62
	}
	typ, err := cl.Type(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	if typ == "none" {
		return nil, fmt.Errorf("key %q does not exist (it may have expired)", key)
	}
	ttl, _ := cl.PTTL(ctx, key).Result()
	d := &driver.KeyData{Key: key, Type: typ, TTL: ttlMs(ttl)}
	bin := func(ss ...string) {
		for _, s := range ss {
			if !utf8.ValidString(s) {
				d.Binary = true
			}
		}
	}
	switch typ {
	case "string":
		d.Length, _ = cl.StrLen(ctx, key).Result()
		v, err := cl.GetRange(ctx, key, 0, min(str, 1<<40)-1).Result()
		if err != nil {
			return nil, err
		}
		bin(v)
		d.Value, d.Truncated = v, d.Length > str
	case "hash":
		d.Length, _ = cl.HLen(ctx, key).Result()
		pairs := [][2]string{}
		var cur uint64
		for {
			kv, next, err := cl.HScan(ctx, key, cur, "*", 500).Result()
			if err != nil {
				return nil, err
			}
			for i := 0; i+1 < len(kv); i += 2 {
				bin(kv[i], kv[i+1])
				pairs = append(pairs, [2]string{kv[i], kv[i+1]})
			}
			cur = next
			if cur == 0 || int64(len(pairs)) >= items {
				break
			}
		}
		sort.Slice(pairs, func(i, j int) bool { return pairs[i][0] < pairs[j][0] })
		d.Value, d.Truncated = pairs, int64(len(pairs)) < d.Length
	case "list":
		d.Length, _ = cl.LLen(ctx, key).Result()
		list, err := cl.LRange(ctx, key, 0, min(items, 1<<40)-1).Result()
		if err != nil {
			return nil, err
		}
		bin(list...)
		d.Value, d.Truncated = list, int64(len(list)) < d.Length
	case "set":
		d.Length, _ = cl.SCard(ctx, key).Result()
		members := []string{}
		var cur uint64
		for {
			batch, next, err := cl.SScan(ctx, key, cur, "*", 500).Result()
			if err != nil {
				return nil, err
			}
			members = append(members, batch...)
			cur = next
			if cur == 0 || int64(len(members)) >= items {
				break
			}
		}
		bin(members...)
		sort.Strings(members)
		d.Value, d.Truncated = members, int64(len(members)) < d.Length
	case "zset":
		d.Length, _ = cl.ZCard(ctx, key).Result()
		zs, err := cl.ZRangeWithScores(ctx, key, 0, min(items, 1<<40)-1).Result()
		if err != nil {
			return nil, err
		}
		out := make([]driver.ZMember, len(zs))
		for i, z := range zs {
			m := fmt.Sprint(z.Member)
			bin(m)
			out[i] = driver.ZMember{Member: m, Score: z.Score}
		}
		d.Value, d.Truncated = out, int64(len(out)) < d.Length
	case "stream":
		d.Length, _ = cl.XLen(ctx, key).Result()
		var msgs []redis.XMessage
		if full {
			msgs, err = cl.XRange(ctx, key, "-", "+").Result()
		} else {
			msgs, err = cl.XRevRangeN(ctx, key, "+", "-", 200).Result()
		}
		if err != nil {
			return nil, err
		}
		out := make([]driver.StreamEntry, len(msgs))
		for i, m := range msgs {
			f := map[string]string{}
			for k, v := range m.Values {
				f[k] = fmt.Sprint(v)
			}
			out[i] = driver.StreamEntry{ID: m.ID, Fields: f}
		}
		d.Value, d.Truncated = out, int64(len(out)) < d.Length
	default:
		// Module types (JSON, time series, …) are read through the console.
		d.Value = nil
	}
	return d, nil
}

func (r *conn) Do(ctx context.Context, db int, args []string) (any, error) {
	if len(args) == 0 {
		return nil, errors.New("type a command")
	}
	switch strings.ToUpper(args[0]) {
	case "SELECT", "SUBSCRIBE", "PSUBSCRIBE", "SSUBSCRIBE", "MONITOR", "SYNC", "PSYNC", "QUIT", "RESET":
		return nil, fmt.Errorf("%s isn't available here: pick the database with the selector instead", strings.ToUpper(args[0]))
	}
	a := make([]any, len(args))
	for i, s := range args {
		a[i] = s
	}
	v, err := r.client(db).Do(ctx, a...).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return jsonable(v), nil
}

// jsonable converts reply values into JSON-friendly shapes.
func jsonable(v any) any {
	switch x := v.(type) {
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = jsonable(e)
		}
		return out
	case map[any]any:
		out := map[string]any{}
		for k, e := range x {
			out[fmt.Sprint(k)] = jsonable(e)
		}
		return out
	case redis.Error:
		return x.Error()
	}
	return v
}

// readOnly is the fallback list of safe commands when COMMAND is unavailable.
var readOnly = map[string]bool{
	"GET": true, "MGET": true, "STRLEN": true, "GETRANGE": true, "EXISTS": true, "TYPE": true, "TTL": true, "PTTL": true,
	"KEYS": true, "SCAN": true, "DBSIZE": true, "INFO": true, "PING": true, "ECHO": true, "TIME": true,
	"HGET": true, "HMGET": true, "HGETALL": true, "HKEYS": true, "HVALS": true, "HLEN": true, "HEXISTS": true, "HSCAN": true, "HSTRLEN": true,
	"LRANGE": true, "LLEN": true, "LINDEX": true, "LPOS": true,
	"SMEMBERS": true, "SCARD": true, "SISMEMBER": true, "SMISMEMBER": true, "SSCAN": true, "SRANDMEMBER": true, "SINTER": true, "SUNION": true, "SDIFF": true,
	"ZRANGE": true, "ZREVRANGE": true, "ZRANGEBYSCORE": true, "ZREVRANGEBYSCORE": true, "ZCARD": true, "ZSCORE": true, "ZMSCORE": true, "ZRANK": true, "ZREVRANK": true, "ZCOUNT": true, "ZSCAN": true,
	"XRANGE": true, "XREVRANGE": true, "XLEN": true, "XINFO": true, "XREAD": true,
	"OBJECT": true, "MEMORY": true, "DUMP": true, "RANDOMKEY": true, "COMMAND": true, "CLIENT": true, "CONFIG": true, "SLOWLOG": true, "LASTSAVE": true,
}

func (r *conn) IsWrite(args []string) bool {
	if len(args) == 0 {
		return false
	}
	c := strings.ToUpper(args[0])
	sub := ""
	if len(args) > 1 {
		sub = strings.ToUpper(args[1])
	}
	// Admin commands that change the server without the "write" flag.
	switch c {
	case "FLUSHDB", "FLUSHALL", "SHUTDOWN", "DEBUG", "SWAPDB", "MIGRATE", "RESTORE", "EVAL", "EVALSHA", "FCALL", "SAVE", "BGSAVE", "BGREWRITEAOF", "REPLICAOF", "SLAVEOF", "FAILOVER", "ACL", "MODULE":
		return !(c == "ACL" && (sub == "WHOAMI" || sub == "LIST" || sub == "USERS" || sub == "CAT" || sub == "GETUSER"))
	case "CONFIG":
		return sub != "GET"
	case "CLIENT":
		return sub == "KILL" || sub == "PAUSE" || sub == "UNPAUSE" || sub == "NO-EVICT" || sub == "NO-TOUCH"
	case "SCRIPT", "FUNCTION":
		return sub != "EXISTS" && sub != "LIST" && sub != "DUMP" && sub != "STATS"
	case "SLOWLOG":
		return sub == "RESET"
	}
	if r.writes != nil {
		return r.writes[c]
	}
	return !readOnly[c]
}

func keyCount(n int64) string {
	if n == 1 {
		return "1 key"
	}
	return fmt.Sprintf("%d keys", n)
}

func (r *conn) Dump(ctx context.Context, db int, key string) (*driver.KeyData, error) {
	d, err := r.getKey(ctx, db, key, true)
	if err != nil || !d.Binary {
		return d, err
	}
	// JSON strings can't carry arbitrary bytes, so binary keys travel as base64.
	enc := func(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
	switch v := d.Value.(type) {
	case string:
		d.Value = enc(v)
	case []string:
		for i := range v {
			v[i] = enc(v[i])
		}
	case [][2]string:
		for i := range v {
			v[i] = [2]string{enc(v[i][0]), enc(v[i][1])}
		}
	case []driver.ZMember:
		for i := range v {
			v[i].Member = enc(v[i].Member)
		}
	case []driver.StreamEntry:
		for i, e := range v {
			f := make(map[string]string, len(e.Fields))
			for k, x := range e.Fields {
				f[enc(k)] = enc(x)
			}
			v[i].Fields = f
		}
	}
	d.Encoding = "base64"
	return d, nil
}

func (r *conn) Restore(ctx context.Context, db int, d driver.KeyData, replace bool) (bool, error) {
	cl := r.client(db)
	if !replace {
		if n, err := cl.Exists(ctx, d.Key).Result(); err != nil || n > 0 {
			return false, err
		}
	}
	dec := func(s string) (string, error) { return s, nil }
	if d.Encoding == "base64" {
		dec = func(s string) (string, error) {
			b, err := base64.StdEncoding.DecodeString(s)
			return string(b), err
		}
	}
	// str reads a (decoded) string from JSON-decoded data.
	var bad error
	str := func(v any) string {
		s, ok := v.(string)
		if !ok {
			s = fmt.Sprint(v)
		}
		out, err := dec(s)
		if err != nil && bad == nil {
			bad = err
		}
		return out
	}
	list, _ := d.Value.([]any)
	const chunk = 500
	p := cl.TxPipeline()
	p.Del(ctx, d.Key)
	add := func(cmd func(args []any), per int, item func(v any) []any) {
		var args []any
		for _, v := range list {
			args = append(args, item(v)...)
			if len(args) >= chunk*per {
				cmd(args)
				args = nil
			}
		}
		if len(args) > 0 {
			cmd(args)
		}
	}
	switch d.Type {
	case "string":
		p.Set(ctx, d.Key, str(d.Value), 0)
	case "hash":
		add(func(a []any) { p.HSet(ctx, d.Key, a...) }, 2, func(v any) []any {
			kv, _ := v.([]any)
			if len(kv) != 2 {
				bad = errors.New("hash items must be [field, value] pairs")
				return nil
			}
			return []any{str(kv[0]), str(kv[1])}
		})
	case "list":
		add(func(a []any) { p.RPush(ctx, d.Key, a...) }, 1, func(v any) []any { return []any{str(v)} })
	case "set":
		add(func(a []any) { p.SAdd(ctx, d.Key, a...) }, 1, func(v any) []any { return []any{str(v)} })
	case "zset":
		var zs []redis.Z
		for _, v := range list {
			m, _ := v.(map[string]any)
			score, _ := m["score"].(float64)
			zs = append(zs, redis.Z{Member: str(m["member"]), Score: score})
		}
		for i := 0; i < len(zs); i += chunk {
			p.ZAdd(ctx, d.Key, zs[i:min(i+chunk, len(zs))]...)
		}
	case "stream":
		for _, v := range list {
			m, _ := v.(map[string]any)
			fields, _ := m["fields"].(map[string]any)
			vals := make([]any, 0, len(fields)*2)
			for k, x := range fields {
				vals = append(vals, str(k), str(x))
			}
			id, _ := m["id"].(string)
			p.XAdd(ctx, &redis.XAddArgs{Stream: d.Key, ID: id, Values: vals})
		}
	default:
		return false, fmt.Errorf("%s: type %q can't be imported", d.Key, d.Type)
	}
	if bad != nil {
		return false, fmt.Errorf("%s: %w", d.Key, bad)
	}
	if d.TTL > 0 {
		p.PExpire(ctx, d.Key, time.Duration(d.TTL)*time.Millisecond)
	}
	if _, err := p.Exec(ctx); err != nil {
		return false, fmt.Errorf("%s: %w", d.Key, err)
	}
	return true, nil
}
