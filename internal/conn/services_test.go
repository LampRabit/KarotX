package conn

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseServices(t *testing.T) {
	list, err := parseServices([]byte(`{"version":1,"source":"LampRabit","databases":[
		{"id":"pg","name":"Postgres","type":"postgres","host":"127.0.0.1","port":5432,"password":"pw","status":"running"},
		{"id":"maria","type":"mariadb","host":"127.0.0.1","status":"running"},
		{"id":"cache","type":"redis","host":"127.0.0.1","status":"stopped"},
		{"id":"ch","type":"clickhouse","host":"127.0.0.1","status":"running"},
		{"id":"bad/../id","type":"postgres","host":"x","status":"running"},
		{"id":"pg","type":"postgres","host":"dup","status":"running"}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 4 {
		t.Fatalf("want 4 entries (bad id and duplicate skipped), got %d", len(list))
	}
	pg, maria, cache, ch := list[0], list[1], list[2], list[3]
	if pg.conn.ID != "lr-pg" || pg.conn.Driver != "postgres" || pg.password != "pw" || pg.unavailable != "" || pg.source != "LampRabit" {
		t.Errorf("postgres: %+v", pg)
	}
	if maria.conn.Driver != "mysql" || maria.conn.Preset != "mariadb" || maria.conn.Name != "maria" {
		t.Errorf("mariadb: %+v", maria)
	}
	if cache.unavailable != "Stopped in LampRabit" || cache.conn.Database != "0" {
		t.Errorf("stopped redis: %+v", cache)
	}
	if ch.unavailable != "ClickHouse support is coming soon" {
		t.Errorf("clickhouse: %+v", ch)
	}
	if l, _ := parseServices([]byte(`{"version":1,"databases":[{"id":"x","type":"redis","host":"h","status":"stopped"}]}`)); l[0].source != "Services" || l[0].unavailable != "Stopped in Services" {
		t.Errorf("default source: %+v", l[0])
	}
	if _, err := parseServices([]byte(`{"version":2}`)); err == nil {
		t.Error("version 2 should be rejected")
	}
}

func TestWatchServicesPicksUpChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "services.json")
	m := NewManager(nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	changed := m.Changed()
	go m.WatchServices(ctx, path) // file doesn't exist yet: must wait quietly

	write := func(body string) {
		os.WriteFile(path+".tmp", []byte(body), 0o600)
		os.Rename(path+".tmp", path)
	}
	wait := func() {
		select {
		case <-changed:
			changed = m.Changed()
		case <-time.After(5 * time.Second):
			t.Fatal("no change notification")
		}
	}

	write(`{"version":1,"databases":[{"id":"a","type":"postgres","host":"h","status":"running"}]}`)
	wait()
	if _, ok := m.findManaged("lr-a"); !ok {
		t.Fatal("service a not loaded")
	}

	write(`{"version":1,"databases":[{"id":"b","type":"redis","host":"h","status":"running"},{"id":"c","type":"neo4j","status":"running"}]}`)
	wait()
	if _, ok := m.findManaged("lr-a"); ok {
		t.Error("removed service a still listed")
	}
	if _, ok := m.findManaged("lr-b"); !ok {
		t.Error("added service b not listed")
	}

	write(`not json`)
	wait()
	if m.ServicesError() == "" {
		t.Error("broken file should report an error")
	}
	if _, ok := m.findManaged("lr-b"); !ok {
		t.Error("last good list should be kept on a broken file")
	}
}
