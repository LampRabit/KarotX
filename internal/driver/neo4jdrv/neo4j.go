// Package neo4jdrv implements the Neo4j driver (graph capability) over Bolt.
package neo4jdrv

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"math"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/neo4j/neo4j-go-driver/v6/neo4j"
	"github.com/neo4j/neo4j-go-driver/v6/neo4j/config"
	"github.com/neo4j/neo4j-go-driver/v6/neo4j/dbtype"

	"github.com/lamprabit/karotx/internal/driver"
)

func init() { driver.Register("neo4j", Driver{}) }

type Driver struct{}

type conn struct {
	drv   neo4j.Driver
	defDB string
	info  driver.Info
	fwd   net.Listener // local end of an SSH tunnel; nil when direct
}

func (Driver) Open(ctx context.Context, p driver.OpenParams) (driver.Conn, error) {
	c := p.Conn
	port := c.Port
	if port == 0 {
		port = 7687
	}
	host := c.Host
	g := &conn{defDB: c.Database}
	scheme := "neo4j" // routing: works for single servers, clusters and Aura
	if p.Dial != nil {
		// The Go driver can't take a dialer, so tunnels go through a local
		// forwarder, and routing is off (the cluster's addresses aren't reachable).
		ln, err := forward(p.Dial, net.JoinHostPort(c.Host, strconv.Itoa(port)))
		if err != nil {
			return nil, err
		}
		g.fwd = ln
		h, pt, _ := net.SplitHostPort(ln.Addr().String())
		host, port, scheme = h, atoi(pt), "bolt"
	}
	switch c.TLS.Mode {
	case "require":
		scheme += "+ssc" // encrypted, any certificate
	case "verify":
		if c.TLS.CAFile == "" && c.TLS.CertFile == "" {
			scheme += "+s"
		}
	}
	configure := func(cfg *config.Config) {
		cfg.SocketConnectTimeout = 15 * time.Second
		cfg.MaxConnectionPoolSize = 8
		if c.TLS.Mode == "verify" && (c.TLS.CAFile != "" || c.TLS.CertFile != "") {
			if t, err := driver.TLSConfig(c.Host, true, c.TLS.CAFile, c.TLS.CertFile, c.TLS.KeyFile); err == nil {
				cfg.TlsConfig = t
			}
		}
	}
	user := c.User
	if user == "" {
		user = "neo4j"
	}
	drv, err := neo4j.NewDriver(fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(host, strconv.Itoa(port))), neo4j.BasicAuth(user, p.Password, ""), configure)
	if err != nil {
		g.Close()
		return nil, err
	}
	g.drv = drv
	si, err := drv.GetServerInfo(ctx)
	if err != nil {
		g.Close()
		return nil, err
	}
	g.info = driver.Info{Dialect: "neo4j", ServerVersion: strings.Replace(si.Agent(), "/", " ", 1), Database: c.Database}
	return g, nil
}

func atoi(s string) int { n, _ := strconv.Atoi(s); return n }

// forward listens on 127.0.0.1 and pipes each connection through dial.
func forward(dial driver.DialFunc, addr string) (net.Listener, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	go func() {
		for {
			local, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer local.Close()
				remote, err := dial(context.Background(), "tcp", addr)
				if err != nil {
					return
				}
				defer remote.Close()
				go io.Copy(remote, local)
				io.Copy(local, remote)
			}()
		}
	}()
	return ln, nil
}

func (g *conn) Info() driver.Info { return g.info }

func (g *conn) Ping(ctx context.Context) error { return g.drv.VerifyConnectivity(ctx) }

func (g *conn) Close() error {
	var err error
	if g.drv != nil {
		err = g.drv.Close(context.Background())
	}
	if g.fwd != nil {
		g.fwd.Close()
	}
	return err
}

// rows runs a read query and returns its raw records' values.
func (g *conn) rows(ctx context.Context, db, q string, params map[string]any) ([][]any, error) {
	s := g.drv.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead, DatabaseName: db})
	defer s.Close(ctx)
	res, err := s.Run(ctx, q, params)
	if err != nil {
		return nil, err
	}
	var out [][]any
	for res.Next(ctx) {
		out = append(out, res.Record().Values)
	}
	return out, res.Err()
}

