package neo4jdrv

import (
	"context"
	"net"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
)

func TestIsCypherWrite(t *testing.T) {
	for q, want := range map[string]bool{
		"MATCH (n:Person) WHERE n.name STARTS WITH 'Cre' RETURN n": false,
		"MATCH (n) RETURN n.`SET` // DELETE later":                 false,
		"MATCH (n {name: 'CREATE'}) RETURN n":                      false,
		"match (n) detach delete n":                                true,
		"MERGE (a:A {id: 1})":                                      true,
		"MATCH (n) SET n.x = 1":                                    true,
		"SHOW SETTINGS":                                            false,
	} {
		if got := driver.IsCypherWrite(q); got != want {
			t.Errorf("%s: got %v", q, got)
		}
	}
}

// KAROTX_IT_NEO4J=host:port:password runs against a real server.
func TestLiveNeo4j(t *testing.T) {
	spec := os.Getenv("KAROTX_IT_NEO4J")
	if spec == "" {
		t.Skip("set KAROTX_IT_NEO4J to run")
	}
	parts := strings.SplitN(spec, ":", 3)
	port, _ := strconv.Atoi(parts[1])
	ctx := context.Background()
	open := func(dial driver.DialFunc) driver.Graph {
		t.Helper()
		c, err := Driver{}.Open(ctx, driver.OpenParams{Conn: model.Connection{Driver: "neo4j", Host: parts[0], Port: port, User: "neo4j"}, Password: parts[2], Dial: dial})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		return c.(driver.Graph)
	}
	g := open(nil)
	if !strings.HasPrefix(g.Info().ServerVersion, "Neo4j ") {
		t.Errorf("version %q", g.Info().ServerVersion)
	}
	run := func(q string, p map[string]any, write bool) *driver.GraphResult {
		t.Helper()
		r, err := g.Run(ctx, "", q, p, write, 100)
		if err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return r
	}
	run("MATCH (n:KxTest) DETACH DELETE n", nil, true)
	r := run("CREATE (a:KxTest {name: 'Ann', n: $n})-[:KNOWS {since: 2020}]->(b:KxTest {name: 'Bob'}) RETURN a, b", map[string]any{"n": float64(3)}, true)
	if r.Summary != "2 nodes created, 1 relationship created, 4 properties set, 2 labels added" || len(r.Nodes) != 2 {
		t.Errorf("create: %q %+v", r.Summary, r.Nodes)
	}
	r = run("MATCH p = (:KxTest)-[:KNOWS]->(:KxTest) RETURN p, length(p) AS len SKIP $s LIMIT $l", map[string]any{"s": float64(0), "l": float64(10)}, false)
	if len(r.Rows) != 1 || len(r.Nodes) != 2 || len(r.Rels) != 1 || r.Rows[0][1] != int64(1) {
		t.Fatalf("path: %+v", r)
	}
	if _, err := g.Run(ctx, "", "CREATE (:KxTest)", nil, false, 10); err == nil {
		t.Error("a write ran in a read transaction")
	}
	nodes, err := g.Tree(ctx, []string{"neo4j"})
	found := false
	for _, n := range nodes {
		found = found || (n.Kind == "label" && n.Name == "KxTest" && n.Detail == "2 nodes")
	}
	if err != nil || !found {
		t.Errorf("tree: %+v %v", nodes, err)
	}
	// Through a dialer (as an SSH tunnel would), via the local forwarder.
	tg := open(func(ctx context.Context, network, addr string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	})
	if r, err := tg.Run(ctx, "", "MATCH (n:KxTest) RETURN count(n)", nil, false, 1); err != nil || r.Rows[0][0] != int64(2) {
		t.Errorf("tunnelled: %+v %v", r, err)
	}
	run("MATCH (n:KxTest) DETACH DELETE n", nil, true)
}
