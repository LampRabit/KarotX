// Package dynamodrv implements the DynamoDB driver (document capability).
// Tables show as collections of one "database" (the region). Items travel as
// JSON; DynamoDB types JSON can't express use tagged objects: {"$binary": b64},
// {"$SS": [...]}, {"$NS": [...]}, {"$BS": [...]}. Filters arrive in the same
// MongoDB-style JSON the visual filter builds and become filter expressions.
package dynamodrv

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/lamprabit/karotx/internal/driver"
)

func init() { driver.Register("dynamodb", Driver{}) }

type Driver struct{}

type conn struct {
	db     *dynamodb.Client
	region string
	info   driver.Info

	mu   sync.Mutex
	keys map[string][]string // table → key attribute names (partition first)
}

func (Driver) Open(ctx context.Context, p driver.OpenParams) (driver.Conn, error) {
	c := p.Conn
	region := c.Params["region"]
	if region == "" {
		region = "local" // DynamoDB Local accepts any region
	}
	opts := []func(*config.LoadOptions) error{config.WithRegion(region)}
	if c.User != "" {
		opts = append(opts, config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(c.User, p.Password, "")))
	} else if prof := c.Params["profile"]; prof != "" {
		opts = append(opts, config.WithSharedConfigProfile(prof))
	}
	if p.Dial != nil {
		opts = append(opts, config.WithHTTPClient(awshttp.NewBuildableClient().WithTransportOptions(func(t *http.Transport) {
			t.DialContext = p.Dial
		})))
	}
	cfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, err
	}
	version := "Amazon DynamoDB"
	cl := dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if c.Host != "" {
			scheme, port := "http", c.Port // local endpoints (DynamoDB Local) speak plain HTTP
			if c.TLS.Mode == "require" || c.TLS.Mode == "verify" {
				scheme = "https"
			}
			host := c.Host
			if port != 0 {
				host = net.JoinHostPort(c.Host, strconv.Itoa(port))
			}
			o.BaseEndpoint = aws.String(scheme + "://" + host)
			version = "DynamoDB (" + host + ")"
		}
	})
	d := &conn{db: cl, region: region, keys: map[string][]string{}}
	d.info = driver.Info{Dialect: "dynamodb", ServerVersion: version, Database: region}
	if err := d.Ping(ctx); err != nil {
		return nil, err
	}
	return d, nil
}

func (d *conn) Info() driver.Info { return d.info }
func (d *conn) Close() error      { return nil }

func (d *conn) Ping(ctx context.Context) error {
	_, err := d.db.ListTables(ctx, &dynamodb.ListTablesInput{Limit: aws.Int32(1)})
	return err
}

func (d *conn) tableNames(ctx context.Context) ([]string, error) {
	var names []string
	p := dynamodb.NewListTablesPaginator(d.db, &dynamodb.ListTablesInput{})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		names = append(names, page.TableNames...)
	}
	return names, nil
}

func (d *conn) Tree(ctx context.Context, path []string) ([]driver.Node, error) {
	switch len(path) {
	case 0:
		return []driver.Node{{Name: d.region, Kind: "database", Path: []string{d.region}, HasChildren: true}}, nil
	case 1:
		names, err := d.tableNames(ctx)
		if err != nil {
			return nil, err
		}
		nodes := make([]driver.Node, len(names))
		for i, n := range names {
			nodes[i] = driver.Node{Name: n, Kind: "table", Path: []string{path[0], n}}
		}
		return nodes, nil
	}
	return []driver.Node{}, nil
}

func (d *conn) Tables(ctx context.Context, _ string) ([]driver.TableInfo, error) {
	names, err := d.tableNames(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]driver.TableInfo, len(names))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, n := range names {
		out[i] = driver.TableInfo{Name: n, Kind: "table"}
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if t, err := d.db.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &n}); err == nil {
				out[i].Rows, out[i].Bytes = t.Table.ItemCount, t.Table.TableSizeBytes
			}
		}()
	}
	wg.Wait()
	return out, nil
}

