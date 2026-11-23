package driver

import (
	"context"
	"encoding/json"
)

// Document is implemented by document databases (MongoDB, DynamoDB).
// MongoDB documents travel as Extended JSON (relaxed), so ObjectIds and dates
// round-trip; DynamoDB uses tagged objects for its non-JSON types.
type Document interface {
	Conn
	TableLister // collections of a database, with estimated counts
	Find(ctx context.Context, db, coll string, q FindRequest) (*FindResult, error)
	// Fields samples documents and reports field paths with their most common type.
	Fields(ctx context.Context, db, coll string) ([]FieldInfo, error)
	Insert(ctx context.Context, db, coll string, docs []json.RawMessage) (int, error)
	// Replace swaps the document with this _id (given as Extended JSON) for doc.
	Replace(ctx context.Context, db, coll string, id json.RawMessage, doc json.RawMessage) error
	Delete(ctx context.Context, db, coll string, ids []json.RawMessage) (int64, error)
	Aggregate(ctx context.Context, db, coll string, pipeline json.RawMessage, limit int) ([]json.RawMessage, error)
	RunCommand(ctx context.Context, db string, cmd json.RawMessage) (json.RawMessage, error)
	// ClassifyCommand reports whether a console command only reads, and how to show it.
	ClassifyCommand(cmd json.RawMessage) (read bool, label string)
	// CreateCollection creates a collection; keys are its key attributes (DynamoDB only).
	CreateCollection(ctx context.Context, db, coll string, keys []KeyAttr) error
	DropCollection(ctx context.Context, db, coll string) error
	DropDatabase(ctx context.Context, db string) error
	// Each streams every matching document (no limit unless q.Limit > 0), for export.
	Each(ctx context.Context, db, coll string, q FindRequest, fn func(json.RawMessage) error) error
	// DeleteAll removes every document of a collection, keeping its indexes.
	DeleteAll(ctx context.Context, db, coll string) (int64, error)
}

type FindRequest struct {
	Filter     json.RawMessage `json:"filter,omitempty"` // {} when empty
	Sort       json.RawMessage `json:"sort,omitempty"`
	Projection json.RawMessage `json:"projection,omitempty"`
	Skip       int64           `json:"skip"`
	Limit      int64           `json:"limit"`
}

// KeyAttr is a DynamoDB key attribute: Type is S, N or B.
type KeyAttr struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type FindResult struct {
	Docs []json.RawMessage `json:"docs"`
	// Key lists the fields that identify a document (DynamoDB); empty = "_id".
	Key        []string `json:"key,omitempty"`
	Total      int64    `json:"total"`
	Estimated  bool     `json:"estimated"` // total is an estimate (no filter, or the count timed out)
	DurationMs float64  `json:"durationMs"`
}

type FieldInfo struct {
	Path string `json:"path"` // dotted, e.g. "address.city"
	Type string `json:"type"` // string | number | bool | date | objectId | object | array | null
}
