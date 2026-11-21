package driver

import (
	"context"
	"errors"
	"strings"
)

// KeyValue is implemented by key-value stores (Redis). db selects the
// logical database (Redis: 0–15 by default).
type KeyValue interface {
	Conn
	// Scan returns a page of keys matching pattern (glob), optionally of one type.
	Scan(ctx context.Context, db int, pattern, cursor string, count int, typ string) (*KeyPage, error)
	// GetKey reads a key with its type, TTL and (first part of its) value.
	GetKey(ctx context.Context, db int, key string) (*KeyData, error)
	// Do runs one command (e.g. ["HSET", "user:1", "name", "Ann"]).
	Do(ctx context.Context, db int, args []string) (any, error)
	// IsWrite reports whether a command modifies data or the server (for read-only and production guards).
	IsWrite(args []string) bool
	// DBSize counts keys in a database.
	DBSize(ctx context.Context, db int) (int64, error)
	// Dump reads a whole key for export. Binary values are base64 with Encoding set.
	Dump(ctx context.Context, db int, key string) (*KeyData, error)
	// Restore writes a dumped key. An existing key is replaced, or left alone
	// (returning false) unless replace is set.
	Restore(ctx context.Context, db int, d KeyData, replace bool) (bool, error)
}

type KeyInfo struct {
	Key  string `json:"key"`
	Type string `json:"type"`
	TTL  int64  `json:"ttl"` // milliseconds; -1 = no expiry
}

type KeyPage struct {
	Keys   []KeyInfo `json:"keys"`
	Cursor string    `json:"cursor"` // "0" = scan finished
}

// KeyData is a key's value, shaped by type:
//   - string: string
//   - hash:   [][2]string  (field, value)
//   - list:   []string
//   - set:    []string
//   - zset:   []ZMember
//   - stream: []StreamEntry
type KeyData struct {
	Key       string `json:"key"`
	Type      string `json:"type"`
	TTL       int64  `json:"ttl"`
	Length    int64  `json:"length"` // string bytes, or number of items
	Value     any    `json:"value"`
	Truncated bool   `json:"truncated"`          // only the first part of a large value is returned
	Binary    bool   `json:"binary"`             // contains non-UTF-8 bytes (shown read-only)
	Encoding  string `json:"encoding,omitempty"` // Dump only: "base64" when strings are base64-encoded
}

type ZMember struct {
	Member string  `json:"member"`
	Score  float64 `json:"score"`
}

type StreamEntry struct {
	ID     string            `json:"id"`
	Fields map[string]string `json:"fields"`
}

// SplitCommand splits a console line into arguments, honouring "double" and
// 'single' quotes and backslash escapes inside double quotes.
func SplitCommand(line string) ([]string, error) {
	var args []string
	var cur strings.Builder
	inArg, quote := false, byte(0)
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case quote == '"' && c == '\\' && i+1 < len(line):
			i++
			switch line[i] {
			case 'n':
				cur.WriteByte('\n')
			case 't':
				cur.WriteByte('\t')
			default:
				cur.WriteByte(line[i])
			}
		case quote != 0 && c == quote:
			quote = 0
		case quote != 0:
			cur.WriteByte(c)
		case c == '"' || c == '\'':
			quote, inArg = c, true
		case c == ' ' || c == '\t' || c == '\n':
			if inArg {
				args = append(args, cur.String())
				cur.Reset()
				inArg = false
			}
		default:
			cur.WriteByte(c)
			inArg = true
		}
	}
	if quote != 0 {
		return nil, errors.New("unclosed quote")
	}
	if inArg {
		args = append(args, cur.String())
	}
	return args, nil
}