// keyOf returns a table's key attribute names, partition key first.
func (d *conn) keyOf(ctx context.Context, table string) ([]string, error) {
	d.mu.Lock()
	k, ok := d.keys[table]
	d.mu.Unlock()
	if ok {
		return k, nil
	}
	t, err := d.db.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &table})
	if err != nil {
		return nil, err
	}
	for _, typ := range []types.KeyType{types.KeyTypeHash, types.KeyTypeRange} {
		for _, e := range t.Table.KeySchema {
			if e.KeyType == typ {
				k = append(k, *e.AttributeName)
			}
		}
	}
	d.mu.Lock()
	d.keys[table] = k
	d.mu.Unlock()
	return k, nil
}

// --- values ---

func toJSON(av types.AttributeValue) any {
	switch v := av.(type) {
	case *types.AttributeValueMemberS:
		return v.Value
	case *types.AttributeValueMemberN:
		return json.Number(v.Value)
	case *types.AttributeValueMemberBOOL:
		return v.Value
	case *types.AttributeValueMemberNULL:
		return nil
	case *types.AttributeValueMemberB:
		return map[string]any{"$binary": base64.StdEncoding.EncodeToString(v.Value)}
	case *types.AttributeValueMemberM:
		return itemJSON(v.Value)
	case *types.AttributeValueMemberL:
		out := make([]any, len(v.Value))
		for i, x := range v.Value {
			out[i] = toJSON(x)
		}
		return out
	case *types.AttributeValueMemberSS:
		return map[string]any{"$SS": v.Value}
	case *types.AttributeValueMemberNS:
		ns := make([]json.Number, len(v.Value))
		for i, n := range v.Value {
			ns[i] = json.Number(n)
		}
		return map[string]any{"$NS": ns}
	case *types.AttributeValueMemberBS:
		bs := make([]string, len(v.Value))
		for i, b := range v.Value {
			bs[i] = base64.StdEncoding.EncodeToString(b)
		}
		return map[string]any{"$BS": bs}
	}
	return nil
}

func itemJSON(m map[string]types.AttributeValue) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = toJSON(v)
	}
	return out
}

func fromJSON(v any) (types.AttributeValue, error) {
	switch x := v.(type) {
	case nil:
		return &types.AttributeValueMemberNULL{Value: true}, nil
	case string:
		return &types.AttributeValueMemberS{Value: x}, nil
	case json.Number:
		return &types.AttributeValueMemberN{Value: x.String()}, nil
	case float64:
		return &types.AttributeValueMemberN{Value: strconv.FormatFloat(x, 'f', -1, 64)}, nil
	case bool:
		return &types.AttributeValueMemberBOOL{Value: x}, nil
	case []any:
		l := make([]types.AttributeValue, len(x))
		for i, e := range x {
			av, err := fromJSON(e)
			if err != nil {
				return nil, err
			}
			l[i] = av
		}
		return &types.AttributeValueMemberL{Value: l}, nil
	case map[string]any:
		if len(x) == 1 {
			for tag, inner := range x {
				if av, ok, err := tagged(tag, inner); ok || err != nil {
					return av, err
				}
			}
		}
		m, err := itemAV(x)
		if err != nil {
			return nil, err
		}
		return &types.AttributeValueMemberM{Value: m}, nil
	}
	return nil, fmt.Errorf("unsupported value %v", v)
}

func strs(v any) ([]string, error) {
	arr, ok := v.([]any)
	if !ok || len(arr) == 0 {
		return nil, errors.New("a set needs a non-empty array")
	}
	out := make([]string, len(arr))
	for i, e := range arr {
		switch s := e.(type) {
		case string:
			out[i] = s
		case json.Number:
			out[i] = s.String()
		default:
			return nil, fmt.Errorf("unexpected set member %v", e)
		}
	}
	return out, nil
}

