// Package mongodrv implements the MongoDB driver (document capability).
package mongodrv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
)

func init() { driver.Register("mongodb", Driver{}) }

type Driver struct{}

type conn struct {
	client *mongo.Client
	info   driver.Info
	defDB  string
}

func (Driver) Open(ctx context.Context, p driver.OpenParams) (driver.Conn, error) {
	return Open(ctx, p)
}

// URI builds the connection string (password included only in memory).
func URI(c model.Connection, password string) string {
	u := url.URL{Scheme: "mongodb", Host: c.Host}
	if c.SRV {
		u.Scheme = "mongodb+srv"
	} else {
		port := c.Port
		if port == 0 {
			port = 27017
		}
		if !strings.Contains(c.Host, ",") { // a seed list already carries ports
			u.Host = net.JoinHostPort(c.Host, strconv.Itoa(port))
		}
	}
	if c.User != "" {
		u.User = url.UserPassword(c.User, password)
	}
	u.Path = "/"
	if c.Database != "" {
		u.Path = "/" + c.Database
	}
	q := url.Values{}
	for k, v := range c.Params {
		if v != "" { // empty form fields are not options
			q.Set(k, v)
		}
	}
	if c.TLS.Mode == "off" {
		q.Set("tls", "false")
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// Open connects and returns the document capability.
func Open(ctx context.Context, p driver.OpenParams) (driver.Document, error) {
	c := p.Conn
	o := options.Client().ApplyURI(URI(c, p.Password)).
		SetAppName("KarotX").
		SetConnectTimeout(15 * time.Second).
		SetServerSelectionTimeout(15 * time.Second)
	if c.TLS.Mode == "require" || c.TLS.Mode == "verify" {
		t, err := driver.TLSConfig(strings.Split(c.Host, ",")[0], c.TLS.Mode == "verify", c.TLS.CAFile, c.TLS.CertFile, c.TLS.KeyFile)
		if err != nil {
			return nil, err
		}
		o.SetTLSConfig(t)
	}
	if p.Dial != nil {
		o.SetDialer(dialer(p.Dial))
	}
	client, err := mongo.Connect(o)
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		client.Disconnect(context.Background())
		return nil, err
	}
	m := &conn{client: client, defDB: c.Database}
	version := "MongoDB"
	var bi struct {
		Version string `bson:"version"`
	}
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&bi); err == nil && bi.Version != "" {
		version = "MongoDB " + bi.Version
	}
	m.info = driver.Info{Dialect: "mongodb", ServerVersion: version, Database: c.Database}
	return m, nil
}

type dialer driver.DialFunc

func (d dialer) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	return d(ctx, network, addr)
}

func (m *conn) Info() driver.Info              { return m.info }
func (m *conn) Ping(ctx context.Context) error { return m.client.Ping(ctx, nil) }
func (m *conn) Close() error                   { return m.client.Disconnect(context.Background()) }

// Tree: databases → collections (and views).
func (m *conn) Tree(ctx context.Context, path []string) ([]driver.Node, error) {
	switch len(path) {
	case 0:
		names, err := m.client.ListDatabaseNames(ctx, bson.D{})
		if err != nil {
			if m.defDB == "" {
				return nil, err
			}
			names = []string{m.defDB} // no permission to list: show the configured database
		}
		nodes := make([]driver.Node, len(names))
		for i, n := range names {
			nodes[i] = driver.Node{Name: n, Kind: "database", Path: []string{n}, HasChildren: true}
		}
		return nodes, nil
	case 1:
		specs, err := m.client.Database(path[0]).ListCollectionSpecifications(ctx, bson.D{})
		if err != nil {
			return nil, err
		}
		sort.Slice(specs, func(i, j int) bool { return specs[i].Name < specs[j].Name })
		nodes := make([]driver.Node, 0, len(specs))
		for _, s := range specs {
			if strings.HasPrefix(s.Name, "system.") {
				continue
			}
			kind := "table"
			if s.Type == "view" {
				kind = "view"
			}
			nodes = append(nodes, driver.Node{Name: s.Name, Kind: kind, Path: []string{path[0], s.Name}})
		}
		return nodes, nil
	}
	return []driver.Node{}, nil
}

