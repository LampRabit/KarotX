package driver

import "context"

// Transfer is implemented by SQL drivers for export and import.
type Transfer interface {
	// StreamRows runs one statement in a read-only session and calls row for
	// every row. Values are JSON-friendly, except binary data, which stays []byte.
	StreamRows(ctx context.Context, query, schema string, head func([]Column) error, row func([]any) error) error
	// CreateTableSQL returns a CREATE TABLE statement for t (unqualified, for dumps).
	CreateTableSQL(ctx context.Context, t TableRef) (string, error)
	// InsertRows inserts rows (values in cols order) in one transaction,
	// first deleting every existing row when clear is set.
	InsertRows(ctx context.Context, t TableRef, cols []string, rows [][]any, clear bool) (int64, error)
	// ExecScript runs a SQL script statement by statement on one session.
	// progress is called after each statement with its error, if any.
	ExecScript(ctx context.Context, script, schema string, continueOnError bool, progress func(done, total int, err error, stmt string)) error
	Quote(id string) string
	// Literal renders a value as a SQL literal in this dialect.
	Literal(v any) string
}