func tagged(tag string, v any) (types.AttributeValue, bool, error) {
	switch tag {
	case "$binary":
		s, _ := v.(string)
		b, err := base64.StdEncoding.DecodeString(s)
		return &types.AttributeValueMemberB{Value: b}, true, err
	case "$SS":
		s, err := strs(v)
		return &types.AttributeValueMemberSS{Value: s}, true, err
	case "$NS":
		s, err := strs(v)
		return &types.AttributeValueMemberNS{Value: s}, true, err
	case "$BS":
		s, err := strs(v)
		bs := make([][]byte, len(s))
		for i := range s {
			if bs[i], err = base64.StdEncoding.DecodeString(s[i]); err != nil {
				break
			}
		}
		return &types.AttributeValueMemberBS{Value: bs}, true, err
	}
	return nil, false, nil
}

func itemAV(m map[string]any) (map[string]types.AttributeValue, error) {
	out := make(map[string]types.AttributeValue, len(m))
	for k, v := range m {
		av, err := fromJSON(v)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", k, err)
		}
		out[k] = av
	}
	return out, nil
}

func decode(raw json.RawMessage, into any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	return dec.Decode(into)
}

func parseItem(raw json.RawMessage) (map[string]types.AttributeValue, error) {
	var m map[string]any
	if err := decode(raw, &m); err != nil {
		return nil, fmt.Errorf("the item isn't a JSON object: %w", err)
	}
	return itemAV(m)
}

func marshal(item map[string]types.AttributeValue) json.RawMessage {
	b, _ := json.Marshal(itemJSON(item))
	return b
}

// --- filter expressions ---

type expr struct {
	names  map[string]string
	values map[string]types.AttributeValue
}

func newExpr() *expr {
	return &expr{names: map[string]string{}, values: map[string]types.AttributeValue{}}
}

func (e *expr) name(path string) string {
	parts := strings.Split(path, ".")
	for i, p := range parts {
		ph := "#n" + strconv.Itoa(len(e.names))
		for k, v := range e.names {
			if v == p {
				ph = k
			}
		}
		e.names[ph] = p
		parts[i] = ph
	}
	return strings.Join(parts, ".")
}