func quote(name string) string { return "`" + strings.ReplaceAll(name, "`", "``") + "`" }

// Tree: databases → labels and relationship types (with counts).
func (g *conn) Tree(ctx context.Context, path []string) ([]driver.Node, error) {
	switch len(path) {
	case 0:
		var names []string
		rows, err := g.rows(ctx, "system", "SHOW DATABASES YIELD name, type WHERE type <> 'system' RETURN DISTINCT name ORDER BY name", nil)
		for _, r := range rows {
			names = append(names, fmt.Sprint(r[0]))
		}
		if err != nil || len(names) == 0 { // no access to the system database
			names = []string{cmpOr(g.defDB, "neo4j")}
		}
		nodes := make([]driver.Node, len(names))
		for i, n := range names {
			nodes[i] = driver.Node{Name: n, Kind: "database", Path: []string{n}, HasChildren: true}
		}
		return nodes, nil
	case 1:
		db := path[0]
		var nodes []driver.Node
		for _, kind := range []string{"label", "reltype"} {
			q, count := "CALL db.labels() YIELD label RETURN label", "MATCH (n:%s) RETURN count(n)"
			if kind == "reltype" {
				q, count = "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType", "MATCH ()-[r:%s]->() RETURN count(r)"
			}
			rows, err := g.rows(ctx, db, q, nil)
			if err != nil {
				return nil, err
			}
			names := make([]string, len(rows))
			for i, r := range rows {
				names[i] = fmt.Sprint(r[0])
			}
			sort.Strings(names)
			for _, n := range names {
				detail := ""
				if c, err := g.rows(ctx, db, fmt.Sprintf(count, quote(n)), nil); err == nil && len(c) == 1 { // count store: instant
					word := map[string]string{"label": "node", "reltype": "rel"}[kind]
					v, _ := c[0][0].(int64)
					detail = strconv.FormatInt(v, 10) + " " + word
					if v != 1 {
						detail += "s"
					}
				}
				nodes = append(nodes, driver.Node{Name: n, Kind: kind, Path: []string{db, n}, Detail: detail})
			}
		}
		if nodes == nil {
			nodes = []driver.Node{}
		}
		return nodes, nil
	}
	return []driver.Node{}, nil
}

func cmpOr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// params converts JSON numbers: whole numbers become integers (Cypher's
// SKIP/LIMIT and ids need them; JSON can't tell 2 from 2.0).
func params(m map[string]any) map[string]any {
	var conv func(v any) any
	conv = func(v any) any {
		switch x := v.(type) {
		case float64:
			if x == math.Trunc(x) && math.Abs(x) < 1<<53 {
				return int64(x)
			}
		case []any:
			for i := range x {
				x[i] = conv(x[i])
			}
		case map[string]any:
			for k := range x {
				x[k] = conv(x[k])
			}
		}
		return v
	}
	for k := range m {
		m[k] = conv(m[k])
	}
	return m
}

func (g *conn) Run(ctx context.Context, db, query string, p map[string]any, write bool, maxRows int) (*driver.GraphResult, error) {
	if maxRows <= 0 {
		maxRows = 1000
	}
	mode := neo4j.AccessModeRead
	if write {
		mode = neo4j.AccessModeWrite
	}
	start := time.Now()
	s := g.drv.NewSession(ctx, neo4j.SessionConfig{AccessMode: mode, DatabaseName: cmpOr(db, g.defDB)})
	defer s.Close(ctx)
	// An explicit transaction, so a read can be rolled back; CALL { … } IN
	// TRANSACTIONS needs an auto-commit one.
	auto := write && strings.Contains(strings.ToUpper(query), "IN TRANSACTIONS")
	var tx neo4j.ExplicitTransaction
	var res neo4j.Result
	var err error
	if auto {
		res, err = s.Run(ctx, query, params(p))
	} else if tx, err = s.BeginTransaction(ctx); err == nil {
		defer tx.Close(ctx)
		res, err = tx.Run(ctx, query, params(p))
	}
	if err != nil {
		return nil, err
	}
	keys, err := res.Keys()
	if err != nil {
		return nil, err
	}
	out := &driver.GraphResult{Columns: keys, Rows: [][]any{}, Nodes: []driver.GraphNode{}, Rels: []driver.GraphRel{}}
	b := builder{out: out, nodes: map[string]bool{}, rels: map[string]bool{}}
	for res.Next(ctx) {
		if len(out.Rows) == maxRows {
			out.Truncated = true
			break
		}
		vals := res.Record().Values
		row := make([]any, len(vals))
		for i, v := range vals {
			row[i] = b.value(v)
		}
		out.Rows = append(out.Rows, row)
	}
	if err := res.Err(); err != nil {
		return nil, err
	}
	sum, err := res.Consume(ctx)
	if err != nil {
		return nil, err
	}
	switch {
	case auto:
	case !write:
		tx.Rollback(ctx)
	default:
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
	}
	out.Summary = summary(sum.Counters())
	out.DurationMs = float64(time.Since(start).Microseconds()) / 1000
	return out, nil
}