// Tables lists collections with estimated document counts and storage size.
func (m *conn) Tables(ctx context.Context, db string) ([]driver.TableInfo, error) {
	specs, err := m.client.Database(db).ListCollectionSpecifications(ctx, bson.D{})
	if err != nil {
		return nil, err
	}
	sort.Slice(specs, func(i, j int) bool { return specs[i].Name < specs[j].Name })
	out := []driver.TableInfo{}
	for _, s := range specs {
		if strings.HasPrefix(s.Name, "system.") {
			continue
		}
		t := driver.TableInfo{Name: s.Name, Kind: "table"}
		if s.Type == "view" {
			t.Kind = "view"
		} else {
			cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
			coll := m.client.Database(db).Collection(s.Name)
			if n, err := coll.EstimatedDocumentCount(cctx); err == nil {
				t.Rows = &n
			}
			if cur, err := coll.Aggregate(cctx, mongo.Pipeline{{{Key: "$collStats", Value: bson.D{{Key: "storageStats", Value: bson.D{}}}}}}); err == nil {
				var st []struct {
					Storage struct {
						Size      int64 `bson:"size"`
						IndexSize int64 `bson:"totalIndexSize"`
					} `bson:"storageStats"`
				}
				if cur.All(cctx, &st) == nil && len(st) > 0 {
					b := st[0].Storage.Size + st[0].Storage.IndexSize
					t.Bytes = &b
				}
			}
			cancel()
		}
		out = append(out, t)
	}
	return out, nil
}

// parse decodes Extended JSON into BSON; empty input means {}.
func parse(raw json.RawMessage) (bson.D, error) {
	d := bson.D{}
	if len(strings.TrimSpace(string(raw))) == 0 || string(raw) == "null" {
		return d, nil
	}
	if err := bson.UnmarshalExtJSON(raw, false, &d); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	return d, nil
}

func ext(raw bson.Raw) json.RawMessage {
	b, err := bson.MarshalExtJSON(raw, false, false)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return b
}

func (m *conn) Find(ctx context.Context, db, coll string, q driver.FindRequest) (*driver.FindResult, error) {
	filter, err := parse(q.Filter)
	if err != nil {
		return nil, err
	}
	if q.Limit <= 0 || q.Limit > 1000 {
		q.Limit = 50
	}
	o := options.Find().SetSkip(q.Skip).SetLimit(q.Limit)
	if s, err := parse(q.Sort); err != nil {
		return nil, err
	} else if len(s) > 0 {
		o.SetSort(s)
	}
	if p, err := parse(q.Projection); err != nil {
		return nil, err
	} else if len(p) > 0 {
		o.SetProjection(p)
	}
	c := m.client.Database(db).Collection(coll)
	start := time.Now()
	cur, err := c.Find(ctx, filter, o)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	res := &driver.FindResult{Docs: []json.RawMessage{}}
	for cur.Next(ctx) {
		res.Docs = append(res.Docs, ext(cur.Current))
	}
	if err := cur.Err(); err != nil {
		return nil, err
	}
	res.DurationMs = float64(time.Since(start).Microseconds()) / 1000
	// Exact count when filtered (bounded in time), estimate otherwise.
	if len(filter) == 0 {
		res.Total, _ = c.EstimatedDocumentCount(ctx)
		res.Estimated = true
	} else {
		cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		n, err := c.CountDocuments(cctx, filter)
		if err != nil {
			res.Total, res.Estimated = q.Skip+int64(len(res.Docs)), true
		} else {
			res.Total = n
		}
	}
	return res, nil
}

func typeName(v bson.RawValue) string {
	switch v.Type {
	case bson.TypeString, bson.TypeSymbol:
		return "string"
	case bson.TypeInt32, bson.TypeInt64, bson.TypeDouble, bson.TypeDecimal128:
		return "number"
	case bson.TypeBoolean:
		return "bool"
	case bson.TypeDateTime, bson.TypeTimestamp:
		return "date"
	case bson.TypeObjectID:
		return "objectId"
	case bson.TypeEmbeddedDocument:
		return "object"
	case bson.TypeArray:
		return "array"
	case bson.TypeNull:
		return "null"
	}
	return "other"
}

// Fields samples up to 200 documents and returns each field path (two levels
// deep) with its most frequent type, in first-seen order.
func (m *conn) Fields(ctx context.Context, db, coll string) ([]driver.FieldInfo, error) {
	cur, err := m.client.Database(db).Collection(coll).Find(ctx, bson.D{}, options.Find().SetLimit(200))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var order []string
	counts := map[string]map[string]int{}
	note := func(path, typ string) {
		if counts[path] == nil {
			counts[path] = map[string]int{}
			order = append(order, path)
		}
		counts[path][typ]++
	}
	for cur.Next(ctx) {
		elems, _ := cur.Current.Elements()
		for _, e := range elems {
			v := e.Value()
			note(e.Key(), typeName(v))
			if v.Type == bson.TypeEmbeddedDocument {
				sub, _ := v.Document().Elements()
				for _, s := range sub {
					note(e.Key()+"."+s.Key(), typeName(s.Value()))
				}
			}
		}
	}
	out := make([]driver.FieldInfo, 0, len(order))
	for _, p := range order {
		best, n := "other", 0
		for t, c := range counts[p] {
			if t != "null" && c > n {
				best, n = t, c
			}
		}
		if n == 0 {
			best = "null"
		}
		out = append(out, driver.FieldInfo{Path: p, Type: best})
	}
	return out, cur.Err()
}