func (e *expr) value(v any) (string, error) {
	av, err := fromJSON(v)
	if err != nil {
		return "", err
	}
	ph := ":v" + strconv.Itoa(len(e.values))
	e.values[ph] = av
	return ph, nil
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// cond translates a MongoDB-style filter (the subset the filter bar emits).
func (e *expr) cond(f map[string]any) (string, error) {
	var parts []string
	for _, k := range sortedKeys(f) {
		v := f[k]
		var c string
		var err error
		switch k {
		case "$and", "$or", "$nor":
			arr, ok := v.([]any)
			if !ok {
				return "", fmt.Errorf("%s needs an array", k)
			}
			var sub []string
			for _, x := range arr {
				m, ok := x.(map[string]any)
				if !ok {
					return "", fmt.Errorf("%s needs an array of objects", k)
				}
				s, err := e.cond(m)
				if err != nil {
					return "", err
				}
				if s != "" {
					sub = append(sub, "("+s+")")
				}
			}
			join := " AND "
			if k != "$and" {
				join = " OR "
			}
			c = strings.Join(sub, join)
			if k == "$nor" && c != "" {
				c = "NOT (" + c + ")"
			}
		default:
			if strings.HasPrefix(k, "$") {
				return "", fmt.Errorf("DynamoDB filters don't support %s", k)
			}
			c, err = e.field(k, v)
		}
		if err != nil {
			return "", err
		}
		if c != "" {
			parts = append(parts, c)
		}
	}
	return strings.Join(parts, " AND "), nil
}

func isOps(m map[string]any) bool {
	for k := range m {
		if !strings.HasPrefix(k, "$") {
			return false
		}
	}
	return len(m) > 0
}

func (e *expr) isNull(n string) string {
	e.values[":null"] = &types.AttributeValueMemberS{Value: "NULL"}
	return "(attribute_not_exists(" + n + ") OR attribute_type(" + n + ", :null))"
}

func (e *expr) field(path string, v any) (string, error) {
	n := e.name(path)
	m, ok := v.(map[string]any)
	if !ok || !isOps(m) {
		if v == nil {
			return e.isNull(n), nil
		}
		ph, err := e.value(v)
		return n + " = " + ph, err
	}
	var parts []string
	for _, op := range sortedKeys(m) {
		x := m[op]
		var c string
		switch op {
		case "$options":
			continue
		case "$eq":
			return e.field(path, x)
		case "$ne":
			if x == nil {
				c = "NOT " + e.isNull(n)
				break
			}
			ph, err := e.value(x)
			if err != nil {
				return "", err
			}
			c = n + " <> " + ph
		case "$gt", "$gte", "$lt", "$lte":
			ph, err := e.value(x)
			if err != nil {
				return "", err
			}
			c = n + " " + map[string]string{"$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}[op] + " " + ph
		case "$in", "$nin":
			arr, ok := x.([]any)
			if !ok || len(arr) == 0 || len(arr) > 100 {
				return "", fmt.Errorf("%s needs 1–100 values", op)
			}
			phs := make([]string, len(arr))
			for i, a := range arr {
				ph, err := e.value(a)
				if err != nil {
					return "", err
				}
				phs[i] = ph
			}
			c = n + " IN (" + strings.Join(phs, ", ") + ")"
			if op == "$nin" {
				c = "NOT (" + c + ")"
			}
		case "$exists":
			c = "attribute_not_exists(" + n + ")"
			if b, _ := x.(bool); b {
				c = "attribute_exists(" + n + ")"
			}
		case "$regex":
			re, _ := x.(string)
			lit, prefix, ok := regexLiteral(re)
			if !ok {
				return "", errors.New("DynamoDB filters only support 'contains' and 'starts with' text matches (and they are case-sensitive)")
			}
			ph, err := e.value(lit)
			if err != nil {
				return "", err
			}
			c = "contains(" + n + ", " + ph + ")"
			if prefix {
				c = "begins_with(" + n + ", " + ph + ")"
			}
		case "$not":
			s, err := e.field(path, x)
			if err != nil {
				return "", err
			}
			c = "NOT (" + s + ")"
		default:
			return "", fmt.Errorf("DynamoDB filters don't support %s", op)
		}
		parts = append(parts, c)
	}
	return strings.Join(parts, " AND "), nil
}

// keyable reports whether a sort-key filter fits a Query key condition.
func keyable(v any) bool {
	m, ok := v.(map[string]any)
	if !ok {
		return v != nil
	}
	if re, ok := m["$regex"].(string); ok && len(m) <= 2 {
		_, prefix, lit := regexLiteral(re)
		_, opts := m["$options"]
		return prefix && lit && (len(m) == 1 || opts)
	}
	if len(m) != 1 {
		return false
	}
	for op, x := range m {
		return x != nil && (op == "$eq" || op == "$gt" || op == "$gte" || op == "$lt" || op == "$lte")
	}
	return false
}

// regexLiteral reads an escaped literal regex, optionally anchored with ^.
func regexLiteral(re string) (lit string, prefix, ok bool) {
	prefix = strings.HasPrefix(re, "^")
	re = strings.TrimPrefix(re, "^")
	var b strings.Builder
	for i := 0; i < len(re); i++ {
		c := re[i]
		if c == '\\' && i+1 < len(re) {
			i++
			b.WriteByte(re[i])
			continue
		}
		if strings.IndexByte(".*+?^${}()|[]\\", c) >= 0 {
			return "", false, false
		}
		b.WriteByte(c)
	}
	return b.String(), prefix, true
}

// --- reading ---

type pager func(ctx context.Context, start map[string]types.AttributeValue) ([]map[string]types.AttributeValue, map[string]types.AttributeValue, error)

// reader plans a Scan, or a Query when the filter pins the partition key.
func (d *conn) reader(ctx context.Context, table string, filter json.RawMessage, projection []string) (pager, error) {
	f := map[string]any{}
	if len(bytes.TrimSpace(filter)) > 0 {
		if err := decode(filter, &f); err != nil {
			return nil, fmt.Errorf("the filter isn't a JSON object: %w", err)
		}
	}
	keys, err := d.keyOf(ctx, table)
	if err != nil {
		return nil, err
	}
	e := newExpr()
	var keyCond string
	if v, ok := f[keys[0]]; ok && v != nil {
		if _, isMap := v.(map[string]any); !isMap {
			ph, err := e.value(v)
			if err != nil {
				return nil, err
			}
			keyCond = e.name(keys[0]) + " = " + ph
			delete(f, keys[0])
		}
	}
	// A Query can't filter on key attributes: a simple sort-key condition joins
	// the key condition; anything else falls back to a Scan.
	if v, ok := f[keys[len(keys)-1]]; ok && keyCond != "" && len(keys) == 2 {
		if !keyable(v) {
			keyCond, e = "", newExpr()
		} else {
			c, err := e.field(keys[1], v)
			if err != nil {
				return nil, err
			}
			keyCond += " AND " + c
			delete(f, keys[1])
		}
	}
	if keyCond == "" { // the partition key may have been taken out above: start over for a Scan
		f = map[string]any{}
		decode(filter, &f)
	}
	cond, err := e.cond(f)
	if err != nil {
		return nil, err
	}
	var proj *string
	if len(projection) > 0 {
		ps := make([]string, len(projection))
		for i, p := range projection {
			ps[i] = e.name(p)
		}
		proj = aws.String(strings.Join(ps, ", "))
	}
	var fe *string
	if cond != "" {
		fe = &cond
	}
	names, values := e.names, e.values
	if len(names) == 0 {
		names = nil
	}
	if len(values) == 0 {
		values = nil
	}
	if keyCond != "" {
		return func(ctx context.Context, start map[string]types.AttributeValue) ([]map[string]types.AttributeValue, map[string]types.AttributeValue, error) {
			r, err := d.db.Query(ctx, &dynamodb.QueryInput{TableName: &table, KeyConditionExpression: &keyCond, FilterExpression: fe,
				ProjectionExpression: proj, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ExclusiveStartKey: start})
			if err != nil {
				return nil, nil, err
			}
			return r.Items, r.LastEvaluatedKey, nil
		}, nil
	}
	return func(ctx context.Context, start map[string]types.AttributeValue) ([]map[string]types.AttributeValue, map[string]types.AttributeValue, error) {
		r, err := d.db.Scan(ctx, &dynamodb.ScanInput{TableName: &table, FilterExpression: fe,
			ProjectionExpression: proj, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ExclusiveStartKey: start})
		if err != nil {
			return nil, nil, err
		}
		return r.Items, r.LastEvaluatedKey, nil
	}, nil
}

// each calls fn for every matching item until fn returns false.
func (d *conn) each(ctx context.Context, table string, filter json.RawMessage, projection []string, fn func(map[string]types.AttributeValue) (bool, error)) error {
	next, err := d.reader(ctx, table, filter, projection)
	if err != nil {
		return err
	}
	var start map[string]types.AttributeValue
	for {
		items, last, err := next(ctx, start)
		if err != nil {
			return err
		}
		for _, it := range items {
			more, err := fn(it)
			if err != nil || !more {
				return err
			}
		}
		if len(last) == 0 {
			return nil
		}
		start = last
	}
}

// Find pages through matching items. DynamoDB has no server-side sort or
// offset, so skip is done by reading past items and Sort is ignored.
func (d *conn) Find(ctx context.Context, _, table string, q driver.FindRequest) (*driver.FindResult, error) {
	start := time.Now()
	keys, err := d.keyOf(ctx, table)
	if err != nil {
		return nil, err
	}
	if q.Limit <= 0 || q.Limit > 1000 {
		q.Limit = 50
	}
	res := &driver.FindResult{Docs: []json.RawMessage{}, Key: keys, Estimated: true}
	var seen int64
	more := false
	err = d.each(ctx, table, q.Filter, nil, func(it map[string]types.AttributeValue) (bool, error) {
		seen++
		switch {
		case seen <= q.Skip:
		case int64(len(res.Docs)) < q.Limit:
			res.Docs = append(res.Docs, marshal(it))
		default:
			more = true
			return false, nil
		}
		return true, nil
	})
	if err != nil {
		return nil, err
	}
	res.Total = q.Skip + int64(len(res.Docs))
	if more {
		res.Total++
	}
	if f := bytes.TrimSpace(q.Filter); len(f) == 0 || string(f) == "{}" {
		if t, err := d.db.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &table}); err == nil && t.Table.ItemCount != nil {
			// ItemCount is refreshed about every six hours, so never show less than we've seen.
			res.Total = max(res.Total, *t.Table.ItemCount)
		}
	} else if !more {
		res.Estimated = false
	}
	res.DurationMs = float64(time.Since(start).Microseconds()) / 1000
	return res, nil
}