func summary(c neo4j.Counters) string {
	var parts []string
	add := func(n int, one, many, done string) {
		if n == 1 {
			parts = append(parts, "1 "+one+" "+done)
		} else if n > 1 {
			parts = append(parts, strconv.Itoa(n)+" "+many+" "+done)
		}
	}
	add(c.NodesCreated(), "node", "nodes", "created")
	add(c.NodesDeleted(), "node", "nodes", "deleted")
	add(c.RelationshipsCreated(), "relationship", "relationships", "created")
	add(c.RelationshipsDeleted(), "relationship", "relationships", "deleted")
	add(c.PropertiesSet(), "property", "properties", "set")
	add(c.LabelsAdded(), "label", "labels", "added")
	add(c.LabelsRemoved(), "label", "labels", "removed")
	add(c.IndexesAdded(), "index", "indexes", "added")
	add(c.IndexesRemoved(), "index", "indexes", "removed")
	add(c.ConstraintsAdded(), "constraint", "constraints", "added")
	add(c.ConstraintsRemoved(), "constraint", "constraints", "removed")
	return strings.Join(parts, ", ")
}

type builder struct {
	out   *driver.GraphResult
	nodes map[string]bool
	rels  map[string]bool
}

func (b *builder) node(n dbtype.Node) string {
	if !b.nodes[n.ElementId] {
		b.nodes[n.ElementId] = true
		b.out.Nodes = append(b.out.Nodes, driver.GraphNode{ID: n.ElementId, Labels: n.Labels, Props: b.props(n.Props)})
	}
	return n.ElementId
}

func (b *builder) rel(r dbtype.Relationship) string {
	if !b.rels[r.ElementId] {
		b.rels[r.ElementId] = true
		b.out.Rels = append(b.out.Rels, driver.GraphRel{ID: r.ElementId, Type: r.Type, Start: r.StartElementId, End: r.EndElementId, Props: b.props(r.Props)})
	}
	return r.ElementId
}

func (b *builder) props(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = b.value(v)
	}
	return out
}

const maxSafeInt = 1<<53 - 1

// value turns a Neo4j value into JSON. Big integers and temporal/spatial
// types become strings; byte arrays become {"$binary": base64}.
func (b *builder) value(v any) any {
	switch x := v.(type) {
	case nil, bool, string, float64:
		return x
	case int64:
		if x > maxSafeInt || x < -maxSafeInt {
			return strconv.FormatInt(x, 10)
		}
		return x
	case []byte:
		return map[string]any{"$binary": base64.StdEncoding.EncodeToString(x)}
	case dbtype.Node:
		return map[string]any{"$node": b.node(x)}
	case dbtype.Relationship:
		return map[string]any{"$rel": b.rel(x)}
	case dbtype.Path:
		ids := []string{}
		for i, n := range x.Nodes {
			ids = append(ids, b.node(n))
			if i < len(x.Relationships) {
				ids = append(ids, b.rel(x.Relationships[i]))
			}
		}
		return map[string]any{"$path": ids}
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = b.value(e)
		}
		return out
	case map[string]any:
		return b.props(x)
	case fmt.Stringer: // dates, times, durations, points, UUIDs
		return x.String()
	}
	return fmt.Sprint(v)
}

var _ driver.Graph = (*conn)(nil)