func (m *conn) Insert(ctx context.Context, db, coll string, docs []json.RawMessage) (int, error) {
	parsed := make([]any, len(docs))
	for i, d := range docs {
		p, err := parse(d)
		if err != nil {
			return 0, err
		}
		parsed[i] = p
	}
	res, err := m.client.Database(db).Collection(coll).InsertMany(ctx, parsed)
	if err != nil {
		return 0, err
	}
	return len(res.InsertedIDs), nil
}

// idFilter turns an Extended JSON _id value into {_id: value}.
func idFilter(id json.RawMessage) (bson.D, error) {
	var wrap bson.D
	if err := bson.UnmarshalExtJSON([]byte(`{"_id":`+string(id)+`}`), false, &wrap); err != nil {
		return nil, fmt.Errorf("invalid _id: %w", err)
	}
	return wrap, nil
}

func (m *conn) Replace(ctx context.Context, db, coll string, id json.RawMessage, doc json.RawMessage) error {
	f, err := idFilter(id)
	if err != nil {
		return err
	}
	d, err := parse(doc)
	if err != nil {
		return err
	}
	res, err := m.client.Database(db).Collection(coll).ReplaceOne(ctx, f, d)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return errors.New("no document with this _id; it may have been deleted. Nothing was saved")
	}
	return nil
}

func (m *conn) Delete(ctx context.Context, db, coll string, ids []json.RawMessage) (int64, error) {
	vals := bson.A{}
	for _, id := range ids {
		f, err := idFilter(id)
		if err != nil {
			return 0, err
		}
		vals = append(vals, f[0].Value)
	}
	res, err := m.client.Database(db).Collection(coll).DeleteMany(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: vals}}}})
	if err != nil {
		return 0, err
	}
	return res.DeletedCount, nil
}

func (m *conn) Aggregate(ctx context.Context, db, coll string, pipeline json.RawMessage, limit int) ([]json.RawMessage, error) {
	var stages []bson.D
	if err := bson.UnmarshalExtJSON([]byte(`{"p":`+string(pipeline)+`}`), false, &struct {
		P *[]bson.D `bson:"p"`
	}{&stages}); err != nil {
		return nil, fmt.Errorf("the pipeline must be a JSON array of stages: %w", err)
	}
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	cur, err := m.client.Database(db).Collection(coll).Aggregate(ctx, stages)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	out := []json.RawMessage{}
	for cur.Next(ctx) && len(out) < limit {
		out = append(out, ext(cur.Current))
	}
	return out, cur.Err()
}

func (m *conn) RunCommand(ctx context.Context, db string, cmd json.RawMessage) (json.RawMessage, error) {
	c, err := parse(cmd)
	if err != nil {
		return nil, err
	}
	if len(c) == 0 {
		return nil, errors.New(`type a command, e.g. {"dbStats": 1}`)
	}
	raw, err := m.client.Database(db).RunCommand(ctx, c).Raw()
	if err != nil {
		return nil, err
	}
	return ext(raw), nil
}

func (m *conn) CreateCollection(ctx context.Context, db, coll string) error {
	return m.client.Database(db).CreateCollection(ctx, coll)
}

func (m *conn) DropCollection(ctx context.Context, db, coll string) error {
	return m.client.Database(db).Collection(coll).Drop(ctx)
}

func (m *conn) DropDatabase(ctx context.Context, db string) error {
	return m.client.Database(db).Drop(ctx)
}

// readCommands may run on read-only connections; anything else is refused there.
var readCommands = map[string]bool{
	"ping": true, "hello": true, "ismaster": true, "isMaster": true, "buildinfo": true, "buildInfo": true,
	"dbstats": true, "dbStats": true, "collstats": true, "collStats": true, "serverStatus": true, "listCollections": true,
	"listDatabases": true, "listIndexes": true, "count": true, "distinct": true, "find": true, "explain": true,
	"connectionStatus": true, "hostInfo": true, "getLog": true, "currentOp": true, "validate": true, "dataSize": true,
}

// CommandName returns the first key of a command document.
func CommandName(cmd json.RawMessage) string {
	d, err := parse(cmd)
	if err != nil || len(d) == 0 {
		return ""
	}
	return d[0].Key
}

// IsReadCommand reports whether a database command only reads.
func IsReadCommand(cmd json.RawMessage) bool { return readCommands[CommandName(cmd)] }

// PipelineWrites reports whether an aggregation writes ($out / $merge).
func PipelineWrites(pipeline json.RawMessage) bool {
	s := string(pipeline)
	return strings.Contains(s, `"$out"`) || strings.Contains(s, `"$merge"`)
}