func (d *conn) Each(ctx context.Context, _, table string, q driver.FindRequest, fn func(json.RawMessage) error) error {
	var n int64
	return d.each(ctx, table, q.Filter, nil, func(it map[string]types.AttributeValue) (bool, error) {
		n++
		return q.Limit <= 0 || n < q.Limit, fn(marshal(it))
	})
}

func (d *conn) Fields(ctx context.Context, _, table string) ([]driver.FieldInfo, error) {
	r, err := d.db.Scan(ctx, &dynamodb.ScanInput{TableName: &table, Limit: aws.Int32(100)})
	if err != nil {
		return nil, err
	}
	counts := map[string]map[string]int{}
	var walk func(prefix string, m map[string]types.AttributeValue)
	walk = func(prefix string, m map[string]types.AttributeValue) {
		for k, v := range m {
			p := prefix + k
			t := "string"
			switch x := v.(type) {
			case *types.AttributeValueMemberN:
				t = "number"
			case *types.AttributeValueMemberBOOL:
				t = "bool"
			case *types.AttributeValueMemberNULL:
				t = "null"
			case *types.AttributeValueMemberB:
				t = "binary"
			case *types.AttributeValueMemberL, *types.AttributeValueMemberSS, *types.AttributeValueMemberNS, *types.AttributeValueMemberBS:
				t = "array"
			case *types.AttributeValueMemberM:
				t = "object"
				walk(p+".", x.Value)
			}
			if counts[p] == nil {
				counts[p] = map[string]int{}
			}
			counts[p][t]++
		}
	}
	for _, it := range r.Items {
		walk("", it)
	}
	out := make([]driver.FieldInfo, 0, len(counts))
	for p, c := range counts {
		best, n := "null", 0
		for t, k := range c {
			if t != "null" && (k > n || (k == n && t < best)) {
				best, n = t, k
			}
		}
		out = append(out, driver.FieldInfo{Path: p, Type: best})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// --- writing ---

func notExists(keys []string) (*string, map[string]string) {
	names := map[string]string{"#k": keys[0]}
	return aws.String("attribute_not_exists(#k)"), names
}

func (d *conn) Insert(ctx context.Context, _, table string, docs []json.RawMessage) (int, error) {
	keys, err := d.keyOf(ctx, table)
	if err != nil {
		return 0, err
	}
	items := make([]map[string]types.AttributeValue, len(docs))
	for i, raw := range docs {
		if items[i], err = parseItem(raw); err != nil {
			return 0, fmt.Errorf("item %d: %w", i+1, err)
		}
		for _, k := range keys {
			if items[i][k] == nil {
				return 0, fmt.Errorf("item %d has no %q (part of the table's key)", i+1, k)
			}
		}
	}
	if len(items) == 1 { // a single insert must not silently overwrite
		cond, names := notExists(keys)
		_, err := d.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: items[0], ConditionExpression: cond, ExpressionAttributeNames: names})
		var cf *types.ConditionalCheckFailedException
		if errors.As(err, &cf) {
			return 0, errors.New("an item with this key already exists")
		}
		if err != nil {
			return 0, err
		}
		return 1, nil
	}
	// shortcut: batch imports overwrite items with the same key (BatchWriteItem has no conditions).
	reqs := make([]types.WriteRequest, len(items))
	for i, it := range items {
		reqs[i] = types.WriteRequest{PutRequest: &types.PutRequest{Item: it}}
	}
	return len(items), d.batch(ctx, table, reqs)
}

