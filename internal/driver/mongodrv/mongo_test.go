package mongodrv

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
	"github.com/lamprabit/karotx/internal/tunnel"
	"github.com/lamprabit/karotx/internal/tunnel/sshtest"
)

func TestURI(t *testing.T) {
	cases := []struct {
		c    model.Connection
		pw   string
		want string
	}{
		{model.Connection{Host: "localhost"}, "", "mongodb://localhost:27017/"},
		{model.Connection{Host: "db.example.com", Port: 27018, User: "app", Database: "shop", TLS: model.TLS{Mode: "off"}}, "p@ss:w/rd", "mongodb://app:p%40ss%3Aw%2Frd@db.example.com:27018/shop?tls=false"},
		{model.Connection{Host: "cluster0.abcd.mongodb.net", SRV: true, User: "u", Params: map[string]string{"retryWrites": "true", "authSource": "admin"}}, "x", "mongodb+srv://u:x@cluster0.abcd.mongodb.net/?authSource=admin&retryWrites=true"},
		{model.Connection{Host: "a:27017,b:27017", Params: map[string]string{"replicaSet": "rs0"}}, "", "mongodb://a:27017,b:27017/?replicaSet=rs0"},
	}
	for _, tc := range cases {
		if got := URI(tc.c, tc.pw); got != tc.want {
			t.Errorf("URI(%+v) = %s, want %s", tc.c, got, tc.want)
		}
	}
}

func TestCommandClassification(t *testing.T) {
	if !IsReadCommand(json.RawMessage(`{"dbStats":1}`)) || IsReadCommand(json.RawMessage(`{"dropDatabase":1}`)) {
		t.Fatal("command classification")
	}
	if !PipelineWrites(json.RawMessage(`[{"$match":{}},{"$out":"x"}]`)) || PipelineWrites(json.RawMessage(`[{"$group":{"_id":"$a"}}]`)) {
		t.Fatal("pipeline write detection")
	}
}

// Live test, enabled with KAROTX_IT_MONGO=host:port (e.g. 127.0.0.1:27017).
func TestLiveMongo(t *testing.T) {
	addr := os.Getenv("KAROTX_IT_MONGO")
	if addr == "" {
		t.Skip("set KAROTX_IT_MONGO to run")
	}
	host, port, _ := strings.Cut(addr, ":")
	p, _ := strconv.Atoi(port)
	cfg := model.Connection{Driver: "mongodb", Host: host, Port: p, TLS: model.TLS{Mode: "off"}}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	for _, viaSSH := range []bool{false, true} {
		name := "direct"
		if viaSSH {
			name = "ssh-tunnel"
		}
		t.Run(name, func(t *testing.T) {
			params := driver.OpenParams{Conn: cfg}
			if viaSSH {
				tunnel.KnownHostsPath = t.TempDir() + "/known_hosts"
				srv := sshtest.Start(t, sshtest.Options{User: "u", Password: "pw"})
				tun, err := tunnel.Open(ctx, &model.SSH{Hops: []model.SSHHop{{Host: srv.Host, Port: srv.Port, User: "u", Auth: "password", HostKey: ssh.FingerprintSHA256(srv.HostKey)}}}, []string{"pw"})
				if err != nil {
					t.Fatal(err)
				}
				defer tun.Close()
				params.Dial = tun.Dial
				params.Conn.Params = map[string]string{"directConnection": "true"} // the tunnel reaches one node
			}
			d, err := Open(ctx, params)
			if err != nil {
				t.Fatal(err)
			}
			defer d.Close()
			const db = "karotx_it"
			d.DropDatabase(ctx, db)
			defer d.DropDatabase(ctx, db)

			if err := d.CreateCollection(ctx, db, "people", nil); err != nil {
				t.Fatal(err)
			}
			n, err := d.Insert(ctx, db, "people", []json.RawMessage{
				json.RawMessage(`{"name":"Ann","age":34,"address":{"city":"Pune"},"joined":{"$date":"2024-01-02T00:00:00Z"}}`),
				json.RawMessage(`{"name":"Bob","age":28,"address":{"city":"Goa"}}`),
				json.RawMessage(`{"name":"Cy","age":41,"vip":true}`),
			})
			if err != nil || n != 3 {
				t.Fatalf("insert: %v %d", err, n)
			}
			nodes, err := d.Tree(ctx, []string{db})
			if err != nil || len(nodes) != 1 || nodes[0].Name != "people" {
				t.Fatalf("tree: %v %+v", err, nodes)
			}
			tables, err := d.Tables(ctx, db)
			if err != nil || len(tables) != 1 || tables[0].Rows == nil || *tables[0].Rows != 3 {
				t.Fatalf("tables: %v %+v", err, tables)
			}
			res, err := d.Find(ctx, db, "people", driver.FindRequest{Filter: json.RawMessage(`{"age":{"$gte":30}}`), Sort: json.RawMessage(`{"age":-1}`), Limit: 10})
			if err != nil || len(res.Docs) != 2 || res.Total != 2 || !strings.Contains(string(res.Docs[0]), `"Cy"`) {
				t.Fatalf("find: %v %+v", err, res)
			}
			fields, _ := d.Fields(ctx, db, "people")
			types := map[string]string{}
			for _, f := range fields {
				types[f.Path] = f.Type
			}
			if types["_id"] != "objectId" || types["age"] != "number" || types["address.city"] != "string" || types["joined"] != "date" || types["vip"] != "bool" {
				t.Fatalf("fields: %+v", fields)
			}

			// Edit Bob by _id (as returned in Extended JSON), then delete Cy.
			var bob, cy struct {
				ID json.RawMessage `json:"_id"`
			}
			all, _ := d.Find(ctx, db, "people", driver.FindRequest{Sort: json.RawMessage(`{"name":1}`)})
			json.Unmarshal(all.Docs[1], &bob)
			json.Unmarshal(all.Docs[2], &cy)
			if err := d.Replace(ctx, db, "people", bob.ID, json.RawMessage(`{"name":"Bob","age":29}`)); err != nil {
				t.Fatal(err)
			}
			if err := d.Replace(ctx, db, "people", json.RawMessage(`{"$oid":"000000000000000000000000"}`), json.RawMessage(`{}`)); err == nil {
				t.Fatal("replacing a missing _id should fail")
			}
			if del, err := d.Delete(ctx, db, "people", []json.RawMessage{cy.ID}); err != nil || del != 1 {
				t.Fatalf("delete: %v %d", err, del)
			}
			agg, err := d.Aggregate(ctx, db, "people", json.RawMessage(`[{"$group":{"_id":null,"total":{"$sum":"$age"}}}]`), 0)
			if err != nil || len(agg) != 1 || !strings.Contains(string(agg[0]), `"total":63`) {
				t.Fatalf("aggregate: %v %s", err, agg)
			}
			if out, err := d.RunCommand(ctx, db, json.RawMessage(`{"dbStats":1}`)); err != nil || !strings.Contains(string(out), `"collections"`) {
				t.Fatalf("command: %v %s", err, out)
			}
			t.Logf("%s (%s): ok", d.Info().ServerVersion, name)
		})
	}
}
