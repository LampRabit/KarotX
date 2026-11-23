package driver

import (
	"context"
	"regexp"
	"strings"
)

// Graph is implemented by graph databases (Neo4j). Queries are Cypher; nodes
// and relationships in rows are also collected into Nodes/Rels for drawing.
type Graph interface {
	Conn
	// Run executes one Cypher query on database db. write=false runs it in a
	// read-only transaction, so a write that slipped past IsCypherWrite fails.
	Run(ctx context.Context, db, query string, params map[string]any, write bool, maxRows int) (*GraphResult, error)
}

type GraphNode struct {
	ID     string         `json:"id"` // elementId
	Labels []string       `json:"labels"`
	Props  map[string]any `json:"props"`
}

type GraphRel struct {
	ID    string         `json:"id"`
	Type  string         `json:"type"`
	Start string         `json:"start"`
	End   string         `json:"end"`
	Props map[string]any `json:"props"`
}

// GraphResult rows hold plain JSON values, except nodes ({"$node": id}),
// relationships ({"$rel": id}) and paths ({"$path": [ids…]}), which point
// into Nodes and Rels.
type GraphResult struct {
	Columns    []string    `json:"columns"`
	Rows       [][]any     `json:"rows"`
	Nodes      []GraphNode `json:"nodes"`
	Rels       []GraphRel  `json:"rels"`
	Truncated  bool        `json:"truncated,omitempty"`
	Summary    string      `json:"summary,omitempty"` // e.g. "2 nodes created, 1 property set"
	DurationMs float64     `json:"durationMs"`
}

var (
	cypherNoise = regexp.MustCompile("(?s)//[^\n]*|/\\*.*?\\*/|'(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\"|`[^`]*`")
	cypherWrite = regexp.MustCompile(`(?i)\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|FOREACH|LOAD\s+CSV|ALTER|RENAME|GRANT|DENY|REVOKE|START|STOP|TERMINATE|ENABLE)\b`)
)

// IsCypherWrite reports whether a Cypher query (probably) changes data or the
// server. Strings, comments and `quoted` names are ignored. Procedures that
// write are caught by the read-only transaction instead.
func IsCypherWrite(q string) bool {
	return cypherWrite.MatchString(cypherNoise.ReplaceAllString(q, " ")) || strings.Contains(strings.ToUpper(q), "IN TRANSACTIONS")
}