// batch writes in chunks of 25, retrying unprocessed requests with backoff.
func (d *conn) batch(ctx context.Context, table string, reqs []types.WriteRequest) error {
	for len(reqs) > 0 {
		chunk := reqs[:min(25, len(reqs))]
		reqs = reqs[len(chunk):]
		for try := 0; len(chunk) > 0; try++ {
			r, err := d.db.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{RequestItems: map[string][]types.WriteRequest{table: chunk}})
			if err != nil {
				return err
			}
			chunk = r.UnprocessedItems[table]
			if len(chunk) > 0 {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(time.Duration(min(try, 6)+1) * 100 * time.Millisecond):
				}
			}
		}
	}
	return nil
}

func keyAV(raw json.RawMessage, keys []string) (map[string]types.AttributeValue, error) {
	item, err := parseItem(raw)
	if err != nil {
		return nil, err
	}
	out := map[string]types.AttributeValue{}
	for _, k := range keys {
		if item[k] == nil {
			return nil, fmt.Errorf("the key is missing %q", k)
		}
		out[k] = item[k]
	}
	return out, nil
}

func (d *conn) Replace(ctx context.Context, _, table string, id, doc json.RawMessage) error {
	keys, err := d.keyOf(ctx, table)
	if err != nil {
		return err
	}
	old, err := keyAV(id, keys)
	if err != nil {
		return err
	}
	item, err := parseItem(doc)
	if err != nil {
		return err
	}
	same := true
	for _, k := range keys {
		if item[k] == nil {
			return fmt.Errorf("the item needs %q (part of the table's key)", k)
		}
		a, _ := json.Marshal(toJSON(item[k]))
		b, _ := json.Marshal(toJSON(old[k]))
		same = same && bytes.Equal(a, b)
	}
	if same {
		_, err := d.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
		return err
	}
	// The key changed: write the new item and remove the old one together.
	cond, names := notExists(keys)
	_, err = d.db.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{
		{Put: &types.Put{TableName: &table, Item: item, ConditionExpression: cond, ExpressionAttributeNames: names}},
		{Delete: &types.Delete{TableName: &table, Key: old}},
	}})
	return err
}

func (d *conn) Delete(ctx context.Context, _, table string, ids []json.RawMessage) (int64, error) {
	keys, err := d.keyOf(ctx, table)
	if err != nil {
		return 0, err
	}
	var n int64
	for _, id := range ids {
		k, err := keyAV(id, keys)
		if err != nil {
			return n, err
		}
		r, err := d.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: &table, Key: k, ReturnValues: types.ReturnValueAllOld})
		if err != nil {
			return n, err
		}
		if len(r.Attributes) > 0 {
			n++
		}
	}
	return n, nil
}

func (d *conn) DeleteAll(ctx context.Context, _, table string) (int64, error) {
	keys, err := d.keyOf(ctx, table)
	if err != nil {
		return 0, err
	}
	var reqs []types.WriteRequest
	err = d.each(ctx, table, nil, keys, func(it map[string]types.AttributeValue) (bool, error) {
		reqs = append(reqs, types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: it}})
		return true, nil
	})
	if err != nil {
		return 0, err
	}
	return int64(len(reqs)), d.batch(ctx, table, reqs)
}

func (d *conn) Aggregate(context.Context, string, string, json.RawMessage, int) ([]json.RawMessage, error) {
	return nil, errors.New("DynamoDB has no aggregation pipelines; use a PartiQL statement instead")
}

// statement reads a console command: {"statement": "...", "parameters": [...]} or a JSON string.
func statement(cmd json.RawMessage) (string, []any, error) {
	var s string
	if json.Unmarshal(cmd, &s) == nil {
		return strings.TrimSpace(s), nil, nil
	}
	var b struct {
		Statement  string `json:"statement"`
		Parameters []any  `json:"parameters"`
	}
	if err := decode(cmd, &b); err != nil || strings.TrimSpace(b.Statement) == "" {
		return "", nil, errors.New(`send a PartiQL statement, e.g. {"statement": "SELECT * FROM \"table\""}`)
	}
	return strings.TrimSpace(b.Statement), b.Parameters, nil
}

func (d *conn) ClassifyCommand(cmd json.RawMessage) (bool, string) {
	s, _, _ := statement(cmd)
	return driver.FirstKeyword(s) == "SELECT", s
}

// RunCommand runs one PartiQL statement and returns up to 1000 items.
func (d *conn) RunCommand(ctx context.Context, _ string, cmd json.RawMessage) (json.RawMessage, error) {
	s, params, err := statement(cmd)
	if err != nil {
		return nil, err
	}
	in := &dynamodb.ExecuteStatementInput{Statement: &s}
	for _, p := range params {
		av, err := fromJSON(p)
		if err != nil {
			return nil, err
		}
		in.Parameters = append(in.Parameters, av)
	}
	items := []any{}
	for len(items) < 1000 {
		r, err := d.db.ExecuteStatement(ctx, in)
		if err != nil {
			return nil, err
		}
		for _, it := range r.Items {
			items = append(items, itemJSON(it))
		}
		if r.NextToken == nil {
			break
		}
		in.NextToken = r.NextToken
	}
	b, err := json.Marshal(items)
	return b, err
}

func (d *conn) CreateCollection(ctx context.Context, _, table string, keys []driver.KeyAttr) error {
	if len(keys) == 0 || len(keys) > 2 || keys[0].Name == "" {
		return errors.New("a DynamoDB table needs a partition key (and optionally a sort key)")
	}
	in := &dynamodb.CreateTableInput{TableName: &table, BillingMode: types.BillingModePayPerRequest}
	for i, k := range keys {
		if k.Type != "S" && k.Type != "N" && k.Type != "B" {
			return fmt.Errorf("key type must be S, N or B, not %q", k.Type)
		}
		kt := types.KeyTypeHash
		if i == 1 {
			kt = types.KeyTypeRange
		}
		in.AttributeDefinitions = append(in.AttributeDefinitions, types.AttributeDefinition{AttributeName: aws.String(k.Name), AttributeType: types.ScalarAttributeType(k.Type)})
		in.KeySchema = append(in.KeySchema, types.KeySchemaElement{AttributeName: aws.String(k.Name), KeyType: kt})
	}
	if _, err := d.db.CreateTable(ctx, in); err != nil {
		return err
	}
	return dynamodb.NewTableExistsWaiter(d.db).Wait(ctx, &dynamodb.DescribeTableInput{TableName: &table}, 2*time.Minute)
}

func (d *conn) DropCollection(ctx context.Context, _, table string) error {
	_, err := d.db.DeleteTable(ctx, &dynamodb.DeleteTableInput{TableName: &table})
	d.mu.Lock()
	delete(d.keys, table)
	d.mu.Unlock()
	return err
}

func (d *conn) DropDatabase(context.Context, string) error {
	return errors.New("DynamoDB has no databases to drop; drop tables one by one")
}
